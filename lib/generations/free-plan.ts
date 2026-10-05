import { z } from "zod";

import { AppError } from "@/lib/errors";
import {
  FREE_KINDS,
  FREE_MAX_OUTPUTS,
  FREE_MAX_PROMPT_CHARS,
  FREE_MAX_REFERENCES,
  freeModeFor,
  type FreeKind,
} from "@/lib/generations/free-shared";
import {
  capabilitiesOf,
  highestResolution,
  supportsMode,
} from "@/lib/providers/higgsfield/registry";
import type { GenerationMode, ModelSpec } from "@/lib/providers/higgsfield/types";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Free generation: the owner's own prompt, sent to Higgsfield as it is, with
 * the references they uploaded and the model, size and quality they chose.
 * Nothing is added to the prompt (no PRODUCT LOCK, no house style), so this
 * is the plain Higgsfield experience inside the studio.
 */

export {
  FREE_KINDS,
  FREE_MAX_OUTPUTS,
  FREE_MAX_PROMPT_CHARS,
  FREE_MAX_REFERENCES,
  freeModeFor,
  type FreeKind,
};

export const freeRequestSchema = z.object({
  kind: z.enum(FREE_KINDS),
  modelId: z.string().min(1).max(120),
  prompt: z.string().trim().min(1).max(FREE_MAX_PROMPT_CHARS),
  negativePrompt: z.string().trim().max(4000).nullable().optional(),
  referencePaths: z.array(z.string().min(1).max(500)).max(FREE_MAX_REFERENCES).default([]),
  aspectRatio: z.string().trim().max(20).nullable().optional(),
  resolution: z.string().trim().max(20).nullable().optional(),
  durationS: z.number().positive().max(600).nullable().optional(),
  count: z.number().int().min(1).max(FREE_MAX_OUTPUTS).default(1),
});

export type FreeRequest = z.infer<typeof freeRequestSchema>;

export type FreePlan = {
  mode: GenerationMode;
  /** The references that will be sent (trimmed to the model's cap, in order). */
  referencePaths: string[];
  aspectRatio: string | null;
  resolution: string | null;
  durationS: number | null;
  count: number;
  /** What was changed to fit the model, for the owner to see. */
  warnings: string[];
};

/**
 * Fits a free request to its model: the mode follows the references, the
 * reference list is trimmed to what the model takes, the size and quality
 * fall back to the model's options, and anything the model cannot do fails
 * with a plain message before a request is recorded.
 */
export function planFreeRequest(model: ModelSpec, request: FreeRequest): FreePlan {
  if (model.kind !== request.kind) {
    throw new AppError(
      "validation",
      `${model.label} makes ${model.kind}s, not ${request.kind}s. Choose a ${request.kind} model.`,
    );
  }
  const caps = capabilitiesOf(model);
  const warnings: string[] = [];
  const references = [...new Set(request.referencePaths)];
  let mode = freeModeFor(request.kind, references.length > 0);

  if (references.length > 0 && !supportsMode(model, mode)) {
    throw new AppError(
      "validation",
      `${model.label} works from text only. Remove the references or choose a model marked "${mode}".`,
    );
  }
  if (references.length === 0 && !supportsMode(model, mode)) {
    const imageMode = freeModeFor(request.kind, true);
    if (supportsMode(model, imageMode)) {
      throw new AppError(
        "validation",
        `${model.label} needs at least one reference image. Upload one or choose a text model.`,
      );
    }
    throw new AppError("validation", `${model.label} does not support ${mode}.`);
  }
  if (caps.referenceRequired && references.length === 0) {
    throw new AppError("validation", `${model.label} needs at least one reference image.`);
  }

  let referencePaths = references;
  if (references.length > caps.maxReferenceImages && caps.maxReferenceImages > 0) {
    referencePaths = references.slice(0, caps.maxReferenceImages);
    warnings.push(
      `${model.label} takes ${caps.maxReferenceImages} reference image(s); the first ${caps.maxReferenceImages} are sent.`,
    );
  }
  if (referencePaths.length === 0) mode = freeModeFor(request.kind, false);

  const aspectRatio =
    caps.aspectRatios.length > 0
      ? ((request.aspectRatio && caps.aspectRatios.includes(request.aspectRatio)
          ? request.aspectRatio
          : null) ??
        model.params.aspectRatio?.default ??
        caps.aspectRatios[0] ??
        null)
      : null;
  if (request.aspectRatio && caps.aspectRatios.length > 0 && aspectRatio !== request.aspectRatio) {
    warnings.push(`${model.label} has no ${request.aspectRatio}; using ${aspectRatio}.`);
  }

  const resolution =
    caps.resolutions.length > 0
      ? request.resolution && caps.resolutions.includes(request.resolution)
        ? request.resolution
        : highestResolution(model)
      : null;

  let durationS: number | null = null;
  if (caps.durations.length > 0) {
    const requested = request.durationS ?? model.params.duration?.default ?? caps.durations[0]!;
    durationS = caps.durations.includes(requested)
      ? requested
      : ([...caps.durations].sort((a, b) => a - b).find((value) => value >= requested) ??
        caps.maxDurationS);
    if (durationS !== requested) {
      warnings.push(`${model.label} has no ${requested}s; using ${durationS}s.`);
    }
  }

  return {
    mode,
    referencePaths,
    aspectRatio,
    resolution,
    durationS,
    count: Math.min(FREE_MAX_OUTPUTS, Math.max(1, request.count)),
    warnings,
  };
}

/** What the studio stores with a free generation, under params._meta. */
export type FreeMeta = {
  studio: "free";
  /** One id per click, shared by the outputs of that click. */
  batch: string;
  index: number;
  count: number;
  negativePrompt: string | null;
};

export function freeMetaOf(params: Json): FreeMeta | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const meta = params._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  if (meta.studio !== "free" || typeof meta.batch !== "string") return null;
  return {
    studio: "free",
    batch: meta.batch,
    index: typeof meta.index === "number" ? meta.index : 0,
    count: typeof meta.count === "number" ? meta.count : 1,
    negativePrompt: typeof meta.negativePrompt === "string" ? meta.negativePrompt : null,
  };
}

/** The size, quality and duration that were applied to a stored request. */
export function appliedOf(params: Json): {
  aspectRatio: string | null;
  resolution: string | null;
  durationS: number | null;
} {
  const empty = { aspectRatio: null, resolution: null, durationS: null };
  if (!params || typeof params !== "object" || Array.isArray(params)) return empty;
  const applied = params._applied;
  if (!applied || typeof applied !== "object" || Array.isArray(applied)) return empty;
  return {
    aspectRatio: typeof applied.aspectRatio === "string" ? applied.aspectRatio : null,
    resolution: typeof applied.resolution === "string" ? applied.resolution : null,
    durationS: typeof applied.durationS === "number" ? applied.durationS : null,
  };
}
