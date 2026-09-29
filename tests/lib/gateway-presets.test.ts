import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { keyStatus, llmGatewayConfigs, resetServerEnvCache } from "@/lib/env";
import { getDirectorBrain } from "@/lib/providers/llm";
import { ChainBrain } from "@/lib/providers/llm/chain";
import { fitImageCount, GatewayBrain, gatewayError } from "@/lib/providers/llm/gateway";
import type { StructuredRequest } from "@/lib/providers/llm/types";

const MANAGED = [
  "MISTRAL_API_KEY",
  "MISTRAL_MODEL",
  "ZAI_API_KEY",
  "ZAI_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "LLM_GATEWAY_BASE_URL",
  "LLM_GATEWAY_API_KEY",
  "LLM_GATEWAY_MODEL",
  "LLM_GATEWAY_NAME",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "APP_URL",
] as const;

function setEnv(values: Partial<Record<(typeof MANAGED)[number], string>>) {
  for (const name of MANAGED) vi.stubEnv(name, values[name] ?? "");
  resetServerEnvCache();
}

beforeEach(() => setEnv({}));
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("free gateway presets", () => {
  it("lists the configured services in the order the brain asks them", () => {
    setEnv({
      OPENROUTER_API_KEY: "or",
      ZAI_API_KEY: "z",
      MISTRAL_API_KEY: "m",
      LLM_GATEWAY_BASE_URL: "https://vyceai.test/v1",
      LLM_GATEWAY_API_KEY: "v",
      LLM_GATEWAY_MODEL: "gpt-6-luna",
      LLM_GATEWAY_NAME: "Vyce",
      APP_URL: "https://studio.example",
    });
    const configs = llmGatewayConfigs();
    expect(configs.map((config) => config.id)).toEqual(["mistral", "zai", "openrouter", "custom"]);
    expect(configs[0]).toMatchObject({
      name: "Mistral",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-small-latest",
      maxImages: 8,
      extraBody: { reasoning_effort: "none" },
    });
    expect(configs[1]).toMatchObject({
      name: "Z.ai",
      baseUrl: "https://api.z.ai/api/paas/v4",
      model: "glm-4.6v-flash",
      extraBody: { thinking: { type: "disabled" } },
    });
    expect(configs[2]).toMatchObject({
      name: "OpenRouter",
      model: "google/gemma-4-31b-it:free",
      headers: { "X-Title": "Dr. Secret Studio", "HTTP-Referer": "https://studio.example" },
    });
    expect(configs[3]).toMatchObject({ id: "custom", name: "Vyce", model: "gpt-6-luna" });
  });

  it("takes a model override per service and reports each key's status", () => {
    setEnv({ MISTRAL_API_KEY: "m", MISTRAL_MODEL: "mistral-medium-latest" });
    expect(llmGatewayConfigs()).toHaveLength(1);
    expect(llmGatewayConfigs()[0]?.model).toBe("mistral-medium-latest");
    expect(keyStatus()).toMatchObject({
      mistral: true,
      zai: false,
      openrouter: false,
      gateway: false,
    });
    expect(llmGatewayConfigs().map((config) => config.id)).not.toContain("zai");
  });
});

describe("fitImageCount", () => {
  const image = (caption: string) => ({ mimeType: "image/jpeg" as const, base64: "", caption });
  const request = (name: string, count: number): StructuredRequest<unknown> => ({
    name,
    system: "",
    user: "",
    images: Array.from({ length: count }, (_, index) => image(`Photo ${index + 1}`)),
    schema: z.unknown(),
    maxTokens: 1000,
  });

  it("keeps the first images, which the callers order by importance", () => {
    const fitted = fitImageCount(request("garment_dna", 12), 8);
    expect(fitted.images.map((item) => item.caption)).toEqual(
      Array.from({ length: 8 }, (_, index) => `Photo ${index + 1}`),
    );
  });

  it("keeps a fidelity review's result, the last image", () => {
    const fitted = fitImageCount(request("fidelity_review", 5), 3);
    expect(fitted.images.map((item) => item.caption)).toEqual(["Photo 1", "Photo 2", "Photo 5"]);
  });

  it("changes nothing without a cap or within it", () => {
    const within = request("garment_dna", 3);
    expect(fitImageCount(within, 8)).toBe(within);
    expect(fitImageCount(within, null)).toBe(within);
  });
});

describe("GatewayBrain with a preset", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the service's extra fields and headers with every call", async () => {
    class Probe extends GatewayBrain {
      run<T>(request: StructuredRequest<T>) {
        return this.structured(request);
      }
    }
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"ok":1}' } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const brain = new Probe({
      id: "zai",
      name: "Z.ai",
      baseUrl: "https://api.z.ai/api/paas/v4",
      apiKey: "zk",
      model: "glm-4.6v-flash",
      maxTokens: 16_000,
      reasoningEffort: "high",
      thinkingFields: false,
      extraBody: { thinking: { type: "disabled" } },
      headers: { "X-Title": "Dr. Secret Studio" },
    });
    await brain.run({
      name: "probe",
      system: "s",
      user: "u",
      images: [],
      schema: z.object({ ok: z.number() }),
      maxTokens: 1000,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Title"]).toBe("Dr. Secret Studio");
    expect(headers.Authorization).toBe("Bearer zk");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "glm-4.6v-flash", thinking: { type: "disabled" } });
    // A known service's model has its own defaults: no generic reasoning fields.
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("chat_template_kwargs");
  });

  it("reads Mistral's validation list, which sits inside message", async () => {
    const response = new Response(
      JSON.stringify({
        object: "error",
        message: {
          detail: [
            {
              type: "extra_forbidden",
              loc: ["body", "reasoning_effort"],
              msg: "Extra inputs are not permitted",
              input: "low",
            },
          ],
        },
        type: "invalid_request_error",
        code: "1000",
      }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
    const error = await gatewayError(response, "Mistral", "mistral-small-latest");
    expect(error.detail).toBe("body.reasoning_effort: Extra inputs are not permitted");
  });
});

describe("brain selection with free gateways", () => {
  it("chains every configured brain, the chosen one first", () => {
    setEnv({ MISTRAL_API_KEY: "m", ZAI_API_KEY: "z", GEMINI_API_KEY: "g" });
    const brain = getDirectorBrain({ llmProvider: "gateway" });
    expect(brain).toBeInstanceOf(ChainBrain);
    expect((brain as ChainBrain).order).toEqual([
      "Mistral · mistral-small-latest",
      "Z.ai · glm-4.6v-flash",
      "Gemini · gemini-flash-latest",
    ]);
    expect(brain.provider).toBe("gateway");
    const geminiFirst = getDirectorBrain({ llmProvider: "gemini" }) as ChainBrain;
    expect(geminiFirst.order[0]).toBe("Gemini · gemini-flash-latest");
    expect(geminiFirst.provider).toBe("gemini");
  });

  it("uses a single configured brain as it is", () => {
    setEnv({ ZAI_API_KEY: "z" });
    const brain = getDirectorBrain({ llmProvider: "claude" });
    expect(brain).toBeInstanceOf(GatewayBrain);
    expect(brain).toMatchObject({ provider: "gateway", model: "glm-4.6v-flash", name: "Z.ai" });
  });
});
