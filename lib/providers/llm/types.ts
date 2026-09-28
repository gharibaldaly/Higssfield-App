import { z } from "zod";

import type { AdPlan } from "@/lib/domain/ad-plan";
import type { CatalogueStyle } from "@/lib/domain/catalogue-style";
import type { FidelityReview } from "@/lib/domain/fidelity";
import type { GarmentDna } from "@/lib/domain/garment-dna";
import type { PhotoClassification } from "@/lib/domain/photo-classification";
import type { ProductLine } from "@/lib/domain/product";
import type { SheetPhotoPlan } from "@/lib/domain/sheet";
import type { SheetCropKind } from "@/lib/sheet/layout";

export type LlmProviderId = "claude" | "gemini" | "gateway" | "mock";

export type LlmImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  /** Shown to the model right before the image, e.g. `Piece 1 "Robe" — front`. */
  caption: string;
};

/** Short-lived HTTPS links to brain images; `release` deletes the copies behind them. */
export type HostedImages = { urls: string[]; release: () => Promise<void> };

/**
 * Puts brain images behind short-lived links. Some gateways count inline image
 * data as text, so a dozen photos overflow the model's context; links keep the
 * request small.
 */
export type LlmImageHost = (images: LlmImage[]) => Promise<HostedImages>;

export type ProductBrief = {
  name: string;
  productLine: ProductLine;
  notes: string | null;
  pieces: { position: number; name: string }[];
};

export type AnalyzeGarmentInput = {
  product: ProductBrief;
  photos: LlmImage[];
};

export type SheetPlanInput = {
  product: ProductBrief;
  dna: GarmentDna;
  /** The owner's photos; each caption starts with its number ("Photo 1 — front…"). */
  photos: LlmImage[];
  note: string | null;
};

export type GhostView = "front" | "back" | "macro" | "colorway";

export type GhostPromptInput = {
  product: ProductBrief;
  dna: GarmentDna;
  view: GhostView;
  /** The catalogue look; the house style block is built from it by code. */
  style: CatalogueStyle;
  detail: { label: string; description: string; pieceName: string } | null;
  /** `swatch`: the image model also receives a photo of the fabric in this colour. */
  colorway: { name: string; hex: string; swatch?: boolean } | null;
  /** The isolated references for this image; the brain looks at them while writing. */
  references: LlmImage[];
  /** "edit": the image model receives the references too; "text": it only gets the prompt. */
  referenceMode: "edit" | "text";
  note: string | null;
  promptBudget: number;
};

export type ClassifyPhotosInput = {
  product: ProductBrief;
  photos: LlmImage[];
};

export type BuiltPrompt = {
  /** Final provider prompt: scene + style + PRODUCT LOCK + STRICT NEGATIVES. */
  prompt: string;
  negativePrompt: string;
  scene: string;
  rationale: string;
  promptVersion: string;
};

export type PlanAdInput = {
  brief: string;
  product: ProductBrief;
  dna: GarmentDna;
  controlsDescription: string;
  rules: string[];
  crops: { id: string; kind: SheetCropKind; label: string }[];
  video: {
    totalDurationS: number;
    maxShotDurationS: number;
    aspectRatio: string;
    modelLabel: string;
    durationOptions: number[] | null;
  };
  targetShotCount: number;
  humanModel: boolean;
};

export type ShotPromptInput = {
  target: "video" | "frame";
  shot: {
    purpose: string;
    detailShown: string;
    framing: string;
    angle: string;
    movement: string;
    placement: string | null;
    durationS: number;
    prompt: string;
  };
  environmentBible: string;
  controlsDescription: string;
  rules: string[];
  dna: GarmentDna;
  referenceLabels: string[];
  aspectRatio: string;
  note: string | null;
  promptBudget: number;
};

export type ReviewFidelityInput = {
  dna: GarmentDna;
  context: string;
  originals: LlmImage[];
  result: LlmImage;
};

/** The director brain: one interface, several providers (Settings switch). */
export interface DirectorBrain {
  readonly provider: LlmProviderId;
  readonly model: string;
  /** Sorts unnamed phone photos into front / back / detail before the DNA is written. */
  classifyPhotos(input: ClassifyPhotosInput): Promise<PhotoClassification>;
  analyzeGarment(input: AnalyzeGarmentInput): Promise<GarmentDna>;
  /** Chooses what the product sheet shows and where it is on the owner's photos. */
  planProductSheet(input: SheetPlanInput): Promise<SheetPhotoPlan>;
  buildGhostPrompt(input: GhostPromptInput): Promise<BuiltPrompt>;
  planAd(input: PlanAdInput): Promise<AdPlan>;
  buildShotPrompt(input: ShotPromptInput): Promise<BuiltPrompt>;
  reviewFidelity(input: ReviewFidelityInput): Promise<FidelityReview>;
}

/** LLM output for scene-style prompts (ghost images, shots). */
export const scenePromptSchema = z.object({
  scene: z.string().min(1),
  extraNegatives: z.array(z.string()),
  rationale: z.string(),
});

export type ScenePrompt = z.infer<typeof scenePromptSchema>;

/** LLM output for ghost images (prompt v3): the garment slots of the house prompt. */
export const ghostScenePromptSchema = z.object({
  garment: z
    .string()
    .min(1)
    .describe(
      "The noun phrase after 'the exact {colour}': the category and what defines this piece, 3 to 12 words",
    ),
  colour: z
    .string()
    .describe("The garment's colour in 2 to 4 plain colour words, as the photos show it"),
  construction: z
    .array(z.string())
    .describe("6 to 10 construction items visible in this view, top to bottom, each 3 to 12 words"),
  cleanUp: z
    .array(z.string())
    .describe("0 to 5 handling or photography artefacts in the photos to leave out"),
  extraNegatives: z.array(z.string()),
  rationale: z.string(),
});

export type GhostScenePrompt = z.infer<typeof ghostScenePromptSchema>;

export type StructuredRequest<T> = {
  /** Name used for logging and structured-output format names. */
  name: string;
  system: string;
  user: string;
  images: LlmImage[];
  schema: z.ZodType<T>;
  /** Output cap; generous because thinking tokens count towards it. */
  maxTokens: number;
};
