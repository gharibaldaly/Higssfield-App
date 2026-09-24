import { z } from "zod";

import type { AdPlan } from "@/lib/domain/ad-plan";
import type { FidelityReview } from "@/lib/domain/fidelity";
import type { GarmentDna } from "@/lib/domain/garment-dna";
import type { ProductLine } from "@/lib/domain/product";
import type { SheetPlan } from "@/lib/domain/sheet";
import type { SheetCropKind, SheetLayout } from "@/lib/sheet/layout";

export type LlmProviderId = "claude" | "gemini" | "mock";

export type LlmImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  /** Shown to the model right before the image, e.g. `Piece 1 "Robe" — front`. */
  caption: string;
};

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

export type SheetPromptInput = {
  product: ProductBrief;
  dna: GarmentDna;
  references: LlmImage[];
  note: string | null;
  promptBudget: number;
};

export type BuiltSheetPrompt = {
  plan: SheetPlan;
  layout: SheetLayout;
  prompt: string;
  promptVersion: string;
};

export type GhostView = "front" | "back" | "macro" | "colorway";

export type GhostPromptInput = {
  product: ProductBrief;
  dna: GarmentDna;
  view: GhostView;
  styleDescription: string;
  detail: { label: string; description: string; pieceName: string } | null;
  colorway: { name: string; hex: string } | null;
  referenceCaptions: string[];
  note: string | null;
  promptBudget: number;
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
  analyzeGarment(input: AnalyzeGarmentInput): Promise<GarmentDna>;
  buildProductSheetPrompt(input: SheetPromptInput): Promise<BuiltSheetPrompt>;
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
