import "server-only";

import { AppError } from "@/lib/errors";
import { prepareReference } from "@/lib/images/process";
import { ensureDerivatives, preparedPathFor } from "@/lib/storage/derivatives";
import { downloadObject, signPaths, uploadObject } from "@/lib/storage/objects";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Re-encoded copies of reference images: upright, at most `longEdge` pixels
 * on the long side, sRGB JPEG without metadata. First made for models that
 * fail on the owner's phone photos as they are (Marketing Studio Image,
 * 2026-10-05); since 2026-10-06 every image reference goes out as a copy at
 * `REFERENCE_LONG_EDGE`, because Higgsfield resizes references anyway and the
 * originals cost twenty times the egress. A copy is keyed by its source path
 * and size, so it is made once per photo and reused by every later request;
 * the generation row keeps the original paths for the compare view and the
 * fidelity checks.
 */
export async function prepareReferences(
  supabase: TypedSupabaseClient,
  sourcePaths: string[],
  longEdge: number,
): Promise<string[]> {
  const targets = sourcePaths.map((source) => ({
    source,
    path: preparedPathFor(source, longEdge),
  }));
  // A signed URL only comes back for an object that exists: the cheapest existence check.
  const existing = await signPaths(
    supabase,
    targets.map((target) => target.path),
    { cache: false },
  );
  for (const target of targets) {
    if (existing.has(target.path)) continue;
    let original: Buffer;
    try {
      original = await downloadObject(supabase, target.source);
    } catch (error) {
      throw new AppError("not_found", "A reference image could not be read from storage.", {
        cause: error,
      });
    }
    let copy: Buffer;
    try {
      copy = await prepareReference(original, longEdge);
    } catch (error) {
      // A file sharp cannot decode goes out as it is; the model may still read it.
      console.warn("Reference could not be re-encoded; sending the original", target.source, error);
      target.path = target.source;
      continue;
    }
    await uploadObject(supabase, target.path, copy, "image/jpeg");
    // The photo's other copies (the tile, the standard reference), while its bytes are in hand.
    await ensureDerivatives(supabase, target.source, original);
  }
  return targets.map((target) => target.path);
}
