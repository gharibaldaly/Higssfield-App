import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { specFromRemoteSchema, specsFromCatalog } from "@/lib/providers/higgsfield/catalog";
import {
  extractCost,
  HiggsfieldClient,
  normalizeStatus,
  toProviderState,
} from "@/lib/providers/higgsfield/client";
import { BUILTIN_MODELS } from "@/lib/providers/higgsfield/models";
import { modelSpecSchema } from "@/lib/providers/higgsfield/types";

const dop = modelSpecSchema.parse(
  BUILTIN_MODELS.find((model) => model.id === "higgsfield-dop-standard"),
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
      dop,
      { prompt: "x" },
      { generationId: "g1", webhookUrl: "https://app.test/hook?gid=1&sig=2" },
    );

    expect(state).toMatchObject({ requestId: "req-1", status: "queued" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.higgsfield.ai/v1/image2video/dop?hf_webhook=https%3A%2F%2Fapp.test%2Fhook%3Fgid%3D1%26sig%3D2",
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
      client.submit(dop, {}, { generationId: "g", webhookUrl: null }),
    ).rejects.toMatchObject({
      code: "provider_bad_input",
      detail: "aspect_ratio: unexpected value",
    });
  });

  it("retries transient gateway errors on submit", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { status: "queued", request_id: "req-2" }));
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 1 });
    const state = await client.submit(dop, {}, { generationId: "g", webhookUrl: null });
    expect(state.requestId).toBe("req-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("never retries a submit rejected for bad input", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { detail: "nope" }));
    const client = new HiggsfieldClient({ keyId: "id", keySecret: "secret", retries: 2 });
    await expect(
      client.submit(dop, {}, { generationId: "g", webhookUrl: null }),
    ).rejects.toMatchObject({
      code: "provider_bad_input",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
