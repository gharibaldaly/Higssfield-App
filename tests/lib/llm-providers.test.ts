import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";

import { adPlanSchema } from "@/lib/domain/ad-plan";
import { garmentDnaSchema } from "@/lib/domain/garment-dna";
import { AppError } from "@/lib/errors";
import { mapAnthropicError } from "@/lib/providers/llm/claude";
import { geminiJsonSchema, mapGeminiError } from "@/lib/providers/llm/gemini";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type { StructuredRequest } from "@/lib/providers/llm/types";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

describe("Gemini structured output schema", () => {
  it("inlines the whole schema without $schema or $ref", () => {
    for (const schema of [garmentDnaSchema, adPlanSchema]) {
      const json = geminiJsonSchema(schema);
      const text = JSON.stringify(json);
      expect(json.$schema).toBeUndefined();
      expect(text).not.toContain("$ref");
      expect(json.type).toBe("object");
    }
  });
});

describe("provider error mapping", () => {
  it("maps Gemini API errors to user-facing codes", () => {
    const code = (status: number) =>
      (mapGeminiError(new ApiError({ message: "x", status })) as AppError).code;
    expect(code(401)).toBe("provider_auth");
    expect(code(429)).toBe("provider_rate_limit");
    expect(code(503)).toBe("provider_unavailable");
    expect(code(400)).toBe("provider_bad_input");
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
  it("repairs one invalid structured answer", async () => {
    const brain = new ScriptedBrain([
      new AppError("llm_output", "bad shape", { detail: "scene: required" }),
      { scene: "A sexy mannequin shot of the robe.", extraNegatives: ["no belt"], rationale: "" },
    ]);
    const built = await brain.buildGhostPrompt({
      product: {
        name: "Robe",
        productLine: "SECRET",
        notes: null,
        pieces: [{ position: 1, name: "Robe" }],
      },
      dna: { ...ROBE_SET_DNA, pieces: [ROBE_SET_DNA.pieces[0]!] },
      view: "front",
      styleDescription: "",
      detail: null,
      colorway: null,
      referenceCaptions: [],
      note: null,
      promptBudget: 4000,
    });
    expect(brain.requests).toHaveLength(2);
    expect(brain.requests[1]?.user).toContain(
      "did not match the required JSON schema (scene: required)",
    );
    expect(built.scene).toBe("A sexy mannequin shot of the robe.");
    expect(built.prompt.startsWith("A elegant invisible display form shot of the robe.")).toBe(
      true,
    );
    expect(built.prompt).toContain("Also: no belt.");
    expect(built.negativePrompt).toContain("no belt");
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
