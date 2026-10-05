import { AppError } from "@/lib/errors";
import {
  matchAspectRatio,
  matchDuration,
  preferredResolution,
} from "@/lib/providers/higgsfield/fit";
import { BUILTIN_MODELS, MOCK_MODELS } from "@/lib/providers/higgsfield/models";
import {
  modelSpecSchema,
  type GenerationMode,
  type GenerationRequest,
  type ModelCapabilities,
  type ModelSpec,
} from "@/lib/providers/higgsfield/types";

export const DEFAULT_PROMPT_BUDGET = 3500;

export function parseModelSpecs(inputs: unknown[]): { specs: ModelSpec[]; errors: string[] } {
  const specs: ModelSpec[] = [];
  const errors: string[] = [];
  inputs.forEach((input, index) => {
    const parsed = modelSpecSchema.safeParse(input);
    if (parsed.success) {
      specs.push(parsed.data);
    } else {
      const id =
        typeof input === "object" && input !== null && "id" in input
          ? String(input.id)
          : `#${index + 1}`;
      errors.push(
        `${id}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
      );
    }
  });
  return { specs, errors };
}

export type RegistryOptions = {
  /** Include mock models (no real provider configured, or forced). */
  includeMock: boolean;
  /** Hide real models (when only the mock provider is available). */
  includeReal: boolean;
  customModels?: unknown[];
  catalogModels?: ModelSpec[];
};

/**
 * Merge order (later wins on id collisions): built-in SDK models → remote
 * catalogue → owner's custom models. Mock models are only listed when the
 * mock provider is active.
 */
export function buildRegistry(options: RegistryOptions): ModelSpec[] {
  const byId = new Map<string, ModelSpec>();
  if (options.includeReal) {
    for (const spec of parseModelSpecs(BUILTIN_MODELS).specs) byId.set(spec.id, spec);
    for (const spec of options.catalogModels ?? []) byId.set(spec.id, spec);
    for (const spec of parseModelSpecs(options.customModels ?? []).specs) {
      byId.set(spec.id, { ...spec, source: "custom" });
    }
  }
  if (options.includeMock) {
    for (const spec of parseModelSpecs(MOCK_MODELS).specs) byId.set(spec.id, spec);
  }
  return [...byId.values()];
}

export function capabilitiesOf(spec: ModelSpec): ModelCapabilities {
  const durations = spec.params.duration?.options ?? [];
  return {
    modes: spec.modes,
    maxReferenceImages: spec.params.image?.max ?? 0,
    referenceRequired: spec.params.image?.required ?? false,
    aspectRatios: spec.params.aspectRatio?.options.map((option) => option.label) ?? [],
    resolutions: spec.params.resolution?.options.map((option) => option.label) ?? [],
    durations,
    maxDurationS: durations.length > 0 ? Math.max(...durations) : null,
    supportsNegativePrompt: Boolean(spec.params.negativePrompt),
    supportsSeed: Boolean(spec.params.seed),
    maxPromptChars: spec.params.prompt.maxChars ?? DEFAULT_PROMPT_BUDGET,
  };
}

export function supportsMode(spec: ModelSpec, mode: GenerationMode): boolean {
  return spec.modes.includes(mode);
}

/** Pick the model to use for a mode: preferred id if valid, else first match. */
export function pickModel(
  registry: ModelSpec[],
  mode: GenerationMode,
  preferredId?: string | null,
): ModelSpec | null {
  if (preferredId) {
    const preferred = registry.find((spec) => spec.id === preferredId);
    if (preferred && supportsMode(preferred, mode)) return preferred;
  }
  return registry.find((spec) => supportsMode(spec, mode)) ?? null;
}

export function highestResolution(spec: ModelSpec): string | null {
  const options = spec.params.resolution?.options;
  return options && options.length > 0 ? options[options.length - 1]!.label : null;
}

/** The quality to send when nobody chose one (see preferredResolution). */
export function defaultResolution(spec: ModelSpec): string | null {
  return preferredResolution(
    spec.kind,
    spec.params.resolution?.options.map((option) => option.label) ?? [],
    spec.params.resolution?.default ?? null,
  );
}

export { matchAspectRatio, matchDuration, preferredResolution };

export type BuiltProviderInput = {
  body: Record<string, unknown>;
  applied: {
    aspectRatio: string | null;
    resolution: string | null;
    durationS: number | null;
    referenceCount: number;
  };
  warnings: string[];
};

function encodeImages(
  format: NonNullable<ModelSpec["params"]["image"]>["format"],
  urls: string[],
): unknown {
  switch (format) {
    case "input_images":
      return urls.map((url) => ({ type: "image_url", image_url: url }));
    case "image_reference":
      return { type: "image_url", image_url: urls[0] };
    case "url":
      return urls[0];
    case "url_array":
      return urls;
  }
}

/** Translate a provider-neutral request into the model's request body. */
export function buildProviderInput(
  spec: ModelSpec,
  request: GenerationRequest,
): BuiltProviderInput {
  if (!supportsMode(spec, request.mode)) {
    throw new AppError("validation", `${spec.label} does not support ${request.mode}.`);
  }
  const warnings: string[] = [];
  const params = spec.params;
  const body: Record<string, unknown> = { ...spec.fixedParams };

  const maxChars = params.prompt.maxChars ?? Number.POSITIVE_INFINITY;
  let prompt = request.prompt.trim();
  if (prompt.length > maxChars) {
    prompt = prompt.slice(0, maxChars);
    warnings.push(`Prompt shortened to ${maxChars} characters for ${spec.label}.`);
  }
  body[params.prompt.field] = prompt;

  if (params.negativePrompt && request.negativePrompt?.trim()) {
    let negative = request.negativePrompt.trim();
    const limit = params.negativePrompt.maxChars;
    if (limit && negative.length > limit) {
      negative = negative.slice(0, limit);
      warnings.push(`Negative prompt shortened to ${limit} characters for ${spec.label}.`);
    }
    body[params.negativePrompt.field] = negative;
  }

  let referenceCount = 0;
  const wantsImages = request.mode === "image-to-image" || request.mode === "image-to-video";
  if (params.image && request.referenceUrls.length > 0 && wantsImages) {
    const urls = request.referenceUrls.slice(0, params.image.max);
    if (request.referenceUrls.length > params.image.max) {
      warnings.push(
        `${spec.label} accepts ${params.image.max} reference image(s); extra references were not sent.`,
      );
    }
    body[params.image.field] = encodeImages(params.image.format, urls);
    referenceCount = urls.length;
  } else if (params.image?.required) {
    throw new AppError("validation", `${spec.label} needs a reference image.`);
  } else if (wantsImages && request.referenceUrls.length > 0) {
    throw new AppError("validation", `${spec.label} cannot take reference images.`);
  }

  let aspectRatio: string | null = null;
  if (params.aspectRatio) {
    const requested = request.aspectRatio ?? params.aspectRatio.default ?? null;
    const option = requested ? matchAspectRatio(params.aspectRatio.options, requested) : null;
    const chosen = option ?? params.aspectRatio.options[0]!;
    if (requested && chosen.label !== requested) {
      warnings.push(`${spec.label} has no ${requested}; using ${chosen.label}.`);
    }
    body[params.aspectRatio.field] = chosen.value;
    aspectRatio = chosen.label;
  }

  let resolution: string | null = null;
  if (params.resolution) {
    const requested = request.resolution ?? params.resolution.default ?? null;
    const option =
      params.resolution.options.find((candidate) => candidate.label === requested) ??
      params.resolution.options[params.resolution.options.length - 1]!;
    body[params.resolution.field] = option.value;
    resolution = option.label;
  }

  let durationS: number | null = null;
  if (params.duration) {
    const requested = request.durationS ?? params.duration.default ?? params.duration.options[0]!;
    durationS = matchDuration(params.duration.options, requested);
    body[params.duration.field] = durationS;
  }

  if (params.seed && typeof request.seed === "number") {
    body[params.seed.field] = request.seed;
  }

  return { body, applied: { aspectRatio, resolution, durationS, referenceCount }, warnings };
}

/** Replace reference URLs inside a request body (for logging without secrets). */
export function redactBody(
  body: Record<string, unknown>,
  replacements: Map<string, string>,
): Record<string, unknown> {
  const json = JSON.stringify(body, (_key, value: unknown) =>
    typeof value === "string" && replacements.has(value) ? replacements.get(value) : value,
  );
  return JSON.parse(json) as Record<string, unknown>;
}
