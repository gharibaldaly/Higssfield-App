import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { llmGatewayConfig, resetServerEnvCache } from "@/lib/env";
import { toLlmImage } from "@/lib/images/process";
import { getDirectorBrain } from "@/lib/providers/llm";
import {
  GatewayBrain,
  listGatewayModels,
  messageText,
  parseOverflow,
} from "@/lib/providers/llm/gateway";
import { answerText, extractJson } from "@/lib/providers/llm/json-answer";
import type { LlmImage, LlmImageHost, StructuredRequest } from "@/lib/providers/llm/types";
import { createVisionTest, passesVisionTest, TEST_COLOURS } from "@/lib/providers/llm/vision-check";

const answerSchema = z.object({ verdict: z.string(), score: z.number() });

class TestGateway extends GatewayBrain {
  run<T>(request: StructuredRequest<T>): Promise<T> {
    return this.structured(request);
  }
  protected override pause(): Promise<void> {
    return Promise.resolve();
  }
}

/** A gateway whose calls and route tests run out of time quickly. */
class HurriedGateway extends TestGateway {
  protected override readonly callTimeoutMs = 300;
  protected override readonly testTimeoutMs = 200;
  protected override pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Every gateway is new (its own URL), so nothing learned in one test leaks into another. */
let serial = 0;
function gateway(model?: string, imageHost?: LlmImageHost, reasoningEffort?: string) {
  serial += 1;
  return new TestGateway(
    {
      baseUrl: `https://gateway${serial}.test/v1`,
      apiKey: "sk-test",
      model: model ?? `model-${serial}`,
      id: "custom",
      name: "TestGate",
      maxTokens: 16_000,
      reasoningEffort,
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

/** A FastAPI validation error, as NVIDIA's APIs send for fields they do not take. */
function refusedFields(...fields: string[]): Response {
  const detail = fields.map((field) => ({
    type: "extra_forbidden",
    loc: ["body", field],
    msg: "Extra inputs are not permitted",
  }));
  return new Response(JSON.stringify({ detail }), {
    status: 422,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
const toCall = (url: unknown, init?: RequestInit): Call => ({
  url: String(url),
  body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  headers: (init?.headers ?? {}) as Record<string, string>,
});
const calls = (): Call[] => fetchMock.mock.calls.map(([url, init]) => toCall(url, init));
const sentBodies = () => calls().map((call) => call.body);
const isMessagesApi = (url: string) => url.endsWith("/messages");

type Part = {
  type: string;
  text?: string;
  image_url?: { url: string };
  source?: { type: string; url?: string; media_type?: string; data?: string };
};

/** The user content of a request, in either API format. */
function userContent(body: Record<string, unknown>): unknown {
  const messages = body.messages as { role: string; content: unknown }[];
  return messages.find((message) => message.role === "user")!.content;
}

/** Every image a request carries, as a link or a data URL, in either API format. */
function imageRefs(body: Record<string, unknown>): string[] {
  const content = userContent(body);
  if (!Array.isArray(content)) return [];
  return (content as Part[]).flatMap((part) => {
    if (part.image_url) return [part.image_url.url];
    if (part.source?.type === "url") return [part.source.url!];
    if (part.source) return [`data:${part.source.media_type};base64,${part.source.data}`];
    return [];
  });
}

const isVisionCheck = (body: Record<string, unknown>) =>
  JSON.stringify(body.messages).includes("four equal squares");

/** A successful reply in the shape of the API that was called. */
function answer(url: string, text: string): Response {
  if (!isMessagesApi(url)) return completion(text);
  return new Response(
    JSON.stringify({ type: "message", content: [{ type: "text", text }], stop_reason: "end_turn" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Images behind the fake Storage links, so the fake gateway can "fetch" them. */
const linked = new Map<string, Buffer>();

function imageBytes(url: string): Buffer {
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const bytes = linked.get(url);
  if (!bytes) throw new Error(`no image behind ${url}`);
  return bytes;
}

type Handler = (call: Call) => Promise<Response>;

/** Answers a vision check the way a model that sees the image would. */
const readTestImage: Handler = async (call) => {
  const [url] = imageRefs(call.body);
  const { data, info } = await sharp(imageBytes(url!)).raw().toBuffer({ resolveWithObject: true });
  const colourAt = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    const pixel = [data[offset]!, data[offset + 1]!, data[offset + 2]!];
    return Object.entries(TEST_COLOURS).find(([, rgb]) =>
      rgb.every((value, index) => Math.abs(value - pixel[index]!) <= 2),
    )![0];
  };
  const edge = info.width - 8;
  return answer(
    call.url,
    JSON.stringify({ topLeft: colourAt(8, 8), bottomRight: `${colourAt(edge, edge)} square` }),
  );
};

/** A model that never sees the image and always says the same thing. */
const blind: Handler = async (call) => answer(call.url, '{"topLeft":"red","bottomRight":"red"}');

const isLink = (call: Call) => !imageRefs(call.body)[0]!.startsWith("data:");

/** A fake gateway: vision checks go to `onCheck`, everything else gets `replies` in order. */
function serve(replies: string[] | Handler, onCheck: Handler = readTestImage) {
  fetchMock.mockImplementation(async (url, init) => {
    const call = toCall(url, init);
    if (isVisionCheck(call.body)) return onCheck(call);
    if (typeof replies === "function") return replies(call);
    const text = replies.shift();
    if (text === undefined) throw new Error("unexpected request");
    return answer(call.url, text);
  });
}

/** A gateway that counts every character of the request, four to a token, inline photos included. */
function countingGateway(limit: number): Handler {
  return async (call) => {
    const tokens = Math.ceil(JSON.stringify(call.body).length / 4);
    return tokens > limit
      ? failure(
          400,
          `This model's maximum context length is ${limit.toLocaleString("en-US")} tokens. However, your request resulted in ${tokens.toLocaleString("en-US")} tokens. Please reduce the length of the messages.`,
        )
      : answer(call.url, '{"verdict":"ok","score":5}');
  };
}

/** Detailed photos (noise compresses badly, like lace), resized for the brain as usual. */
let detailed: LlmImage[] | null = null;
async function detailedPhotos(): Promise<LlmImage[]> {
  if (!detailed) {
    const pixels = Buffer.alloc(600 * 800 * 3);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7919) % 251;
    const jpeg = await sharp(pixels, { raw: { width: 600, height: 800, channels: 3 } })
      .jpeg({ quality: 92 })
      .toBuffer();
    detailed = await Promise.all(
      ["Front", "Back", "Lace", "Strap"].map((caption) => toLlmImage(jpeg, caption)),
    );
  }
  return detailed;
}

const tokensOf = (body: Record<string, unknown>) => Math.ceil(JSON.stringify(body).length / 4);

async function longEdgeOf(url: string): Promise<number> {
  const meta = await sharp(imageBytes(url)).metadata();
  return Math.max(meta.width!, meta.height!);
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

describe("the model that answered", () => {
  it("is the requested model until the service names another, as OpenRouter's fallbacks do", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: "google/gemma-4-26b-a4b-it:free",
          choices: [{ finish_reason: "stop", message: { content: '{"verdict":"ok","score":1}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const brain = gateway("google/gemma-4-31b-it:free");
    expect(brain.model).toBe("google/gemma-4-31b-it:free");
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok", score: 1 });
    expect(brain.model).toBe("google/gemma-4-26b-a4b-it:free");
    // The next request still asks for the model the owner chose.
    expect(sentBodies().at(-1)).toMatchObject({ model: "google/gemma-4-31b-it:free" });
  });
});

describe("GatewayBrain photos", () => {
  it("checks the photo route with two test images once, then sends the photos inline", async () => {
    serve([
      '{"verdict":"ok","score":1}',
      '{"verdict":"ok","score":1}',
      '{"verdict":"ok","score":2}',
    ]);
    const brain = gateway();
    // Two first calls at once share one check.
    await Promise.all([brain.run(withPhotos(2)), brain.run(withPhotos(1))]);
    await expect(brain.run(withPhotos(1))).resolves.toEqual({ verdict: "ok", score: 2 });

    const all = calls();
    // The inline routes are tested side by side, and no photo leaves before the check ends.
    const checks = all.filter((call) => isVisionCheck(call.body));
    expect(all.map((call) => isVisionCheck(call.body))).toEqual([
      ...checks.map(() => true),
      ...[false, false, false],
    ]);
    // The preferred route reads both test images. The other route's second test
    // image may still be unsent when the check ends, and is then never sent.
    expect(checks.filter((call) => isMessagesApi(call.url))).toHaveLength(2);
    expect(checks.length).toBeGreaterThanOrEqual(3);
    expect(checks.length).toBeLessThanOrEqual(4);
    // Without links, the Anthropic format comes first: it carries images as image blocks.
    const real = all.filter((call) => !isVisionCheck(call.body));
    expect(real.every((call) => isMessagesApi(call.url))).toBe(true);
    const twoPhotos = real.find((call) => imageRefs(call.body).length === 2)!;
    expect(twoPhotos.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
    });
    expect(twoPhotos.body).toMatchObject({ system: "You check garments.", max_tokens: 16_000 });
    const blocks = userContent(twoPhotos.body) as Part[];
    expect(blocks.slice(0, 4)).toEqual([
      { type: "text", text: "Photo 1" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo } },
      { type: "text", text: "Photo 2" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo } },
    ]);
    expect(blocks[4]!.text).toMatch(/^Compare the photos\.[\s\S]*Respond with JSON only/);
  });

  it("sends the photos by link when the model reads them that way, and deletes the copies", async () => {
    const { host, released } = fakeHost();
    serve(['{"verdict":"ok","score":3}']);
    await expect(gateway(undefined, host).run(withPhotos(12))).resolves.toEqual({
      verdict: "ok",
      score: 3,
    });

    const all = calls();
    const checks = all.filter((call) => isVisionCheck(call.body));
    // The link route read both test images; the other routes were no longer needed.
    expect(checks.filter((call) => isLink(call) && !isMessagesApi(call.url))).toHaveLength(2);
    expect(checks.every((call) => imageRefs(call.body).length === 1)).toBe(true);
    const real = all.at(-1);
    expect(real!.url).toMatch(/\/chat\/completions$/);
    expect(imageRefs(real!.body)).toHaveLength(12);
    expect(imageRefs(real!.body).every((url) => url.startsWith("https://storage.test/"))).toBe(
      true,
    );
    // Twelve photos by link stay a few kilobytes, whatever their size.
    expect(JSON.stringify(real!.body).length).toBeLessThan(4000);
    expect(released.filter((urls) => urls.length === 12)).toHaveLength(1);
    expect(released.every((urls) => urls.length === 1 || urls.length === 12)).toBe(true);
  });

  it("reads photos through the Anthropic format when chat completions drop them", async () => {
    const { host } = fakeHost();
    serve(['{"verdict":"ok","score":4}'], async (call) =>
      isMessagesApi(call.url) ? readTestImage(call) : blind(call),
    );
    await expect(gateway(undefined, host).run(withPhotos(2))).resolves.toEqual({
      verdict: "ok",
      score: 4,
    });

    const all = calls();
    const checks = all.filter((call) => isVisionCheck(call.body));
    // Chat links failed its first test, and Anthropic links then passed two.
    expect(checks.filter((call) => !isMessagesApi(call.url) && isLink(call))).toHaveLength(1);
    expect(checks.filter((call) => isMessagesApi(call.url) && isLink(call))).toHaveLength(2);
    const real = all.at(-1)!;
    expect(isMessagesApi(real.url)).toBe(true);
    const blocks = userContent(real.body) as Part[];
    expect(blocks.filter((part) => part.source).map((part) => part.source!.type)).toEqual([
      "url",
      "url",
    ]);
  });

  it("uses inline photos in the Anthropic format when links cannot be fetched", async () => {
    const { host, released } = fakeHost();
    serve(['{"verdict":"ok","score":5}'], async (call) => {
      if (isLink(call)) return failure(400, "Failed to download image from URL");
      return isMessagesApi(call.url) ? readTestImage(call) : blind(call);
    });
    await expect(gateway(undefined, host).run(withPhotos(1))).resolves.toEqual({
      verdict: "ok",
      score: 5,
    });

    const real = calls().at(-1)!;
    expect(isMessagesApi(real.url)).toBe(true);
    expect(imageRefs(real.body)[0]).toMatch(/^data:image\/jpeg;base64,/);
    // Each link route failed on its first test, and its copies were deleted.
    expect(released).toHaveLength(2);
  });

  it("needs two correct test images in a row before trusting a route", async () => {
    const { host } = fakeHost();
    let chatChecks = 0;
    serve(['{"verdict":"ok","score":6}'], async (call) => {
      if (isMessagesApi(call.url)) return readTestImage(call);
      chatChecks += 1;
      return chatChecks === 1 ? readTestImage(call) : blind(call);
    });
    await expect(gateway(undefined, host).run(withPhotos(1))).resolves.toEqual({
      verdict: "ok",
      score: 6,
    });
    expect(isMessagesApi(calls().at(-1)!.url)).toBe(true);
  });

  it("skips the Anthropic format when the gateway does not serve it", async () => {
    const { host } = fakeHost();
    serve(['{"verdict":"ok","score":7}'], async (call) => {
      if (isMessagesApi(call.url)) return failure(404, "Not Found");
      return isLink(call) ? blind(call) : readTestImage(call);
    });
    await expect(gateway(undefined, host).run(withPhotos(1))).resolves.toEqual({
      verdict: "ok",
      score: 7,
    });
    const real = calls().at(-1)!;
    expect(real.url).toMatch(/\/chat\/completions$/);
    expect(imageRefs(real.body)[0]).toMatch(/^data:/);
  });

  it("lists what happened on every route when the model cannot read images", async () => {
    const { host } = fakeHost();
    serve([], blind);
    const error = await gateway("text-only", host)
      .run(withPhotos(3))
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "provider_bad_input",
      message: expect.stringContaining("could not read a test image through any route"),
    });
    const detail = (error as { detail: string }).detail;
    for (const route of ["chat links", "messages links", "messages inline", "chat inline"]) {
      expect(detail).toContain(`${route}: named red / red for`);
    }
    expect(sentBodies().every(isVisionCheck)).toBe(true);
  });

  it("names the failed routes when inline photos overflow the context", async () => {
    const { host } = fakeHost();
    serve(
      async () =>
        failure(
          400,
          "This model's maximum context length is 270,000 tokens. However, your request resulted in 1,417,769 tokens.",
        ),
      async (call) => {
        if (isLink(call)) return failure(400, "Failed to download image from URL");
        return isMessagesApi(call.url) ? blind(call) : readTestImage(call);
      },
    );
    await expect(gateway(undefined, host).run(withPhotos(12))).rejects.toMatchObject({
      message: expect.stringMatching(
        /Too many photos for .*other routes failed the image test \(chat links: Failed to download image from URL; messages links: .*messages inline: named red/,
      ),
    });
  });

  it("reads Anthropic stop reasons, and chat-shaped replies from the messages endpoint", async () => {
    serve(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ content: [], stop_reason: "refusal" }), { status: 200 }),
      ),
    );
    await expect(gateway().run(withPhotos(1))).rejects.toMatchObject({ code: "provider_refusal" });

    serve(async () => completion('{"verdict":"chat-shaped","score":8}'));
    await expect(gateway().run(withPhotos(1))).resolves.toEqual({
      verdict: "chat-shaped",
      score: 8,
    });
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

  it("fits inline photos to the limit the gateway reports, then fits them before sending", async () => {
    const photos = { ...request, images: await detailedPhotos() };
    const photoTokens = photos.images.reduce((sum, image) => sum + image.base64.length, 0) / 4;
    const limit = Math.round(photoTokens / 3);
    serve(countingGateway(limit));
    const brain = gateway();
    await expect(brain.run(photos)).resolves.toEqual({ verdict: "ok", score: 5 });

    const real = () => sentBodies().filter((body) => !isVisionCheck(body));
    const [overflowed, fitted] = real();
    expect(real()).toHaveLength(2);
    expect(tokensOf(overflowed!)).toBeGreaterThan(limit);
    expect(tokensOf(fitted!)).toBeLessThanOrEqual(limit);
    expect(await longEdgeOf(imageRefs(fitted!)[0]!)).toBeLessThan(800);
    // Only as small as needed: most of the room goes to the photos.
    expect(tokensOf(fitted!)).toBeGreaterThan(limit * 0.5);

    await expect(brain.run(photos)).resolves.toEqual({ verdict: "ok", score: 5 });
    expect(real()).toHaveLength(3);
  }, 30_000);

  it("stops with a clear message when even the smallest photos do not fit", async () => {
    serve(countingGateway(20_000));
    await expect(
      gateway().run({ ...request, images: await detailedPhotos() }),
    ).rejects.toMatchObject({ message: expect.stringContaining("Too many photos for") });
  }, 30_000);

  it("halves the photos when the gateway names no numbers", async () => {
    let first = 0;
    serve(async (call) => {
      const length = JSON.stringify(call.body).length;
      first ||= length;
      return length > first * 0.6
        ? new Response("Payload Too Large", { status: 413 })
        : answer(call.url, '{"verdict":"ok","score":6}');
    });
    await expect(gateway().run({ ...request, images: await detailedPhotos() })).resolves.toEqual({
      verdict: "ok",
      score: 6,
    });
    expect(sentBodies().filter((body) => !isVisionCheck(body))).toHaveLength(2);
  }, 30_000);

  it("reads the limit out of the usual overflow messages", () => {
    expect(
      parseOverflow(
        "This model's maximum context length is 270,000 tokens. However, your request resulted in 1,416,179 tokens.",
      ),
    ).toEqual({ context: 270_000, counted: 1_416_179 });
    expect(parseOverflow("prompt is too long: 250000 tokens > 200000 maximum")).toEqual({
      context: 200_000,
      counted: 250_000,
    });
    expect(parseOverflow("Payload Too Large")).toBeNull();
    expect(parseOverflow("limit 4096 tokens, you sent 1000 tokens")).toBeNull();
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
      id: "custom" as const,
      name: "G",
      maxTokens: 16_000,
    };
    await expect(listGatewayModels(config)).resolves.toEqual(["claude-sonnet-4-6", "gpt-6-luna"]);
    await expect(
      listGatewayModels({ ...config, baseUrl: "https://other.test/v1" }).catch(() => "threw"),
    ).resolves.toEqual([]);
  });
});

/** A request that only ends when it is cancelled or runs out of time. */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });
}

describe("NVIDIA's API", () => {
  it("follows a 202 and polls the status until the answer is ready", async () => {
    let polls = 0;
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/chat/completions")) {
        return new Response("{}", { status: 202, headers: { "NVCF-REQID": "req-7" } });
      }
      polls += 1;
      return polls < 3
        ? new Response("{}", { status: 202, headers: { "NVCF-REQID": "req-7" } })
        : completion('{"verdict":"late","score":9}');
    });
    await expect(gateway("moonshotai/kimi-k3").run(request)).resolves.toEqual({
      verdict: "late",
      score: 9,
    });
    // Status polls are GETs without a body.
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toMatch(/\/v1\/chat\/completions$/);
    expect(urls.slice(1)).toEqual(
      Array(3).fill(urls[0]!.replace("/chat/completions", "/status/req-7")),
    );
    const poll = fetchMock.mock.calls[1]![1]!;
    expect(poll.method).toBe("GET");
    expect((poll.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("stops at the call's time budget with a message that names the model", async () => {
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 202, headers: { "NVCF-REQID": "req-8" } }),
    );
    serial += 1;
    const brain = new HurriedGateway({
      baseUrl: `https://gateway${serial}.test/v1`,
      apiKey: "sk-test",
      model: "moonshotai/kimi-k3",
      id: "custom",
      name: "NVIDIA",
      maxTokens: 16_000,
    });
    await expect(brain.run(request)).rejects.toMatchObject({
      code: "provider_timeout",
      message: expect.stringContaining("moonshotai/kimi-k3 may be too slow there"),
    });
  });

  it("rules out a route that does not answer a test image in time, and uses the next", async () => {
    const { host } = fakeHost();
    fetchMock.mockImplementation(async (url, init) => {
      const call = toCall(url, init);
      if (isMessagesApi(call.url)) return failure(404, "Not Found");
      if (isVisionCheck(call.body)) return isLink(call) ? hang(init) : readTestImage(call);
      return completion('{"verdict":"inline","score":1}');
    });
    serial += 1;
    const brain = new HurriedGateway(
      {
        baseUrl: `https://gateway${serial}.test/v1`,
        apiKey: "sk-test",
        model: "moonshotai/kimi-k3",
        id: "custom",
        name: "NVIDIA",
        maxTokens: 16_000,
      },
      host,
    );
    await expect(brain.run(withPhotos(2))).resolves.toEqual({ verdict: "inline", score: 1 });
    expect(imageRefs(calls().at(-1)!.body)[0]).toMatch(/^data:/);
  });

  it("says the model is too slow when no route answers a test image in time", async () => {
    // Like NVIDIA: no Anthropic messages endpoint, and chat completions never answer.
    fetchMock.mockImplementation(async (url, init) =>
      isMessagesApi(String(url)) ? failure(404, "Not Found") : hang(init),
    );
    serial += 1;
    const brain = new HurriedGateway({
      baseUrl: `https://gateway${serial}.test/v1`,
      apiKey: "sk-test",
      model: "moonshotai/kimi-k3",
      id: "custom",
      name: "NVIDIA",
      maxTokens: 16_000,
    });
    await expect(brain.run(withPhotos(1))).rejects.toMatchObject({
      code: "provider_timeout",
      message: expect.stringContaining("too slow for the garment photos"),
      detail: expect.stringContaining("messages inline: no Anthropic messages endpoint"),
    });
  });

  it("asks for as little thinking as possible in a test image, dropping what the model refuses", async () => {
    serve(['{"verdict":"ok","score":2}'], async (call) => {
      // Like Kimi K3 on NVIDIA: no Anthropic format, reasoning_effort but no chat_template_kwargs.
      if (isMessagesApi(call.url)) return failure(404, "Not Found");
      if (call.body.chat_template_kwargs) return refusedFields("chat_template_kwargs");
      return readTestImage(call);
    });
    await expect(gateway("moonshotai/kimi-k3").run(withPhotos(1))).resolves.toEqual({
      verdict: "ok",
      score: 2,
    });
    const checks = calls()
      .filter((call) => isVisionCheck(call.body) && !isMessagesApi(call.url))
      .map((call) => call.body);
    expect(checks[0]).toMatchObject({
      reasoning_effort: "low",
      chat_template_kwargs: { thinking: false, enable_thinking: false },
    });
    expect(checks.at(-1)).toMatchObject({ reasoning_effort: "low" });
    expect(checks.at(-1)).not.toHaveProperty("chat_template_kwargs");
    // Without a configured effort, the real call leaves the model's own default.
    const real = sentBodies().at(-1)!;
    expect(real).not.toHaveProperty("reasoning_effort");
  });

  it("turns thinking off for every call when the effort is off", async () => {
    fetchMock.mockResolvedValueOnce(completion('{"verdict":"ok","score":3}'));
    await gateway("google/gemma-4-31b-it", undefined, "off").run(request);
    expect(sentBodies()[0]).toMatchObject({
      reasoning_effort: "low",
      chat_template_kwargs: { thinking: false, enable_thinking: false },
    });
  });

  it("reads NVIDIA's error envelope and FastAPI validation lists", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 403, title: "Forbidden", detail: "Authorization failed" }),
        {
          status: 403,
        },
      ),
    );
    await expect(gateway().run(request)).rejects.toMatchObject({
      code: "provider_auth",
      detail: "Authorization failed",
    });
    fetchMock.mockImplementation(async () => refusedFields("tools"));
    await expect(gateway().run(request)).rejects.toMatchObject({
      code: "provider_bad_input",
      detail: "body.tools: Extra inputs are not permitted",
    });
  });

  it("puts the schema in the prompt at once when the API refuses response_format", async () => {
    fetchMock
      .mockResolvedValueOnce(refusedFields("response_format"))
      .mockResolvedValueOnce(completion('{"verdict":"ok","score":1}'))
      .mockResolvedValueOnce(completion('{"verdict":"again","score":2}'));
    const brain = gateway("deepseek-ai/deepseek-v4.1-flash");
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok", score: 1 });
    await expect(brain.run(request)).resolves.toEqual({ verdict: "again", score: 2 });
    const bodies = sentBodies();
    expect(bodies.map((body) => (body.response_format as { type?: string })?.type)).toEqual([
      "json_schema",
      undefined,
      undefined,
    ]);
    expect((bodies[1]!.messages as { content: string }[])[1]!.content).toContain(
      "Respond with JSON only",
    );
  });

  it("sends the configured reasoning effort, and drops it for a model that refuses it", async () => {
    // Kimi K3 takes reasoning_effort but not response_format.
    fetchMock
      .mockResolvedValueOnce(refusedFields("response_format"))
      .mockResolvedValueOnce(completion('{"verdict":"ok","score":1}'));
    await expect(gateway("moonshotai/kimi-k3", undefined, "high").run(request)).resolves.toEqual({
      verdict: "ok",
      score: 1,
    });
    expect(sentBodies().map((body) => body.reasoning_effort)).toEqual(["high", "high"]);

    // A model that takes neither loses both in one step, and remembers it.
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(refusedFields("reasoning_effort", "response_format"))
      .mockResolvedValueOnce(completion('{"verdict":"ok","score":2}'))
      .mockResolvedValueOnce(completion('{"verdict":"ok","score":3}'));
    const brain = gateway("google/gemma-4-31b-it", undefined, "high");
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok", score: 2 });
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok", score: 3 });
    const bodies = sentBodies();
    expect(bodies.map((body) => body.reasoning_effort)).toEqual(["high", undefined, undefined]);
    expect(bodies[2]!.response_format).toBeUndefined();

    // Without a configured effort, the field is never sent.
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(completion('{"verdict":"ok","score":4}'));
    await gateway().run(request);
    expect(sentBodies()[0]).not.toHaveProperty("reasoning_effort");
  });

  it("reads the JSON after reasoning written in think tags", async () => {
    const text =
      '<think>The answer needs {"verdict"} and a score.</think>\n{"verdict":"ok","score":7}';
    expect(extractJson(answerText(text))).toEqual({ verdict: "ok", score: 7 });
    fetchMock.mockResolvedValueOnce(completion(text));
    await expect(gateway().run(request)).resolves.toEqual({ verdict: "ok", score: 7 });
  });

  it("sends a test image big enough for every vision encoder, with room to reason", async () => {
    const test = await createVisionTest();
    const meta = await sharp(Buffer.from(test.request.images[0]!.base64, "base64")).metadata();
    // DeepSeek V4.1's vision encoder takes images of at least 295,936 pixels.
    expect(meta.width! * meta.height!).toBeGreaterThanOrEqual(295_936);
    expect(test.request.maxTokens).toBeGreaterThanOrEqual(16_000);
  });
});

describe("a service that takes one request at a time", () => {
  const oneAtATime = (host?: LlmImageHost) => {
    serial += 1;
    return new TestGateway(
      {
        baseUrl: `https://gateway${serial}.test/v1`,
        apiKey: "sk-test",
        model: "glm-4.6v-flash",
        id: "zai",
        name: "Z.ai",
        maxTokens: 16_000,
        maxConcurrent: 1,
        anthropicFormat: false,
      },
      host,
    );
  };

  it("tests the photo routes one after another, so no test comes back busy", async () => {
    const { host } = fakeHost();
    let inFlight = 0;
    let overlaps = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const call = toCall(url, init);
      inFlight += 1;
      if (inFlight > 1) {
        overlaps += 1;
        inFlight -= 1;
        return failure(429, "Concurrency limit reached");
      }
      // The service works on the request for a moment.
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return isVisionCheck(call.body)
        ? readTestImage(call)
        : completion('{"verdict":"ok","score":1}');
    });
    await expect(oneAtATime(host).run(withPhotos(2))).resolves.toEqual({ verdict: "ok", score: 1 });
    expect(overlaps).toBe(0);
    // Chat links read both test images, the messages routes were never tried, then the real call.
    expect(calls().map((call) => isMessagesApi(call.url))).toEqual([false, false, false]);
    expect(calls().filter((call) => isVisionCheck(call.body))).toHaveLength(2);
  });

  it("waits longer for a busy answer than for other services", async () => {
    let busy = 2;
    fetchMock.mockImplementation(async () => {
      if (busy > 0) {
        busy -= 1;
        return failure(429, "Concurrency limit reached");
      }
      return completion('{"verdict":"ok","score":3}');
    });
    await expect(oneAtATime().run(request)).resolves.toEqual({ verdict: "ok", score: 3 });
    expect(calls()).toHaveLength(3);
    // Any other service gets one retry, so the second busy answer is final.
    busy = 2;
    fetchMock.mockClear();
    await expect(gateway().run(request)).rejects.toMatchObject({ code: "provider_rate_limit" });
    expect(calls()).toHaveLength(2);
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
    "LLM_GATEWAY_REASONING_EFFORT",
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

  it("reads NVIDIA's settings, the reasoning effort included", () => {
    setEnv({
      LLM_GATEWAY_BASE_URL: "https://integrate.api.nvidia.com/v1",
      LLM_GATEWAY_API_KEY: "nvapi-test",
      LLM_GATEWAY_MODEL: "moonshotai/kimi-k3",
      LLM_GATEWAY_NAME: "NVIDIA",
      LLM_GATEWAY_REASONING_EFFORT: "High",
    });
    expect(llmGatewayConfig()).toMatchObject({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: "moonshotai/kimi-k3",
      name: "NVIDIA",
      reasoningEffort: "high",
    });
    setEnv({
      LLM_GATEWAY_BASE_URL: "https://integrate.api.nvidia.com/v1",
      LLM_GATEWAY_API_KEY: "nvapi-test",
      LLM_GATEWAY_REASONING_EFFORT: "very high!",
    });
    expect(llmGatewayConfig()?.reasoningEffort).toBeNull();
  });
});
