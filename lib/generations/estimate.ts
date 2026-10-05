import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import { ownerRegistry } from "@/lib/generations/models";
import { activeProviderMode, getProvider } from "@/lib/providers/higgsfield";
import { buildProviderInput } from "@/lib/providers/higgsfield/registry";
import { GENERATION_MODES } from "@/lib/providers/higgsfield/types";
import type { OwnerSettings } from "@/lib/settings/service";

/**
 * What a request would cost before it is sent. Higgsfield's estimate endpoint
 * takes the same body as a submit and charges nothing, so the studio sends a
 * stand-in body (a placeholder prompt and placeholder reference links) with
 * the real model, mode, size, quality and duration. The answer also says what
 * will really be sent: a 3 s shot on a model whose shortest clip is 4 s is
 * priced, and shown, as 4 s.
 */

export const estimateRequestSchema = z.object({
  modelId: z.string().min(1).max(120),
  mode: z.enum(GENERATION_MODES),
  aspectRatio: z.string().trim().max(20).nullable().optional(),
  resolution: z.string().trim().max(20).nullable().optional(),
  durationS: z.number().positive().max(600).nullable().optional(),
  referenceCount: z.number().int().min(0).max(16).default(0),
});

export type EstimateRequest = z.infer<typeof estimateRequestSchema>;

export type Estimate = {
  /** Null when the provider cannot say (mock mode, or the estimate failed). */
  usd: number | null;
  credits: number | null;
  /** What the request would really carry after fitting to the model. */
  aspectRatio: string | null;
  resolution: string | null;
  durationS: number | null;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; estimate: Estimate }>();

const PLACEHOLDER_PROMPT = "Price estimate for the studio; nothing is generated.";

export async function estimateGeneration(
  settings: OwnerSettings,
  request: EstimateRequest,
): Promise<Estimate> {
  const registry = await ownerRegistry(settings);
  const model = registry.find((spec) => spec.id === request.modelId);
  if (!model) throw new AppError("validation", `Model "${request.modelId}" is not available.`);

  const wantsImages = request.mode === "image-to-image" || request.mode === "image-to-video";
  const referenceCount = wantsImages ? Math.max(wantsImages ? 1 : 0, request.referenceCount) : 0;
  const built = buildProviderInput(model, {
    mode: request.mode,
    prompt: PLACEHOLDER_PROMPT,
    referenceUrls: Array.from(
      { length: Math.min(referenceCount, model.params.image?.max ?? 0) },
      (_, index) => `https://example.com/reference-${index + 1}.jpg`,
    ),
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    durationS: request.durationS,
  });
  const applied = {
    aspectRatio: built.applied.aspectRatio,
    resolution: built.applied.resolution,
    durationS: built.applied.durationS,
  };

  const provider = getProvider(activeProviderMode());
  if (!provider.estimate) return { usd: null, credits: null, ...applied };

  const key = `${model.endpoint}|${JSON.stringify(built.body)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.estimate;

  let estimate: Estimate;
  try {
    const priced = await provider.estimate(model, built.body);
    estimate = { usd: priced?.usd ?? null, credits: priced?.credits ?? null, ...applied };
  } catch (error) {
    console.warn("Higgsfield estimate failed", model.id, error);
    estimate = { usd: null, credits: null, ...applied };
  }
  if (estimate.usd !== null || estimate.credits !== null)
    cache.set(key, { at: Date.now(), estimate });
  return estimate;
}
