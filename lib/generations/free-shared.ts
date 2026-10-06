import type { GenerationMode } from "@/lib/providers/higgsfield/types";

/**
 * The parts of free generation the form shares with the server, kept free of
 * the model catalogue so the page's client bundle stays small.
 */

export const FREE_KINDS = ["image", "video"] as const;
export type FreeKind = (typeof FREE_KINDS)[number];

/** Outputs per click; each one is a separate request with its own cost. */
export const FREE_MAX_OUTPUTS = 4;
/** References the owner may upload per request; the model's own cap trims it further. */
export const FREE_MAX_REFERENCES = 10;
export const FREE_MAX_PROMPT_CHARS = 8000;

/** The generation mode a free request runs in: references make it an image-to-* request. */
export function freeModeFor(kind: FreeKind, hasReferences: boolean): GenerationMode {
  if (kind === "image") return hasReferences ? "image-to-image" : "text-to-image";
  return hasReferences ? "image-to-video" : "text-to-video";
}
