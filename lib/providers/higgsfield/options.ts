import { capabilitiesOf, supportsMode } from "@/lib/providers/higgsfield/registry";
import type {
  GenerationMode,
  ModelCapabilities,
  ModelSpec,
} from "@/lib/providers/higgsfield/types";

/** Serializable model description for pickers in client components. */
export type ModelOption = {
  id: string;
  label: string;
  kind: "image" | "video";
  description: string | null;
  source: ModelSpec["source"];
  sourceNote: string | null;
  capabilities: ModelCapabilities;
  unverifiedOptions: boolean;
  /** Null when usable for the current job; otherwise the reason it is disabled. */
  disabledReason: "mode" | null;
};

export function toModelOptions(
  specs: ModelSpec[],
  kind: "image" | "video",
  modes: GenerationMode[],
): ModelOption[] {
  return specs
    .filter((spec) => spec.kind === kind)
    .map((spec) => ({
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      description: spec.description ?? null,
      source: spec.source,
      sourceNote: spec.sourceNote ?? null,
      capabilities: capabilitiesOf(spec),
      unverifiedOptions:
        spec.params.aspectRatio?.verified === false ||
        spec.params.resolution?.verified === false ||
        spec.params.duration?.verified === false,
      disabledReason: modes.some((mode) => supportsMode(spec, mode)) ? null : ("mode" as const),
    }))
    .sort((a, b) => Number(a.disabledReason !== null) - Number(b.disabledReason !== null));
}
