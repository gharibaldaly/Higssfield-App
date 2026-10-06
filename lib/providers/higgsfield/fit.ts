import type { ParamOption } from "@/lib/providers/higgsfield/types";

/**
 * Fitting a request to a model's options. Pure and light, so client
 * components can show what will really be sent (a 3 s shot becomes the
 * model's shortest clip) without pulling in the model catalogue.
 */

function ratioValue(label: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/.exec(label.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

/** Exact label match, else the numerically closest aspect ratio option. */
export function matchAspectRatio(options: ParamOption[], requested: string): ParamOption | null {
  const exact = options.find((option) => option.label === requested);
  if (exact) return exact;
  const target = ratioValue(requested);
  if (target === null) return null;
  let best: { option: ParamOption; distance: number } | null = null;
  for (const option of options) {
    const value = ratioValue(option.label) ?? ratioValue(String(option.value));
    if (value === null) continue;
    const distance = Math.abs(Math.log(value / target));
    if (!best || distance < best.distance) best = { option, distance };
  }
  return best?.option ?? null;
}

/** Smallest supported duration that covers the request, else the longest. */
export function matchDuration(options: number[], requested: number): number {
  const sorted = [...options].sort((a, b) => a - b);
  return sorted.find((value) => value >= requested - 0.001) ?? sorted[sorted.length - 1]!;
}

/** Social ads are watched on phones: 1080p is the quality to pay for by default. */
export const PREFERRED_VIDEO_RESOLUTION = "1080p";

/**
 * The quality a request gets when nobody chose one. Images take the highest
 * tier (the catalogue wants every thread); video takes 1080p when the model
 * offers it, else the model's own default, else its highest tier. The top
 * video tier (4k) costs several times more per clip and is a deliberate
 * choice, never a default (2026-10-05: five 3 s shots cost US$21.77 at 4k).
 */
export function preferredResolution(
  kind: "image" | "video",
  labels: readonly string[],
  modelDefault?: string | null,
): string | null {
  if (labels.length === 0) return null;
  if (kind === "video") {
    if (labels.includes(PREFERRED_VIDEO_RESOLUTION)) return PREFERRED_VIDEO_RESOLUTION;
    if (modelDefault && labels.includes(modelDefault)) return modelDefault;
  }
  return labels[labels.length - 1] ?? null;
}
