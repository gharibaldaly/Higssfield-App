import { adPlanSchema, type AdPlan } from "@/lib/domain/ad-plan";
import { fidelityReviewSchema, type FidelityReview } from "@/lib/domain/fidelity";
import { garmentDnaSchema, normalizeGarmentDna, type GarmentDna } from "@/lib/domain/garment-dna";
import {
  enforceSheetRules,
  SHEET_DESIGN,
  sheetPlanSchema,
  type SheetPlan,
} from "@/lib/domain/sheet";
import { AppError, isAppError } from "@/lib/errors";
import {
  composeGenerationPrompt,
  NEGATIVE_PROMPT_TERMS,
  type LockView,
} from "@/lib/prompts/blocks";
import { PROMPTS, templateVersion } from "@/lib/prompts";
import type {
  AnalyzeGarmentInput,
  BuiltPrompt,
  BuiltSheetPrompt,
  DirectorBrain,
  GhostPromptInput,
  LlmProviderId,
  PlanAdInput,
  ReviewFidelityInput,
  ScenePrompt,
  SheetPromptInput,
  ShotPromptInput,
  StructuredRequest,
} from "@/lib/providers/llm/types";
import { scenePromptSchema } from "@/lib/providers/llm/types";
import { neutralizeWording } from "@/lib/prompts/wording";
import { computeSheetLayout, describeLayout } from "@/lib/sheet/layout";

const GHOST_LOCK_VIEW: Record<GhostPromptInput["view"], LockView> = {
  front: "front",
  back: "back",
  macro: "detail",
  colorway: "front",
};

function negativePrompt(extra: string[]): string {
  const extras = extra.map((item) => item.trim()).filter(Boolean);
  return neutralizeWording(
    extras.length > 0 ? `${NEGATIVE_PROMPT_TERMS}, ${extras.join(", ")}` : NEGATIVE_PROMPT_TERMS,
  );
}

/**
 * Shared implementation of the director brain. Providers only implement
 * `generate` (one structured JSON call); prompt templates, validation, and
 * the PRODUCT LOCK / STRICT NEGATIVES composition live here so every provider
 * — including the mock — produces prompts with the same guarantees.
 */
export abstract class TemplateBrain implements DirectorBrain {
  abstract readonly provider: LlmProviderId;
  abstract readonly model: string;

  protected abstract generate<T>(request: StructuredRequest<T>): Promise<T>;

  /** One repair attempt when the model returns JSON that fails validation. */
  protected async structured<T>(request: StructuredRequest<T>): Promise<T> {
    try {
      return await this.generate(request);
    } catch (error) {
      if (!isAppError(error) || error.code !== "llm_output") throw error;
      return this.generate({
        ...request,
        user: `${request.user}\n\nYour previous answer did not match the required JSON schema (${
          error.detail ?? error.message
        }). Return only valid JSON that matches the schema exactly.`,
      });
    }
  }

  // --- LLM calls (overridable by the mock) ---------------------------------

  protected askGarmentDna(input: AnalyzeGarmentInput): Promise<GarmentDna> {
    const template = PROMPTS.analyzeGarment;
    if (input.photos.length === 0) {
      throw new AppError("validation", "Upload at least one photo before analysing the garment.");
    }
    return this.structured({
      name: "garment_dna",
      system: template.system,
      user: template.render(input),
      images: input.photos,
      schema: garmentDnaSchema,
      maxTokens: 32_000,
    });
  }

  protected askSheetPlan(input: SheetPromptInput): Promise<SheetPlan> {
    const template = PROMPTS.productSheet;
    return this.structured({
      name: "sheet_plan",
      system: template.system,
      user: template.render(input),
      images: input.references,
      schema: sheetPlanSchema,
      maxTokens: 24_000,
    });
  }

  protected askGhostScene(input: GhostPromptInput): Promise<ScenePrompt> {
    const template = PROMPTS.ghost;
    return this.structured({
      name: "ghost_scene",
      system: template.system,
      user: template.render(input),
      images: [],
      schema: scenePromptSchema,
      maxTokens: 12_000,
    });
  }

  protected askAdPlan(input: PlanAdInput): Promise<AdPlan> {
    const template = PROMPTS.planAd;
    return this.structured({
      name: "ad_plan",
      system: template.system,
      user: template.render(input),
      images: [],
      schema: adPlanSchema,
      maxTokens: 32_000,
    });
  }

  protected askShotScene(input: ShotPromptInput): Promise<ScenePrompt> {
    const template = PROMPTS.shot;
    return this.structured({
      name: "shot_scene",
      system: template.system,
      user: template.render(input),
      images: [],
      schema: scenePromptSchema,
      maxTokens: 12_000,
    });
  }

  protected askFidelityReview(input: ReviewFidelityInput): Promise<FidelityReview> {
    const template = PROMPTS.reviewFidelity;
    return this.structured({
      name: "fidelity_review",
      system: template.system,
      user: template.render(input),
      images: [...input.originals, input.result],
      schema: fidelityReviewSchema,
      maxTokens: 16_000,
    });
  }

  // --- Public interface -----------------------------------------------------

  async analyzeGarment(input: AnalyzeGarmentInput): Promise<GarmentDna> {
    const dna = await this.askGarmentDna(input);
    return normalizeGarmentDna(dna, input.product.pieces);
  }

  async buildProductSheetPrompt(input: SheetPromptInput): Promise<BuiltSheetPrompt> {
    const raw = await this.askSheetPlan(input);
    const plan = enforceSheetRules(
      raw,
      input.product.pieces.map((piece) => piece.name),
    );
    const layout = computeSheetLayout({
      detailLabels: plan.detailCards.map((card) => card.label),
      bottomCards: plan.bottomCards,
    });
    const design = [
      `PRODUCT SHEET — landscape 16:9, highest resolution. Background ${SHEET_DESIGN.background}; white rounded cards with soft shadows; headings ${SHEET_DESIGN.heading}; body text ${SHEET_DESIGN.body}; thin gold ${SHEET_DESIGN.accent} accent rules.`,
      `Title: "${plan.title}". Overview bullets: ${plan.overviewBullets.map((bullet) => `"${bullet}"`).join(", ")}.`,
      `Macro detail cards: ${plan.detailCards.map((card) => `"${card.label}" — ${card.description}`).join(" | ")}.`,
      `Bottom cards: ${plan.bottomCards.map((card) => `"${card.label}" — ${card.description}`).join(" | ")}.`,
      `LAYOUT (keep these positions exactly):\n${describeLayout(layout)}`,
    ].join("\n");
    const prompt = composeGenerationPrompt({
      scene: plan.prompt,
      dna: input.dna,
      view: "all",
      style: design,
      maxChars: input.promptBudget,
    });
    return { plan, layout, prompt, promptVersion: templateVersion(PROMPTS.productSheet) };
  }

  async buildGhostPrompt(input: GhostPromptInput): Promise<BuiltPrompt> {
    const scene = await this.askGhostScene(input);
    const detailPiece = input.detail
      ? input.dna.pieces.find((piece) => piece.pieceName === input.detail?.pieceName)
      : undefined;
    const prompt = composeGenerationPrompt({
      scene: scene.scene,
      dna: input.dna,
      view: GHOST_LOCK_VIEW[input.view],
      piecePositions: detailPiece ? [detailPiece.position] : undefined,
      style: input.styleDescription,
      extraNegatives: scene.extraNegatives,
      colorOverride: input.colorway,
      maxChars: input.promptBudget,
    });
    return {
      prompt,
      negativePrompt: negativePrompt(scene.extraNegatives),
      scene: scene.scene,
      rationale: scene.rationale,
      promptVersion: templateVersion(PROMPTS.ghost),
    };
  }

  async planAd(input: PlanAdInput): Promise<AdPlan> {
    const plan = await this.askAdPlan(input);
    return {
      ...plan,
      shots: plan.shots.map((shot) => ({ ...shot, prompt: neutralizeWording(shot.prompt) })),
    };
  }

  async buildShotPrompt(input: ShotPromptInput): Promise<BuiltPrompt> {
    const scene = await this.askShotScene(input);
    const environment = input.environmentBible.trim()
      ? `ENVIRONMENT (identical in every shot of this ad): ${input.environmentBible.trim()}`
      : null;
    const prompt = composeGenerationPrompt({
      scene: scene.scene,
      dna: input.dna,
      view: "all",
      style: environment,
      extraNegatives: scene.extraNegatives,
      maxChars: input.promptBudget,
    });
    return {
      prompt,
      negativePrompt: negativePrompt(scene.extraNegatives),
      scene: scene.scene,
      rationale: scene.rationale,
      promptVersion: templateVersion(PROMPTS.shot),
    };
  }

  reviewFidelity(input: ReviewFidelityInput): Promise<FidelityReview> {
    return this.askFidelityReview(input);
  }
}
