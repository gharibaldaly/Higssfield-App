import "server-only";

import { AppError } from "@/lib/errors";
import { getModelRegistry } from "@/lib/providers/higgsfield";
import { capabilitiesOf, pickModel, supportsMode } from "@/lib/providers/higgsfield/registry";
import type { GenerationMode, ModelSpec } from "@/lib/providers/higgsfield/types";
import type { OwnerSettings } from "@/lib/settings/service";

export async function ownerRegistry(settings: OwnerSettings): Promise<ModelSpec[]> {
  return getModelRegistry(settings.customModels);
}

/**
 * Resolve the model for a job. Order: explicit choice → Settings default →
 * first registry model that supports the preferred mode → fallback mode.
 * Image jobs prefer image-to-image (references) and fall back to text-to-image.
 */
export function resolveModel(
  registry: ModelSpec[],
  options: {
    kind: "image" | "video";
    preferredModes: GenerationMode[];
    requestedId?: string | null;
    defaultId?: string | null;
  },
): { model: ModelSpec; mode: GenerationMode } {
  const candidates = registry.filter((spec) => spec.kind === options.kind);
  for (const id of [options.requestedId, options.defaultId]) {
    if (!id) continue;
    const spec = candidates.find((candidate) => candidate.id === id);
    if (!spec) {
      if (id === options.requestedId)
        throw new AppError("validation", `Model "${id}" is not available.`);
      continue;
    }
    const mode = options.preferredModes.find((candidate) => supportsMode(spec, candidate));
    if (mode) return { model: spec, mode };
    if (id === options.requestedId) {
      throw new AppError(
        "validation",
        `${spec.label} cannot do ${options.preferredModes.join(" or ")}.`,
      );
    }
  }
  for (const mode of options.preferredModes) {
    const spec = pickModel(candidates, mode);
    if (spec) return { model: spec, mode };
  }
  throw new AppError(
    "config",
    `No ${options.kind} model supports ${options.preferredModes.join(" / ")}. Add one in Settings → Models.`,
  );
}

export function referenceBudget(model: ModelSpec, mode: GenerationMode): number {
  if (mode === "text-to-image" || mode === "text-to-video") return 0;
  return capabilitiesOf(model).maxReferenceImages;
}

export function promptBudget(model: ModelSpec): number {
  return capabilitiesOf(model).maxPromptChars;
}
