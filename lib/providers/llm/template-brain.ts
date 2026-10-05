import { colourWords, colourwayBrief } from "@/lib/colorways/words";
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
  keepColourwayNegatives,
  negativePromptTerms,
  type LockView,
} from "@/lib/prompts/blocks";
import {
  composeGhostParagraph,
  GHOST_NEGATIVE_TERMS,
  ghostNegatives,
  mainColourOf,
} from "@/lib/prompts/house-style";
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
  PolishedPrompt,
  PolishPromptInput,
  ReviewFidelityInput,
  ScenePrompt,
  SheetPlanInput,
  ShotPromptInput,
  StructuredRequest,
} from "@/lib/providers/llm/types";
import {
  ghostScenePromptSchema,
  polishedPromptSchema,
  scenePromptSchema,
} from "@/lib/providers/llm/types";
import { neutralizeWording } from "@/lib/prompts/wording";

const GHOST_LOCK_VIEW: Record<GhostPromptInput["view"], LockView> = {
  front: "front",
  back: "back",
  macro: "detail",
  colorway: "front",
};

function negativePrompt(extra: string[], colourway = false): string {
  const trimmed = extra.map((item) => item.trim()).filter(Boolean);
  const extras = colourway ? keepColourwayNegatives(trimmed) : trimmed;
  const terms = negativePromptTerms(colourway);
  return neutralizeWording(extras.length > 0 ? `${terms}, ${extras.join(", ")}` : terms);
}

/**
 * The owner's label for a colour ("cashmir") replaced by its plain words
 * ("dusty rose") wherever the brain wrote it: an image model may not know the
 * label, or may read it as a fabric. A label that already is those words stays.
 */
export function sayColourInWords(text: string, colorway: { name: string; hex: string }): string {
  const label = colorway.name.trim();
  const { words } = colourWords(label, colorway.hex);
  if (label.length < 2 || words.toLowerCase().includes(label.toLowerCase())) return text;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), words);
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

  protected askPolishedPrompt(input: PolishPromptInput): Promise<PolishedPrompt> {
    const template = PROMPTS.polishPrompt;
    return this.structured({
      name: "polish_prompt",
      system: template.system,
      user: template.render(input),
      images: input.references,
      schema: polishedPromptSchema,
      maxTokens: 8_000,
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
    const layers = input.layers ?? null;
    // A robe set's inner image locks only the inner pieces, without the set line.
    const innerOnly = layers?.show === "inner";
    // The house system writes the prompt; the brain's answer fills its garment slots.
    const paragraph = composeGhostParagraph({
      view: input.view,
      scene,
      dna: input.dna,
      style: input.style,
      productLine: input.product.productLine,
      referenceMode: input.referenceMode,
      detail: input.detail,
      colourway: input.colorway
        ? {
            ...colourwayBrief(input.colorway, mainColourOf(input.dna)),
            swatch: Boolean(input.colorway.swatch),
          }
        : null,
      layers,
    });
    const sceneText = input.colorway ? sayColourInWords(paragraph, input.colorway) : paragraph;
    const detailPiece = input.detail
      ? input.dna.pieces.find((piece) => piece.pieceName === input.detail?.pieceName)
      : undefined;
    const piecePositions = innerOnly
      ? layers.innerPieces.map((piece) => piece.position)
      : detailPiece
        ? [detailPiece.position]
        : undefined;
    const prompt = composeGenerationPrompt({
      scene: sceneText,
      dna: input.dna,
      view: GHOST_LOCK_VIEW[input.view],
      piecePositions,
      set: !innerOnly,
      extraNegatives: [...ghostNegatives(input.style, input.view, layers), ...scene.extraNegatives],
      colorOverride: input.colorway,
      maxChars: input.promptBudget,
    });
    return {
      prompt,
      negativePrompt: negativePrompt(
        [...GHOST_NEGATIVE_TERMS, ...scene.extraNegatives],
        input.colorway !== null,
      ),
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

  /**
   * The owner's prompt, polished. The brain's wording passes the neutral
   * filter like every other prompt it writes; nothing else is appended, so
   * the owner sees exactly what will be sent.
   */
  async polishPrompt(input: PolishPromptInput): Promise<PolishedPrompt> {
    const trimmed = input.prompt.trim();
    if (!trimmed) throw new AppError("validation", "Write a prompt first.");
    const polished = await this.askPolishedPrompt({ ...input, prompt: trimmed });
    return {
      prompt: neutralizeWording(polished.prompt.trim()) || trimmed,
      negativePrompt: neutralizeWording(polished.negativePrompt.trim()),
      notes: polished.notes.trim(),
    };
  }
}
