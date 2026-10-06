import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";

import { prepareReference } from "@/lib/images/process";
import { downloadObject, signPaths, uploadObject } from "@/lib/storage/objects";
import { storagePaths } from "@/lib/storage/paths";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Small copies of stored images, so the studio stops serving 24-megapixel
 * phone photos and 4K results everywhere (Supabase egress, 2026-10-06):
 * - "thumb": at most 768 px on the long side, for tiles and previews;
 * - "prep": at most 2560 px, EXIF-upright sRGB JPEG, for the references sent
 *   to Higgsfield and for what the director brain reads (it resizes to 1568 px
 *   anyway).
 * The originals stay untouched for the compare view, the sheet crops and the
 * downloads. A copy is keyed by its source path, so it is made once and
 * reused; both live under the owner's `derived/` folder (Storage RLS).
 */

export const THUMB_LONG_EDGE = 768;
export const REFERENCE_LONG_EDGE = 2560;

export type DerivativeKind = "thumb" | "prep";

/** The owner's folder of a stored path, and a short stable key for the path. */
function ownerAndKey(sourcePath: string): { ownerId: string; key: string } {
  const ownerId = sourcePath.split("/")[0];
  if (!ownerId) throw new Error(`A storage path has no owner folder: ${sourcePath}`);
  return { ownerId, key: createHash("sha1").update(sourcePath).digest("hex").slice(0, 24) };
}

/** Where a re-encoded reference of the given size lives (shared with reference-prep). */
export function preparedPathFor(sourcePath: string, longEdge: number): string {
  const { ownerId, key } = ownerAndKey(sourcePath);
  return storagePaths.preparedReference(ownerId, key, longEdge);
}

export function derivedPath(sourcePath: string, kind: DerivativeKind): string {
  if (kind === "prep") return preparedPathFor(sourcePath, REFERENCE_LONG_EDGE);
  const { ownerId, key } = ownerAndKey(sourcePath);
  return storagePaths.thumbnail(ownerId, key);
}

/** A tile-sized JPEG of an image: upright, at most 768 px on the long side. */
export async function makeThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({
      width: THUMB_LONG_EDGE,
      height: THUMB_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toColourspace("srgb")
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

/** Whether a stored file can have image derivatives (videos and unknown files cannot). */
export function canDerive(mimeType: string | null | undefined): boolean {
  return !mimeType || mimeType.startsWith("image/");
}

/**
 * Makes the copies of an image that do not exist yet. The original is read
 * once when it is not given. Never throws for a copy that could not be made:
 * the studio falls back to the original.
 */
export async function ensureDerivatives(
  supabase: TypedSupabaseClient,
  sourcePath: string,
  original?: Buffer,
  kinds: DerivativeKind[] = ["thumb", "prep"],
): Promise<{ made: DerivativeKind[]; failed: DerivativeKind[] }> {
  const targets = kinds.map((kind) => ({ kind, path: derivedPath(sourcePath, kind) }));
  // A signed URL only comes back for an object that exists: the cheapest existence check.
  const existing = await signPaths(
    supabase,
    targets.map((target) => target.path),
    { cache: false },
  );
  const missing = targets.filter((target) => !existing.has(target.path));
  const made: DerivativeKind[] = [];
  const failed: DerivativeKind[] = [];
  if (missing.length === 0) return { made, failed };
  let source = original;
  try {
    source ??= await downloadObject(supabase, sourcePath);
  } catch (error) {
    console.warn("Derivatives: source unreadable", sourcePath, error);
    return { made, failed: missing.map((target) => target.kind) };
  }
  for (const target of missing) {
    try {
      const data =
        target.kind === "thumb"
          ? await makeThumbnail(source)
          : await prepareReference(source, REFERENCE_LONG_EDGE);
      await uploadObject(supabase, target.path, data, "image/jpeg");
      made.push(target.kind);
    } catch (error) {
      console.warn(`Derivatives: ${target.kind} failed`, sourcePath, error);
      failed.push(target.kind);
    }
  }
  return { made, failed };
}

/**
 * Signed URLs for tiles: the small copy of each path when it exists, else
 * the original. `fallback` may carry the originals' signed URLs already in hand.
 */
export async function thumbUrls(
  supabase: TypedSupabaseClient,
  paths: (string | null | undefined)[],
  fallback?: Map<string, string>,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const thumbs = new Map(unique.map((path) => [derivedPath(path, "thumb"), path] as const));
  const signedThumbs = await signPaths(supabase, [...thumbs.keys()]);
  const needOriginal: string[] = [];
  for (const [thumbPath, path] of thumbs) {
    const url = signedThumbs.get(thumbPath);
    if (url) result.set(path, url);
    else if (fallback?.get(path)) result.set(path, fallback.get(path)!);
    else needOriginal.push(path);
  }
  if (needOriginal.length > 0) {
    const originals = await signPaths(supabase, needOriginal);
    for (const path of needOriginal) {
      const url = originals.get(path);
      if (url) result.set(path, url);
    }
  }
  return result;
}

/**
 * What the director brain reads: the prepared copy when it exists, else the
 * original, whose download also makes the copies for next time. The brain
 * resizes to 1568 px, so nothing is lost.
 */
export async function downloadForBrain(
  supabase: TypedSupabaseClient,
  sourcePath: string,
): Promise<Buffer> {
  try {
    return await downloadObject(supabase, derivedPath(sourcePath, "prep"));
  } catch {
    const original = await downloadObject(supabase, sourcePath);
    await ensureDerivatives(supabase, sourcePath, original);
    return original;
  }
}
