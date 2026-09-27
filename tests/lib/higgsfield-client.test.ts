import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toUserMessage } from "@/lib/errors";
import { specFromRemoteSchema, specsFromCatalog } from "@/lib/providers/higgsfield/catalog";
import {
  extractCost,
  HiggsfieldClient,
  normalizeStatus,
  parseEstimate,
  toProviderState,
} from "@/lib/providers/higgsfield/client";
import { BUILTIN_MODELS } from "@/lib/providers/higgsfield/models";
import { modelSpecSchema } from "@/lib/providers/higgsfield/types";

const kling = modelSpecSchema.parse(
  BUILTIN_MODELS.find((model) => model.id === "kling-video-v3.0-pro-image-to-video"),
);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HiggsfieldClient", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits to the model endpoint with Key auth and the webhook query", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "queued",
        request_id: "req-1",
        status_url: "https://api.higgsfield.ai/requests/req-1/status",
        cancel_url: "https://api.higgsfield.ai/requests/req-1/cancel",
      }),
    );
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret" });
    const state = await client.submit(
      kling,
      { prompt: "x" },
      { generationId: "g1", webhookUrl: "https://app.test/hook?gid=1&sig=2" },
    );

    expect(state).toMatchObject({ requestId: "req-1", status: "queued" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.higgsfield.ai/kling-video/v3.0/pro/image-to-video?hf_webhook=https%3A%2F%2Fapp.test%2Fhook%3Fgid%3D1%26sig%3D2",
    );
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Key id:secret");
    expect(JSON.parse(String(init?.body))).toEqual({ prompt: "x" });
  });

  it("polls /requests/{id}/status and reads video results", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: "completed",
        request_id: "req-1",
        status_url: "s",
        cancel_url: "c",
        video: { url: "https://cdn.test/v.mp4" },
      }),
    );
    const client = new HiggsfieldClient({
      keyId: "id",
      keySecret: "secret",
      baseUrl: "https://api.test/",
    });
    const state = await client.getStatus("req-1");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/requests/req-1/status");
    expect(state).toMatchObject({
      status: "completed",
      resultKind: "video",
      resultUrls: ["https://cdn.test/v.mp4"],
    });
  });

  it("maps HTTP errors to user-facing errors", async () => {
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 0 });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: "bad key" }));
    await expect(client.getStatus("x")).rejects.toMatchObject({ code: "provider_auth" });
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: "no credits" }));
    await expect(client.getStatus("x")).rejects.toMatchObject({ code: "provider_credits" });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { detail: [{ loc: ["body", "aspect_ratio"], msg: "unexpected value" }] }),
    );
    await expect(
      client.submit(kling, {}, { generationId: "g", webhookUrl: null }),
    ).rejects.toMatchObject({
      code: "provider_bad_input",
      detail: "aspect_ratio: unexpected value",
    });
  });

  it("sends a submit again only after a documented retryable 500", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { detail: "oops" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "queued", request_id: "req-2" }));
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 1 });
    const state = await client.submit(kling, {}, { generationId: "g", webhookUrl: null });
    expect(state.requestId).toBe("req-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("never repeats a submit that Higgsfield may already have accepted", async () => {
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 2 });
    for (const status of [400, 502, 503, 504]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(jsonResponse(status, { detail: "nope" }));
      await expect(
        client.submit(kling, {}, { generationId: "g", webhookUrl: null }),
      ).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
      }),
    );
    await expect(
      client.submit(kling, {}, { generationId: "g", webhookUrl: null }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a submit again when the connection never opened", async () => {
    fetchMock
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { status: "queued", request_id: "req-3" }));
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 1 });
    const state = await client.submit(kling, {}, { generationId: "g", webhookUrl: null });
    expect(state.requestId).toBe("req-3");
  }, 10_000);

  it("tells the concurrency limit apart from bad input", async () => {
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 2 });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { detail: "Maximum number of concurrent requests (4) has been reached" }),
    );
    await expect(
      client.submit(kling, {}, { generationId: "g", webhookUrl: null }),
    ).rejects.toMatchObject({ code: "provider_busy", status: 400, retryable: true });
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { detail: "Invalid image" }));
    await expect(
      client.submit(kling, {}, { generationId: "g", webhookUrl: null }),
    ).rejects.toMatchObject({ code: "provider_bad_input" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps the rest of the documented error table", async () => {
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 0 });
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { detail: "Model not found" }));
    await expect(client.getStatus("x")).rejects.toMatchObject({ code: "not_found", status: 404 });
    fetchMock.mockResolvedValueOnce(jsonResponse(423, { detail: "blocked" }));
    await expect(client.getStatus("x")).rejects.toMatchObject({
      code: "provider_unavailable",
      status: 423,
      retryable: true,
    });
  });

  it("keeps Higgsfield's correlation id for support", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "queued", request_id: "req-4" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Correlation-ID": "corr-ok" },
      }),
    );
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 0 });
    const state = await client.submit(kling, {}, { generationId: "g", webhookUrl: null });
    expect(state.correlationId).toBe("corr-ok");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Invalid credentials" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "X-Correlation-ID": "corr-err" },
      }),
    );
    const error = await client.getStatus("x").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "provider_auth", reference: "corr-err" });
    expect(toUserMessage(error)).toContain("[ref corr-err]");
  });

  it("polls the status_url from the submit, but only on the API's own host", async () => {
    const completed = { status: "queued", request_id: "req-1" };
    const client = new HiggsfieldClient({
      keyId: "id",
      keySecret: "secret",
      baseUrl: "https://api.test",
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, completed));
    await client.getStatus("req-1", { statusUrl: "https://api.test/requests/req-1/status?v=2" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/requests/req-1/status?v=2");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, completed));
    await client.getStatus("req-1", { statusUrl: "https://elsewhere.test/requests/req-1/status" });
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.test/requests/req-1/status");
  });

  it("asks the estimate endpoint what a request costs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { credits: "1.500", usd: "0.094" }));
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret" });
    const estimate = await client.estimate(kling, {
      prompt: "x",
      image_url: "https://a.test/i.png",
    });
    expect(estimate).toEqual({ usd: 0.094, credits: 1.5 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.higgsfield.ai/estimate/kling-video/v3.0/pro/image-to-video");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt: "x",
      image_url: "https://a.test/i.png",
    });
    expect(parseEstimate({ credits: "n/a" })).toBeNull();
  });

  it("explains a cancel that came too late", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { detail: "Request already started" }));
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 0 });
    await expect(client.cancel("req-1")).rejects.toMatchObject({ code: "conflict" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));
    await expect(client.cancel("req-1")).resolves.toBeUndefined();
  });
});

describe("response parsing", () => {
  it("normalises status spellings", () => {
    expect(normalizeStatus("cancelled")).toBe("canceled");
    expect(normalizeStatus("COMPLETED")).toBe("completed");
    expect(normalizeStatus("something-new")).toBe("in_progress");
  });

  it("reads image results and failure reasons", () => {
    expect(
      toProviderState({
        status: "completed",
        request_id: "r",
        images: [{ url: "a" }, { url: "b" }],
      }),
    ).toMatchObject({ resultKind: "image", resultUrls: ["a", "b"] });
    expect(toProviderState({ status: "failed", request_id: "r", error: "boom" }).error).toBe(
      "boom",
    );
  });

  it("records cost only when present", () => {
    expect(extractCost({ cost: 0.42 })).toEqual({ amount: 0.42, unit: "usd" });
    expect(extractCost({ credits_used: "12" })).toEqual({ amount: 12, unit: "credits" });
    expect(extractCost({})).toBeNull();
  });
});

describe("remote catalogue conversion", () => {
  it("converts a JSON-schema model description into a spec", () => {
    const spec = specFromRemoteSchema({
      endpoint: "/vendor/video-model/image-to-video",
      name: "Vendor Video",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          image_url: { type: "string" },
          aspect_ratio: { type: "string", enum: ["9:16", "16:9"] },
          duration: { type: "integer", enum: [5, 10] },
        },
        required: ["prompt", "image_url"],
      },
    });
    expect(spec).toMatchObject({
      id: "vendor-video-model-image-to-video",
      kind: "video",
      modes: ["image-to-video"],
      source: "catalog",
    });
    expect(spec?.params.duration?.options).toEqual([5, 10]);
    expect(spec?.params.aspectRatio?.options.map((option) => option.label)).toEqual([
      "9:16",
      "16:9",
    ]);
  });

  it("detects multi-reference image models and skips models without a prompt", () => {
    const image = specFromRemoteSchema({
      endpoint: "vendor/edit",
      name: "Editor",
      inputSchema: {
        properties: { prompt: {}, input_images: { type: "array", maxItems: 3 } },
        required: ["input_images"],
      },
    });
    expect(image?.modes).toEqual(["image-to-image"]);
    expect(image?.params.image).toMatchObject({ format: "input_images", max: 3, required: true });
    expect(
      specFromRemoteSchema({ endpoint: "x/y", name: "No prompt", inputSchema: { properties: {} } }),
    ).toBeNull();
    expect(specsFromCatalog({ unexpected: true })).toEqual([]);
  });
});
