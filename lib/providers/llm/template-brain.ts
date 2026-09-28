import { adPlanSchema, type AdPlan } from "@/lib/domain/ad-plan";
import { fidelityReviewSchema, type FidelityReview } from "@/lib/domain/fidelity";
import { garmentDnaSchema, normalizeGarmentDna, type GarmentDna } from "@/lib/domain/garment-dna";
import {
  photoClassificationSchema,
  type PhotoClassification,
} from "@/lib/domain/photo-classification";
import { enforceSheetRules, sheetPhotoPlanSchema, type SheetPhotoPlan } from "@/lib/domain/sheet";
import { AppError, isAppError } from "@/lib/errors";
import {
  composeGenerationPrompt,
  NEGATIVE_PROMPT_TERMS,
  type LockView,
} from "@/lib/prompts/blocks";
import { buildHouseStyle, GHOST_NEGATIVE_TERMS, ghostNegatives } from "@/lib/prompts/house-style";
import { PROMPTS, templateVersion } from "@/lib/prompts";
import type {
  AnalyzeGarmentInput,
  BuiltPrompt,
  ClassifyPhotosInput,
  DirectorBrain,
  GhostPromptInput,
  GhostScenePrompt,
  LlmProviderId,
  PlanAdInput,
  ReviewFidelityInput,
  ScenePrompt,
  SheetPlanInput,
  ShotPromptInput,
  StructuredRequest,
} from "@/lib/providers/llm/types";
import { ghostScenePromptSchema, scenePromptSchema } from "@/lib/providers/llm/types";
import { neutralizeWording } from "@/lib/prompts/wording";

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

function cleanList(items: string[], max: number): string[] {
  return items
    .map((item) => item.trim().replace(/[.;]+$/, ""))
    .filter(Boolean)
    .slice(0, max);
}

/** Instruction, then the "keep exactly" and "clean up" checklists written for this image. */
export function composeGhostScene(scene: GhostScenePrompt): string {
  const keep = cleanList(scene.mustKeep, 8);
  const cleanUp = cleanList(scene.cleanUp, 5);
  return [
    scene.instruction.trim(),
    keep.length > 0 ? `KEEP EXACTLY — ${keep.join("; ")}.` : null,
    cleanUp.length > 0
      ? `LEAVE OUT (photo artefacts only, never design details) — ${cleanUp.join("; ")}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
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

  protected askSheetPlan(input: SheetPlanInput): Promise<SheetPhotoPlan> {
    const template = PROMPTS.productSheet;
    return this.structured({
      name: "sheet_plan",
      system: template.system,
      user: template.render(input),
      images: input.photos,
      schema: sheetPhotoPlanSchema,
      maxTokens: 24_000,
    });
  }

  protected askGhostScene(input: GhostPromptInput): Promise<GhostScenePrompt> {
    const template = PROMPTS.ghost;
    return this.structured({
      name: "ghost_scene",
      system: template.system,
      user: template.render(input),
      images: input.references,
      schema: ghostScenePromptSchema,
      maxTokens: 16_000,
    });
  }

  protected askPhotoViews(input: ClassifyPhotosInput): Promise<PhotoClassification> {
    const template = PROMPTS.classifyPhotos;
    if (input.photos.length === 0) return Promise.resolve({ photos: [] });
    return this.structured({
      name: "photo_views",
      system: template.system,
      user: template.render(input),
      images: input.photos,
      schema: photoClassificationSchema,
      maxTokens: 8_000,
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

  async classifyPhotos(input: ClassifyPhotosInput): Promise<PhotoClassification> {
    const result = await this.askPhotoViews(input);
    // One entry per photo, in range, first answer wins.
    const seen = new Set<number>();
    return {
      photos: result.photos.filter((photo) => {
        if (photo.index < 1 || photo.index > input.photos.length || seen.has(photo.index)) {
          return false;
        }
        seen.add(photo.index);
        return true;
      }),
    };
  }

  async analyzeGarment(input: AnalyzeGarmentInput): Promise<GarmentDna> {
    const dna = await this.askGarmentDna(input);
    return normalizeGarmentDna(dna, input.product.pieces);
  }

  async planProductSheet(input: SheetPlanInput): Promise<SheetPhotoPlan> {
    // Every card is cut from a photo: without photos there is nothing to choose from.
    if (input.photos.length === 0) {
      throw new AppError("validation", "Upload product photos before building the sheet.");
    }
    const plan = await this.askSheetPlan(input);
    return enforceSheetRules(
      plan,
      input.product.pieces.map((piece) => piece.name),
    );
  }

  async buildGhostPrompt(input: GhostPromptInput): Promise<BuiltPrompt> {
    const scene = await this.askGhostScene(input);
    const sceneText = composeGhostScene(scene);
    const detailPiece = input.detail
      ? input.dna.pieces.find((piece) => piece.pieceName === input.detail?.pieceName)
      : undefined;
    const prompt = composeGenerationPrompt({
      scene: sceneText,
      dna: input.dna,
      view: GHOST_LOCK_VIEW[input.view],
      piecePositions: detailPiece ? [detailPiece.position] : undefined,
      style: buildHouseStyle(input.style, input.view),
      extraNegatives: [...ghostNegatives(input.style, input.view), ...scene.extraNegatives],
      colorOverride: input.colorway,
      maxChars: input.promptBudget,
    });
    return {
      prompt,
      negativePrompt: negativePrompt([...GHOST_NEGATIVE_TERMS, ...scene.extraNegatives]),
      scene: sceneText,
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
