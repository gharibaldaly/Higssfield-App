import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { adPlanSchema } from "@/lib/domain/ad-plan";
import { DEFAULT_CATALOGUE_STYLE } from "@/lib/domain/catalogue-style";
import { garmentDnaSchema } from "@/lib/domain/garment-dna";
import { photoClassificationSchema } from "@/lib/domain/photo-classification";
import { AppError } from "@/lib/errors";
import { mapAnthropicError } from "@/lib/providers/llm/claude";
import {
  FALLBACK_GEMINI_MODELS,
  forgetSpentGeminiModels,
  GeminiBrain,
  geminiJsonSchema,
  mapGeminiError,
} from "@/lib/providers/llm/gemini";
import {
  cairoTime,
  describeQuota,
  geminiQuota,
  nextPacificMidnight,
} from "@/lib/providers/llm/gemini-errors";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import { ghostScenePromptSchema, type StructuredRequest } from "@/lib/providers/llm/types";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

describe("Gemini structured output schema", () => {
  it("inlines the whole schema without $schema or $ref", () => {
    for (const schema of [
      garmentDnaSchema,
      adPlanSchema,
      photoClassificationSchema,
      ghostScenePromptSchema,
    ]) {
      const json = geminiJsonSchema(schema);
      const text = JSON.stringify(json);
      expect(json.$schema).toBeUndefined();
      expect(text).not.toContain("$ref");
      expect(json.type).toBe("object");
    }
  });
});

describe("provider error mapping", () => {
  it("maps Gemini API errors to user-facing codes, with Google's own message", () => {
    const code = (status: number) =>
      (mapGeminiError(new ApiError({ message: "x", status })) as AppError).code;
    expect(code(401)).toBe("provider_auth");
    expect(code(404)).toBe("not_found");
    expect(code(429)).toBe("provider_rate_limit");
    expect(code(503)).toBe("provider_unavailable");
    expect(code(400)).toBe("provider_bad_input");
    const overloaded = mapGeminiError(
      new ApiError({ message: "The model is overloaded. Please try again later.", status: 503 }),
    ) as AppError;
    expect(overloaded).toMatchObject({
      status: 503,
      detail: "The model is overloaded. Please try again later.",
    });
  });

  it("maps Anthropic SDK errors to user-facing codes", () => {
    const headers = new Headers();
    const auth = Anthropic.APIError.generate(
      401,
      { error: { message: "bad key" } },
      "bad key",
      headers,
    );
    const rate = Anthropic.APIError.generate(
      429,
      { error: { message: "slow down" } },
      "slow down",
      headers,
    );
    const bad = Anthropic.APIError.generate(400, { error: { message: "bad" } }, "bad", headers);
    const overloaded = Anthropic.APIError.generate(
      529,
      { error: { message: "overloaded" } },
      "overloaded",
      headers,
    );
    expect((mapAnthropicError(auth) as AppError).code).toBe("provider_auth");
    expect((mapAnthropicError(rate) as AppError).code).toBe("provider_rate_limit");
    expect((mapAnthropicError(bad) as AppError).code).toBe("provider_bad_input");
    expect((mapAnthropicError(overloaded) as AppError).retryable).toBe(true);
    expect((mapAnthropicError(new Anthropic.AnthropicError("parse failed")) as AppError).code).toBe(
      "llm_output",
    );
    const passthrough = new Error("other");
    expect(mapAnthropicError(passthrough)).toBe(passthrough);
  });
});

/** Minimal provider that answers from a queue, to exercise the shared template logic. */
class ScriptedBrain extends TemplateBrain {
  readonly provider = "claude" as const;
  readonly model = "scripted";
  readonly requests: StructuredRequest<unknown>[] = [];

  constructor(private readonly answers: (unknown | Error)[]) {
    super();
  }

  protected async generate<T>(request: StructuredRequest<T>): Promise<T> {
    this.requests.push(request as StructuredRequest<unknown>);
    const answer = this.answers.shift();
    if (answer instanceof Error) throw answer;
    return request.schema.parse(answer);
  }
}

describe("TemplateBrain", () => {
  const ghostInput = {
    product: {
      name: "Robe",
      productLine: "SECRET" as const,
      notes: null,
      pieces: [{ position: 1, name: "Robe" }],
    },
    dna: { ...ROBE_SET_DNA, pieces: [ROBE_SET_DNA.pieces[0]!] },
    view: "front" as const,
    style: DEFAULT_CATALOGUE_STYLE,
    detail: null,
    colorway: null,
    references: [{ mimeType: "image/jpeg" as const, base64: "", caption: "Robe front photo" }],
    referenceMode: "edit" as const,
    note: null,
    promptBudget: 6000,
  };

  it("repairs one invalid structured answer", async () => {
    const brain = new ScriptedBrain([
      new AppError("llm_output", "bad shape", { detail: "instruction: required" }),
      {
        instruction: "A sexy mannequin shot of the robe.",
        mustKeep: ["exactly 5 pearl buttons at centre front.", " "],
        cleanUp: ["the wooden hanger"],
        extraNegatives: ["no belt"],
        rationale: "",
      },
    ]);
    const built = await brain.buildGhostPrompt(ghostInput);
    expect(brain.requests).toHaveLength(2);
    expect(brain.requests[1]?.user).toContain(
      "did not match the required JSON schema (instruction: required)",
    );
    expect(built.scene).toBe(
      "A sexy mannequin shot of the robe.\nKEEP EXACTLY — exactly 5 pearl buttons at centre front.\nLEAVE OUT (photo artefacts only, never design details) — the wooden hanger.",
    );
    expect(built.prompt.startsWith("A elegant invisible display form shot of the robe.")).toBe(
      true,
    );
    expect(built.prompt).toContain("no belt.");
    expect(built.negativePrompt).toContain("no belt");
    expect(built.negativePrompt).toContain("grey background");
  });

  it("shows the reference photos to the brain and appends the house style", async () => {
    const brain = new ScriptedBrain([
      { instruction: "Front view.", mustKeep: [], cleanUp: [], extraNegatives: [], rationale: "" },
    ]);
    const built = await brain.buildGhostPrompt(ghostInput);
    expect(brain.requests[0]?.images.map((image) => image.caption)).toEqual(["Robe front photo"]);
    expect(brain.requests[0]?.user).toContain("Mode: EDIT");
    expect(brain.requests[0]?.user).toContain("1. Robe front photo");
    const house = built.prompt.indexOf("HOUSE STYLE");
    const lock = built.prompt.indexOf("PRODUCT LOCK");
    const negatives = built.prompt.indexOf("STRICT NEGATIVES");
    expect(house).toBeGreaterThan(0);
    expect(house).toBeLessThan(lock);
    expect(lock).toBeLessThan(negatives);
    expect(built.prompt).toContain("Seamless pure white #FFFFFF background");
    expect(built.prompt).toContain("no hanger, hook, clip, peg or pin anywhere in the image");
    expect(built.promptVersion).toBe("ghost@2.1.0");
  });

  it("keeps one in-range answer per photo when sorting views", async () => {
    const brain = new ScriptedBrain([
      {
        photos: [
          { index: 2, view: "back", label: "back", clarity: 4 },
          { index: 2, view: "front", label: "dup", clarity: 5 },
          { index: 7, view: "detail", label: "out of range", clarity: 3 },
          { index: 1, view: "front", label: "front", clarity: 5 },
        ],
      },
    ]);
    const result = await brain.classifyPhotos({
      product: ghostInput.product,
      photos: [
        { mimeType: "image/jpeg", base64: "", caption: "Photo 1" },
        { mimeType: "image/jpeg", base64: "", caption: "Photo 2" },
      ],
    });
    expect(result.photos.map((photo) => [photo.index, photo.view])).toEqual([
      [2, "back"],
      [1, "front"],
    ]);
  });

  it("does not retry provider failures", async () => {
    const brain = new ScriptedBrain([new AppError("provider_auth", "bad key")]);
    await expect(
      brain.planAd({
        brief: "",
        product: {
          name: "Robe",
          productLine: "SECRET",
          notes: null,
          pieces: [{ position: 1, name: "Robe" }],
        },
        dna: ROBE_SET_DNA,
        controlsDescription: "",
        rules: [],
        crops: [],
        video: {
          totalDurationS: 15,
          maxShotDurationS: 3,
          aspectRatio: "9:16",
          modelLabel: "x",
          durationOptions: null,
        },
        targetShotCount: 3,
        humanModel: false,
      }),
    ).rejects.toMatchObject({ code: "provider_auth" });
    expect(brain.requests).toHaveLength(1);
  });

  it("refuses to analyse without photos", async () => {
    const brain = new ScriptedBrain([]);
    await expect(
      brain.analyzeGarment({
        product: {
          name: "Robe",
          productLine: "SECRET",
          notes: null,
          pieces: [{ position: 1, name: "Robe" }],
        },
        photos: [],
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});

describe("Gemini brain", () => {
  const answerSchema = z.object({ verdict: z.string() });
  const request: StructuredRequest<{ verdict: string }> = {
    name: "fidelity review",
    system: "You check garments.",
    user: "Compare the photos.",
    images: [{ mimeType: "image/jpeg", base64: "QUJD", caption: "Front" }],
    schema: answerSchema,
    maxTokens: 8000,
  };

  class TestGemini extends GeminiBrain {
    readonly pauses: number[] = [];
    run<T>(structured: StructuredRequest<T>): Promise<T> {
      return this.structured(structured);
    }
    protected override pause(ms: number): Promise<void> {
      this.pauses.push(ms);
      return Promise.resolve();
    }
  }

  type Call = { model: string; schema: boolean };
  type Config = {
    responseMimeType?: string;
    responseJsonSchema?: unknown;
    thinkingConfig?: { thinkingLevel?: string };
    maxOutputTokens?: number;
  };
  /** A Gemini stand-in: `reply` decides per call, from the model and whether a schema was sent. */
  function gemini(reply: (call: Call) => unknown) {
    const calls: Call[] = [];
    const configs: Config[] = [];
    const brain = new TestGemini("key", "gemini-flash-latest");
    (brain as unknown as { ai: unknown }).ai = {
      models: {
        generateContent: async (params: { model: string; config?: Config }) => {
          const call = { model: params.model, schema: Boolean(params.config?.responseJsonSchema) };
          calls.push(call);
          configs.push(params.config ?? {});
          const outcome = reply(call);
          if (outcome instanceof Error) throw outcome;
          return { text: outcome, candidates: [{ finishReason: "STOP" }] };
        },
      },
    };
    return { brain, calls, configs };
  }

  // Models whose daily limit ran out are remembered per server instance.
  beforeEach(() => forgetSpentGeminiModels());
  afterEach(() => vi.useRealTimers());

  const overloaded = () => new ApiError({ message: "The model is overloaded.", status: 503 });

  it("asks an earlier Flash model when the chosen one stays overloaded", async () => {
    const { brain, calls } = gemini((call) =>
      call.model === "gemini-flash-latest" ? overloaded() : '{"verdict":"ok"}',
    );
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok" });
    expect(calls).toEqual([
      { model: "gemini-flash-latest", schema: true },
      { model: "gemini-3.7-flash", schema: true },
    ]);
  });

  it("retries a server failure with the schema in the prompt instead", async () => {
    const { brain, calls } = gemini((call) =>
      call.schema ? new ApiError({ message: "Internal error", status: 500 }) : '{"verdict":"ok"}',
    );
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok" });
    expect(calls).toEqual([
      { model: "gemini-flash-latest", schema: true },
      { model: "gemini-flash-latest", schema: false },
    ]);
  });

  it("skips a fallback model that no longer exists", async () => {
    const { brain, calls } = gemini((call) => {
      if (call.model === "gemini-flash-latest") return overloaded();
      if (call.model === "gemini-3.7-flash") {
        return new ApiError({ message: "models/gemini-3.7-flash is not found", status: 404 });
      }
      return '{"verdict":"ok"}';
    });
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok" });
    expect(calls.map((call) => call.model)).toEqual([
      "gemini-flash-latest",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
    ]);
    expect(brain.model).toBe("gemini-3.6-flash");
  });

  it("reports what Google said when no model answers", async () => {
    const { brain } = gemini(() => overloaded());
    await expect(brain.run(request)).rejects.toMatchObject({
      code: "provider_unavailable",
      status: 503,
      detail: ["gemini-flash-latest", ...FALLBACK_GEMINI_MODELS]
        .map((model) => `${model}: The model is overloaded.`)
        .join(" · "),
    });
  });

  it("does not switch models for a key problem", async () => {
    const { brain, calls } = gemini(
      () => new ApiError({ message: "API key not valid.", status: 403 }),
    );
    await expect(brain.run(request)).rejects.toMatchObject({ code: "provider_auth" });
    expect(calls).toHaveLength(1);
  });

  it("moves to the next Flash model when the chosen one has used up its daily quota", async () => {
    const { brain, calls } = gemini((call) =>
      call.model === "gemini-flash-latest"
        ? quotaExceeded("gemini-3.8-flash", "Day", "5s")
        : '{"verdict":"ok"}',
    );
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok" });
    expect(calls.map((call) => call.model)).toEqual(["gemini-flash-latest", "gemini-3.7-flash"]);
    // A daily limit is not waited out, even though Google suggests a short retry.
    expect(brain.pauses).toEqual([]);
    // What the brain wrote is recorded under the model that wrote it.
    expect(brain.model).toBe("gemini-3.7-flash");
  });

  it("waits out a short per-minute limit and asks the same model again", async () => {
    let limited = true;
    const { brain, calls } = gemini(() => {
      if (!limited) return '{"verdict":"ok"}';
      limited = false;
      return quotaExceeded("gemini-3.8-flash", "Minute", "12s");
    });
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok" });
    expect(brain.pauses).toEqual([13_000]);
    expect(calls.map((call) => call.model)).toEqual(["gemini-flash-latest", "gemini-flash-latest"]);
    expect(brain.model).toBe("gemini-flash-latest");
  });

  it("asks the next model instead of waiting out a long per-minute limit", async () => {
    const { brain, calls } = gemini((call) =>
      call.model === "gemini-flash-latest"
        ? quotaExceeded("gemini-3.8-flash", "Minute", "58s")
        : '{"verdict":"ok"}',
    );
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok" });
    expect(brain.pauses).toEqual([]);
    expect(calls.map((call) => call.model)).toEqual(["gemini-flash-latest", "gemini-3.7-flash"]);
  });

  it("says when the daily limit resets once every free model has used it up", async () => {
    const { brain, calls } = gemini((call) =>
      quotaExceeded(call.model === "gemini-flash-latest" ? "gemini-3.8-flash" : call.model, "Day"),
    );
    const error = await brain.run(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "provider_rate_limit",
      status: 429,
      detail: ["gemini-3.8-flash", ...FALLBACK_GEMINI_MODELS]
        .map((model) => `${model}: 20 requests a day (free tier)`)
        .join(" · "),
    });
    expect((error as AppError).message).toMatch(
      /^Gemini's daily limit is used up for every free model the studio tries\. It resets at midnight Pacific time \(\d\d:\d\d Cairo time\)\./,
    );
    expect(calls).toHaveLength(1 + FALLBACK_GEMINI_MODELS.length);

    // The next request asks nobody: every model is remembered as spent.
    await expect(brain.run(request)).rejects.toMatchObject({
      code: "provider_rate_limit",
      message: (error as AppError).message,
    });
    expect(calls).toHaveLength(1 + FALLBACK_GEMINI_MODELS.length);
  });

  it("keeps to free models, from Flash down to Flash-Lite and Gemma", () => {
    expect(FALLBACK_GEMINI_MODELS).toEqual([
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemma-4-31b-it",
      "gemma-4-26b-a4b-it",
    ]);
  });

  it("asks Gemma in plain text, without thinking, once every Gemini model has used up its day", async () => {
    const { brain, calls, configs } = gemini((call) =>
      call.model.startsWith("gemma-")
        ? '```json\n{"verdict":"ok"}\n```'
        : quotaExceeded(
            call.model === "gemini-flash-latest" ? "gemini-3.8-flash" : call.model,
            "Day",
          ),
    );
    await expect(brain.run({ ...request, maxTokens: 32_000 })).resolves.toEqual({
      verdict: "ok",
    });
    expect(calls.map((call) => call.model)).toEqual([
      "gemini-flash-latest",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemma-4-31b-it",
    ]);
    // Gemini models answer in JSON mode with the schema; Gemma's page documents neither.
    expect(configs[0]).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens: 32_000,
    });
    expect(configs[0]).not.toHaveProperty("thinkingConfig");
    const gemma = configs.at(-1)!;
    expect(gemma).not.toHaveProperty("responseMimeType");
    expect(gemma).not.toHaveProperty("responseJsonSchema");
    expect(gemma).toMatchObject({ thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(gemma.maxOutputTokens).toBe(8192);
    expect(brain.model).toBe("gemma-4-31b-it");
  });

  it("reads Gemma's answer after its thought channel", async () => {
    const { brain } = gemini((call) =>
      call.model === "gemma-4-31b-it"
        ? '<|channel>thought\nThe verdict {draft}.<channel|>{"verdict":"ok"}'
        : overloaded(),
    );
    await expect(brain.run(request)).resolves.toEqual({ verdict: "ok" });
  });

  it("skips a model whose daily limit ran out until Google resets it, for an hour at most", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
    const { brain, calls } = gemini((call) =>
      call.model === "gemini-flash-latest"
        ? quotaExceeded("gemini-3.8-flash", "Day")
        : '{"verdict":"ok"}',
    );
    await brain.run(request);
    await brain.run(request);
    expect(calls.map((call) => call.model)).toEqual([
      "gemini-flash-latest",
      "gemini-3.7-flash",
      // The second request goes straight to the next model.
      "gemini-3.7-flash",
    ]);
    expect(brain.model).toBe("gemini-3.7-flash");

    // An hour later the chosen model is asked again (billing may have lifted the limit).
    vi.setSystemTime(new Date("2026-09-28T13:00:01Z"));
    await brain.run(request);
    expect(calls.map((call) => call.model).slice(3)).toEqual([
      "gemini-flash-latest",
      "gemini-3.7-flash",
    ]);
  });

  it("does not remember a per-minute limit", async () => {
    const { brain, calls } = gemini((call) =>
      call.model === "gemini-flash-latest"
        ? quotaExceeded("gemini-3.8-flash", "Minute", "58s")
        : '{"verdict":"ok"}',
    );
    await brain.run(request);
    await brain.run(request);
    expect(calls.map((call) => call.model)).toEqual([
      "gemini-flash-latest",
      "gemini-3.7-flash",
      "gemini-flash-latest",
      "gemini-3.7-flash",
    ]);
  });
});

/** Google's 429 body, as the Gemini API sends it and the SDK passes it on. */
function quotaExceeded(model: string, window: "Day" | "Minute", retryDelay = "41s") {
  return new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        message:
          "You exceeded your current quota, please check your plan and billing details. For more " +
          "information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. " +
          "To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for " +
          `metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: ${model}\n` +
          `Please retry in ${retryDelay.replace("s", ".53s")}.`,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.Help",
            links: [
              {
                description: "Learn more about Gemini API quotas",
                url: "https://ai.google.dev/gemini-api/docs/rate-limits",
              },
            ],
          },
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaMetric:
                  "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaId: `GenerateRequestsPer${window}PerProjectPerModel-FreeTier`,
                quotaDimensions: { location: "global", model },
                quotaValue: "20",
              },
            ],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
        ],
      },
    }),
  });
}

describe("Gemini quota errors", () => {
  it("reads the limit, window, model and retry delay from Google's 429", () => {
    expect(geminiQuota(quotaExceeded("gemini-3.8-flash", "Day", "5s"))).toEqual({
      window: "day",
      unit: "requests",
      limit: 20,
      model: "gemini-3.8-flash",
      freeTier: true,
      retryAfterMs: 5000,
    });
    expect(geminiQuota(quotaExceeded("gemini-3.8-flash", "Minute", "12s"))).toMatchObject({
      window: "minute",
      retryAfterMs: 12_000,
    });
  });

  it("prefers the daily limit when a request hits both", () => {
    const body = JSON.parse(quotaExceeded("gemini-3.8-flash", "Minute").message);
    body.error.details[1].violations.push({
      quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      quotaValue: "20",
    });
    const error = new ApiError({ status: 429, message: JSON.stringify(body) });
    expect(geminiQuota(error)?.window).toBe("day");
  });

  it("falls back to the message when the details are missing", () => {
    const error = new ApiError({
      status: 429,
      message:
        "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000, model: gemini-3.8-flash\nPlease retry in 548ms.",
    });
    expect(geminiQuota(error)).toEqual({
      window: null,
      unit: "tokens",
      limit: 250_000,
      model: "gemini-3.8-flash",
      freeTier: true,
      retryAfterMs: 548,
    });
    expect(geminiQuota(new ApiError({ status: 500, message: "x" }))).toBeNull();
  });

  it("names the limit in the error instead of Google's boilerplate", () => {
    const daily = mapGeminiError(quotaExceeded("gemini-3.8-flash", "Day")) as AppError;
    expect(daily).toMatchObject({
      code: "provider_rate_limit",
      detail: "gemini-3.8-flash: 20 requests a day (free tier)",
      retryable: true,
    });
    expect(daily.message).toMatch(/^Gemini's daily limit for this model is used up\./);
    const minute = mapGeminiError(quotaExceeded("gemini-3.8-flash", "Minute")) as AppError;
    expect(minute.message).toBe("Gemini's per-minute limit was reached. Try again in a minute.");
    expect(describeQuota({ ...geminiQuota(quotaExceeded("m", "Minute"))!, model: null })).toBe(
      "20 requests a minute (free tier)",
    );
  });

  it("shows Google's message rather than the raw JSON for other errors", () => {
    const error = new ApiError({
      status: 503,
      message: JSON.stringify({
        error: {
          code: 503,
          message: "The model is overloaded. Please try again later.",
          status: "UNAVAILABLE",
        },
      }),
    });
    expect(mapGeminiError(error)).toMatchObject({
      code: "provider_unavailable",
      detail: "The model is overloaded. Please try again later.",
    });
  });

  it("knows when the daily limit resets, in Cairo time", () => {
    // Summer: Pacific midnight is 07:00 UTC, 10:00 in Cairo.
    const summer = nextPacificMidnight(new Date("2026-09-28T06:59:00Z"));
    expect(summer.toISOString()).toBe("2026-09-28T07:00:00.000Z");
    expect(cairoTime(summer)).toBe("10:00 Cairo time");
    const later = nextPacificMidnight(new Date("2026-09-28T07:00:01Z"));
    expect(later.toISOString()).toBe("2026-09-29T07:00:00.000Z");
    // Winter: Pacific midnight is 08:00 UTC, 10:00 in Cairo.
    const winter = nextPacificMidnight(new Date("2026-12-15T12:00:00Z"));
    expect(winter.toISOString()).toBe("2026-12-16T08:00:00.000Z");
    expect(cairoTime(winter)).toBe("10:00 Cairo time");
  });
});
