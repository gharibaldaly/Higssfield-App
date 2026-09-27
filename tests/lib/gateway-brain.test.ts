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
import type { StructuredRequest } from "@/lib/providers/llm/types";

const answerSchema = z.object({ verdict: z.string(), score: z.number() });

class TestGateway extends GatewayBrain {
  run<T>(request: StructuredRequest<T>): Promise<T> {
    return this.structured(request);
  }
}

let serial = 0;
function gateway(model = `model-${(serial += 1)}`) {
  return new TestGateway({
    baseUrl: `https://gateway${serial}.test/v1`,
    apiKey: "sk-test",
    model,
    name: "TestGate",
    maxTokens: 16_000,
  });
}

const request: StructuredRequest<z.infer<typeof answerSchema>> = {
  name: "fidelity review",
  system: "You check garments.",
  user: "Compare the photos.",
  images: [{ mimeType: "image/jpeg", base64: "QUJD", caption: "Original — front" }],
  schema: answerSchema,
  maxTokens: 32_000,
};

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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GatewayBrain", () => {
  it("sends the photos as image parts and asks for the schema as JSON", async () => {
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
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[0]).toEqual({ role: "system", content: "You check garments." });
    expect(messages[1]!.content).toEqual([
      { type: "text", text: "Original — front" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
      { type: "text", text: "Compare the photos." },
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
    const lastUser = (bodies[3]!.messages as { content: { text?: string }[] }[])[1]!.content;
    expect(lastUser.at(-1)?.text).toContain("Respond with JSON only");
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
    const repair = (sentBodies()[1]!.messages as { content: { text?: string }[] }[])[1]!.content;
    expect(repair.at(-1)?.text).toContain("did not match the required JSON schema");
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
