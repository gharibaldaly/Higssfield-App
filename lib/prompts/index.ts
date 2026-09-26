import { analyzeGarmentV1 } from "@/lib/prompts/v1/analyze-garment";
import { ghostV1 } from "@/lib/prompts/v1/ghost";
import { planAdV1 } from "@/lib/prompts/v1/plan-ad";
import { productSheetV1 } from "@/lib/prompts/v1/product-sheet";
import { reviewFidelityV1 } from "@/lib/prompts/v1/review-fidelity";
import { shotV1 } from "@/lib/prompts/v1/shot";

/**
 * Active prompt templates. To tune a prompt, add a new versioned file next to
 * the current one (e.g. v2/ghost.ts) and point the entry here at it.
 */
export const PROMPTS = {
  analyzeGarment: analyzeGarmentV1,
  productSheet: productSheetV1,
  ghost: ghostV1,
  planAd: planAdV1,
  shot: shotV1,
  reviewFidelity: reviewFidelityV1,
} as const;

export { templateVersion } from "@/lib/prompts/types";
