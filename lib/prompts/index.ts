import { analyzeGarmentV1 } from "@/lib/prompts/v1/analyze-garment";
import { classifyPhotosV1 } from "@/lib/prompts/v1/classify-photos";
import { planAdV1 } from "@/lib/prompts/v1/plan-ad";
import { reviewFidelityV1 } from "@/lib/prompts/v1/review-fidelity";
import { shotV1 } from "@/lib/prompts/v1/shot";
import { ghostV2 } from "@/lib/prompts/v2/ghost";
import { productSheetV2 } from "@/lib/prompts/v2/product-sheet";

/**
 * Active prompt templates. To tune a prompt, add a new versioned file next to
 * the current one (e.g. v2/ghost.ts) and point the entry here at it.
 */
export const PROMPTS = {
  classifyPhotos: classifyPhotosV1,
  analyzeGarment: analyzeGarmentV1,
  productSheet: productSheetV2,
  ghost: ghostV2,
  planAd: planAdV1,
  shot: shotV1,
  reviewFidelity: reviewFidelityV1,
} as const;

export { templateVersion } from "@/lib/prompts/types";
