import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adPlanSchema } from "@/lib/domain/ad-plan";
import { DEFAULT_CATALOGUE_STYLE } from "@/lib/domain/catalogue-style";
import { garmentDnaSchema } from "@/lib/domain/garment-dna";
import { photoClassificationSchema } from "@/lib/domain/photo-classification";
import { AppError } from "@/lib/errors";
import { mapAnthropicError } from "@/lib/providers/llm/claude";
import { GeminiBrain, geminiJsonSchema, mapGeminiError } from "@/lib/providers/llm/gemini";
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
    expect(built.promptVersion).toBe("ghost@2.0.0");
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
    run<T>(structured: StructuredRequest<T>): Promise<T> {
      return this.structured(structured);
    }
  }

  type Call = { model: string; schema: boolean };
  /** A Gemini stand-in: `reply` decides per call, from the model and whether a schema was sent. */
  function gemini(reply: (call: Call) => unknown) {
    const calls: Call[] = [];
    const brain = new TestGemini("key", "gemini-flash-latest");
    (brain as unknown as { ai: unknown }).ai = {
      models: {
        generateContent: async (params: {
          model: string;
          config?: { responseJsonSchema?: unknown };
        }) => {
          const call = { model: params.model, schema: Boolean(params.config?.responseJsonSchema) };
          calls.push(call);
          const outcome = reply(call);
          if (outcome instanceof Error) throw outcome;
          return { text: outcome, candidates: [{ finishReason: "STOP" }] };
        },
      },
    };
    return { brain, calls };
  }

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
      "gemini-3.5-flash",
    ]);
  });

  it("reports what Google said when no Flash model answers", async () => {
    const { brain } = gemini(() => overloaded());
    await expect(brain.run(request)).rejects.toMatchObject({
      code: "provider_unavailable",
      status: 503,
      detail: expect.stringMatching(
        /^The model is overloaded\. · gemini-3\.7-flash: The model is overloaded\. · gemini-3\.5-flash:/,
      ),
    });
  });

  it("does not switch models for a key or quota problem", async () => {
    const { brain, calls } = gemini(
      () => new ApiError({ message: "Quota exceeded for requests per day", status: 429 }),
    );
    await expect(brain.run(request)).rejects.toMatchObject({
      code: "provider_rate_limit",
      detail: "Quota exceeded for requests per day",
    });
    expect(calls).toHaveLength(1);
  });
});
