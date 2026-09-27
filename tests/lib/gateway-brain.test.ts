import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { resetServerEnvCache } from "@/lib/env";
import { getDirectorBrain } from "@/lib/providers/llm";
import {
  extractJson,
  GatewayBrain,
  listGatewayModels,
  messageText,
} from "@/lib/providers/llm/gateway";
import type { LlmImageHost, StructuredRequest } from "@/lib/providers/llm/types";
import { passesVisionTest, TEST_COLOURS } from "@/lib/providers/llm/vision-check";

const answerSchema = z.object({ verdict: z.string(), score: z.number() });

class TestGateway extends GatewayBrain {
  run<T>(request: StructuredRequest<T>): Promise<T> {
    return this.structured(request);
  }
}

/** Every gateway is new (its own URL), so nothing learned in one test leaks into another. */
let serial = 0;
function gateway(model?: string, imageHost?: LlmImageHost) {
  serial += 1;
  return new TestGateway(
    {
      baseUrl: `https://gateway${serial}.test/v1`,
      apiKey: "sk-test",
      model: model ?? `model-${serial}`,
      name: "TestGate",
      maxTokens: 16_000,
    },
    imageHost,
  );
}

const request: StructuredRequest<z.infer<typeof answerSchema>> = {
  name: "fidelity review",
  system: "You check garments.",
  user: "Compare the photos.",
  images: [],
  schema: answerSchema,
  maxTokens: 32_000,
};

let photo: string;
const withPhotos = (count: number): StructuredRequest<z.infer<typeof answerSchema>> => ({
  ...request,
  images: Array.from({ length: count }, (_, index) => ({
    mimeType: "image/jpeg" as const,
    base64: photo,
    caption: `Photo ${index + 1}`,
  })),
});

function completion(content: unknown, finish = "stop"): Response {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();
const sentBodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

type Part = { type: string; text?: string; image_url?: { url: string } };
const userParts = (body: Record<string, unknown>) =>
  (body.messages as { content: Part[] }[])[1]!.content;
const imageUrls = (body: Record<string, unknown>) =>
  userParts(body).flatMap((part) => (part.image_url ? [part.image_url.url] : []));
const isVisionCheck = (body: Record<string, unknown>) =>
  JSON.stringify(body.messages).includes("four equal squares");

/** Images behind the fake Storage links, so the fake gateway can "fetch" them. */
const linked = new Map<string, Buffer>();

function imageBytes(url: string): Buffer {
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const bytes = linked.get(url);
  if (!bytes) throw new Error(`no image behind ${url}`);
  return bytes;
}

/** Answers a vision check the way a model that sees the image would. */
async function readTestImage(body: Record<string, unknown>): Promise<Response> {
  const [url] = imageUrls(body);
  const { data, info } = await sharp(imageBytes(url!)).raw().toBuffer({ resolveWithObject: true });
  const colourAt = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    const pixel = [data[offset]!, data[offset + 1]!, data[offset + 2]!];
    return Object.entries(TEST_COLOURS).find(([, rgb]) =>
      rgb.every((value, index) => Math.abs(value - pixel[index]!) <= 2),
    )![0];
  };
  const edge = info.width - 8;
  return completion(
    JSON.stringify({ topLeft: colourAt(8, 8), bottomRight: `${colourAt(edge, edge)} square` }),
  );
}

/** A gateway that answers vision checks with `onCheck` and everything else from `replies`. */
function serve(replies: Response[], onCheck = readTestImage) {
  fetchMock.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (isVisionCheck(body)) return onCheck(body);
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected request");
    return reply;
  });
}

/** A Storage stand-in: one link per image, and a record of the copies released. */
function fakeHost() {
  const released: string[][] = [];
  let count = 0;
  const host: LlmImageHost = async (images) => {
    const urls = images.map((image) => {
      count += 1;
      const url = `https://storage.test/tmp/brain/${count}.jpg`;
      linked.set(url, Buffer.from(image.base64, "base64"));
      return url;
    });
    return {
      urls,
      release: async () => {
        released.push(urls);
      },
    };
  };
  return { host, released };
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  photo ??= (
    await sharp({ create: { width: 40, height: 50, channels: 3, background: "#C8A2C8" } })
      .jpeg()
      .toBuffer()
  ).toString("base64");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GatewayBrain", () => {
  it("asks for the schema as JSON with the key and a capped output", async () => {
    fetchMock.mockResolvedValueOnce(completion('{"verdict":"match","score":92}'));
    const brain = gateway("claude-sonnet-4-6");
    await expect(brain.run(request)).resolves.toEqual({ verdict: "match", score: 92 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/v1\/chat\/completions$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    const body = sentBodies()[0]!;
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(16_000);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "fidelity_review", strict: false },
    });
    expect(body.messages).toEqual([
      { role: "system", content: "You check garments." },
      { role: "user", content: "Compare the photos." },
    ]);
  });

  it("falls back to json_object, then to the schema in the prompt, and remembers what worked", async () => {
    fetchMock
      .mockResolvedValueOnce(failure(400, "response_format json_schema is not supported"))
      .mockResolvedValueOnce(failure(400, "response_format is not supported"))
      .mockResolvedValueOnce(completion('Here you go:\n```json\n{"verdict":"ok","score":1}\n```'))
      .mockResolvedValueOnce(completion('{"verdict":"again","score":2}'));
    const brain = gateway();
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok", score: 1 });
    await expect(brain.run(request)).resolves.toEqual({ verdict: "again", score: 2 });

    const bodies = sentBodies();
    expect(bodies.map((body) => (body.response_format as { type?: string })?.type)).toEqual([
      "json_schema",
      "json_object",
      undefined,
      undefined,
    ]);
    const lastUser = (bodies[3]!.messages as { content: string }[])[1]!.content;
    expect(lastUser).toContain("Respond with JSON only");
  });

  it("switches to max_completion_tokens or a smaller cap when the gateway asks", async () => {
    fetchMock
      .mockResolvedValueOnce(failure(400, "Unsupported parameter: use max_completion_tokens"))
      .mockResolvedValueOnce(failure(400, "max_completion_tokens is too large: 16000 > 8192"))
      .mockResolvedValueOnce(completion('{"verdict":"ok","score":3}'));
    await expect(gateway().run(request)).resolves.toEqual({ verdict: "ok", score: 3 });
    const bodies = sentBodies();
    expect(bodies[1]!.max_completion_tokens).toBe(16_000);
    expect(bodies[2]!.max_completion_tokens).toBe(8000);
    expect(bodies[2]!.max_tokens).toBeUndefined();
  });

  it("asks once more when the answer does not match the schema", async () => {
    fetchMock
      .mockResolvedValueOnce(completion('{"verdict":"ok"}'))
      .mockResolvedValueOnce(completion('{"verdict":"ok","score":4}'));
    await expect(gateway().run(request)).resolves.toEqual({ verdict: "ok", score: 4 });
    const repair = (sentBodies()[1]!.messages as { content: string }[])[1]!.content;
    expect(repair).toContain("did not match the required JSON schema");
  });

  it("explains key, balance, model and quota problems", async () => {
    fetchMock.mockResolvedValueOnce(failure(401, "invalid key"));
    await expect(gateway().run(request)).rejects.toMatchObject({ code: "provider_auth" });
    fetchMock.mockResolvedValueOnce(failure(402, "insufficient balance"));
    await expect(gateway().run(request)).rejects.toMatchObject({ code: "provider_credits" });
    fetchMock.mockResolvedValueOnce(failure(404, "model not found"));
    await expect(gateway("no-such-model").run(request)).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("no-such-model"),
    });
    fetchMock
      .mockResolvedValueOnce(failure(429, "daily limit reached"))
      .mockResolvedValueOnce(failure(429, "daily limit reached"));
    await expect(gateway().run(request)).rejects.toMatchObject({
      code: "provider_rate_limit",
      detail: "daily limit reached",
    });
  }, 15_000);

  it("reports filtered and cut-off answers clearly", async () => {
    fetchMock.mockResolvedValueOnce(completion(null, "content_filter"));
    await expect(gateway().run(request)).rejects.toMatchObject({ code: "content_filter" });
    fetchMock
      .mockResolvedValueOnce(completion('{"verdict":', "length"))
      .mockResolvedValueOnce(completion('{"verdict":', "length"));
    await expect(gateway().run(request)).rejects.toMatchObject({ code: "llm_output" });
  });
});

describe("GatewayBrain photos", () => {
  it("checks once that the model reads a test image, then sends the photos inline", async () => {
    const ok = () => completion('{"verdict":"ok","score":1}');
    serve([ok(), ok(), completion('{"verdict":"ok","score":2}')]);
    const brain = gateway();
    // Two first calls at once share one check.
    await Promise.all([brain.run(withPhotos(2)), brain.run(withPhotos(1))]);
    await expect(brain.run(withPhotos(1))).resolves.toEqual({ verdict: "ok", score: 2 });

    const bodies = sentBodies();
    expect(bodies.map(isVisionCheck)).toEqual([true, false, false, false]);
    const twoPhotos = bodies.find((body) => imageUrls(body).length === 2)!;
    expect(userParts(twoPhotos)).toEqual([
      { type: "text", text: "Photo 1" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${photo}` } },
      { type: "text", text: "Photo 2" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${photo}` } },
      { type: "text", text: "Compare the photos." },
    ]);
  });

  it("sends the photos by link when it can, and deletes the copies after each answer", async () => {
    const { host, released } = fakeHost();
    serve([completion('{"verdict":"ok","score":3}')]);
    await expect(gateway(undefined, host).run(withPhotos(12))).resolves.toEqual({
      verdict: "ok",
      score: 3,
    });

    const [check, real] = sentBodies();
    expect(imageUrls(check!)).toEqual(["https://storage.test/tmp/brain/1.jpg"]);
    expect(imageUrls(real!)).toHaveLength(12);
    expect(imageUrls(real!).every((url) => url.startsWith("https://storage.test/"))).toBe(true);
    // Twelve photos by link stay a few kilobytes, whatever their size.
    expect(JSON.stringify(real).length).toBeLessThan(4000);
    expect(released.map((urls) => urls.length)).toEqual([1, 12]);
  });

  it("falls back to inline photos when the gateway cannot fetch links", async () => {
    const { host, released } = fakeHost();
    serve([completion('{"verdict":"ok","score":4}')], async (body) =>
      imageUrls(body)[0]!.startsWith("data:")
        ? readTestImage(body)
        : failure(400, "Failed to download image from URL"),
    );
    await expect(gateway(undefined, host).run(withPhotos(1))).resolves.toEqual({
      verdict: "ok",
      score: 4,
    });

    const bodies = sentBodies();
    expect(bodies).toHaveLength(3);
    expect(imageUrls(bodies[2]!)[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(released).toHaveLength(1);
  });

  it("names the failed links when inline photos overflow the context", async () => {
    const { host } = fakeHost();
    serve(
      [
        failure(
          400,
          "This model's maximum context length is 270,000 tokens. However, your request resulted in 1,417,769 tokens.",
        ),
      ],
      async (body) =>
        imageUrls(body)[0]!.startsWith("data:")
          ? readTestImage(body)
          : failure(400, "Failed to download image from URL"),
    );
    await expect(gateway(undefined, host).run(withPhotos(12))).rejects.toMatchObject({
      message: expect.stringMatching(
        /longer than .* accepts.*could not use links: Failed to download image from URL/,
      ),
    });
  });

  it("stops before the garment photos when the model cannot read the test image", async () => {
    const { host } = fakeHost();
    serve([], async () => completion('{"topLeft":"red","bottomRight":"red"}'));
    await expect(gateway("text-only", host).run(withPhotos(3))).rejects.toMatchObject({
      code: "provider_bad_input",
      message: expect.stringContaining("could not read a test image"),
    });
    expect(sentBodies().every(isVisionCheck)).toBe(true);
  });

  it("explains a request longer than the model's context without trying other JSON modes", async () => {
    fetchMock.mockResolvedValueOnce(
      failure(
        400,
        "This model's maximum context length is 270,000 tokens. However, your request resulted in 1,417,769 tokens. Please reduce the length of the messages.",
      ),
    );
    await expect(gateway("small-context").run(request)).rejects.toMatchObject({
      code: "provider_bad_input",
      message: expect.stringContaining("longer than small-context at TestGate accepts"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts colour names with extra words, and nothing else", () => {
    const expected = { topLeft: "blue", bottomRight: "white" } as const;
    expect(passesVisionTest({ topLeft: "Blue", bottomRight: "white square" }, expected)).toBe(true);
    expect(passesVisionTest({ topLeft: "blue", bottomRight: "off-white" }, expected)).toBe(true);
    expect(passesVisionTest({ topLeft: "blue", bottomRight: "grey" }, expected)).toBe(false);
    expect(passesVisionTest({ topLeft: "red", bottomRight: "white" }, expected)).toBe(false);
  });
});

describe("answer parsing", () => {
  it("reads plain, fenced and prose-wrapped JSON and part arrays", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":3} Hope this helps.')).toEqual({ a: 3 });
    expect(() => extractJson("no json here")).toThrow();
    expect(
      messageText([
        { type: "text", text: '{"a"' },
        { type: "text", text: ":4}" },
      ]),
    ).toBe('{"a":4}');
  });

  it("lists the gateway's models for Settings, or nothing on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "gpt-6-luna" }, { id: "claude-sonnet-4-6" }] }), {
        status: 200,
      }),
    );
    const config = {
      baseUrl: "https://models.test/v1",
      apiKey: "sk",
      model: null,
      name: "G",
      maxTokens: 16_000,
    };
    await expect(listGatewayModels(config)).resolves.toEqual(["claude-sonnet-4-6", "gpt-6-luna"]);
    await expect(
      listGatewayModels({ ...config, baseUrl: "https://other.test/v1" }).catch(() => "threw"),
    ).resolves.toEqual([]);
  });
});

describe("brain selection", () => {
  const MANAGED = [
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "LLM_GATEWAY_BASE_URL",
    "LLM_GATEWAY_API_KEY",
    "LLM_GATEWAY_MODEL",
    "LLM_GATEWAY_NAME",
  ] as const;
  function setEnv(values: Partial<Record<(typeof MANAGED)[number], string>>) {
    for (const name of MANAGED) vi.stubEnv(name, values[name] ?? "");
    resetServerEnvCache();
  }
  afterEach(() => {
    vi.unstubAllEnvs();
    resetServerEnvCache();
  });

  it("uses the gateway when chosen and a model id is known", () => {
    setEnv({
      LLM_GATEWAY_BASE_URL: "https://vyceai.test/v1/",
      LLM_GATEWAY_API_KEY: "sk",
      LLM_GATEWAY_NAME: "Vyce",
    });
    expect(getDirectorBrain({ llmProvider: "gateway" }).provider).toBe("mock");
    const brain = getDirectorBrain({ llmProvider: "gateway", gatewayModel: "gpt-6-luna" });
    expect(brain).toMatchObject({ provider: "gateway", model: "gpt-6-luna", name: "Vyce" });
  });

  it("falls back to the next configured provider, and never sends the key over plain http", () => {
    setEnv({
      LLM_GATEWAY_BASE_URL: "http://vyceai.test/v1",
      LLM_GATEWAY_API_KEY: "sk",
      LLM_GATEWAY_MODEL: "gpt-6-luna",
      GEMINI_API_KEY: "g",
    });
    expect(getDirectorBrain({ llmProvider: "gateway" }).provider).toBe("gemini");
    setEnv({
      LLM_GATEWAY_BASE_URL: "https://vyceai.test/v1",
      LLM_GATEWAY_API_KEY: "sk",
      LLM_GATEWAY_MODEL: "gpt-6-luna",
    });
    expect(getDirectorBrain({ llmProvider: "claude" }).provider).toBe("gateway");
  });
});
