import "server-only";

import { createHash } from "node:crypto";

import { AppError } from "@/lib/errors";
import { prepareReference } from "@/lib/images/process";
import { downloadObject, signPaths, uploadObject } from "@/lib/storage/objects";
import { storagePaths } from "@/lib/storage/paths";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Re-encoded copies of reference images for models that fail on the owner's
 * phone photos as they are (Marketing Studio Image, 2026-10-05): upright, at
 * most `longEdge` pixels on the long side, sRGB JPEG without metadata. A copy
 * is keyed by its source path and size, so it is made once per photo and
 * reused by every later request; the generation row keeps the original paths
 * for the compare view and the fidelity checks.
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
    await uploadObject(
      supabase,
      target.path,
      await prepareReference(original, longEdge),
      "image/jpeg",
    );
  }
  return targets.map((target) => target.path);
}

/** Every reference lives under its owner's folder (Storage RLS), which names the copy's folder too. */
function preparedPathFor(sourcePath: string, longEdge: number): string {
  const ownerId = sourcePath.split("/")[0];
  if (!ownerId) throw new AppError("validation", "A reference path has no owner folder.");
  const key = createHash("sha1").update(sourcePath).digest("hex").slice(0, 24);
  return storagePaths.preparedReference(ownerId, key, longEdge);
}
