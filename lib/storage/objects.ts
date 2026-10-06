import "server-only";

import { AppError } from "@/lib/errors";
import { SIGNED_URL_TTL_S, STUDIO_BUCKET } from "@/lib/storage/paths";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Signed URLs remembered per server instance. A fresh token on every render
 * made every image a new URL, so the browser downloaded every tile again on
 * each refresh (the batch board refreshes after every step of work). A URL
 * signed for the asked time plus this margin is reused while it still has the
 * asked time left, so renders repeat the same URL and the browser's cache
 * (the objects are uploaded with a one-year cache header) answers instead
 * of Supabase.
 */
const SIGNED_URL_MARGIN_S = 6 * 60 * 60;
const SIGNED_URL_CACHE_LIMIT = 5000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/** Forgets every remembered URL (tests). */
export function forgetSignedUrls(): void {
  signedUrlCache.clear();
}

/**
 * Batch-sign storage paths; unknown or failed paths map to null. With
 * `cache: false` the URLs are signed fresh for exactly `expiresIn` and not
 * remembered: for an existence check (a remembered URL is no proof that the
 * object still exists) and for temporary files.
 */
export async function signPaths(
  supabase: TypedSupabaseClient,
  paths: (string | null | undefined)[],
  options: { expiresIn?: number; download?: boolean; cache?: boolean } = {},
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const expiresIn = options.expiresIn ?? SIGNED_URL_TTL_S;
  const cache = options.cache ?? true;
  const now = Date.now();
  const keyOf = (path: string) => `${options.download ? "d" : "v"}:${path}`;
  const missing: string[] = [];
  for (const path of unique) {
    const hit = cache ? signedUrlCache.get(keyOf(path)) : undefined;
    if (hit && hit.expiresAt - now >= expiresIn * 1000) result.set(path, hit.url);
    else missing.push(path);
  }
  if (missing.length === 0) return result;
  const signedFor = cache ? expiresIn + SIGNED_URL_MARGIN_S : expiresIn;
  const { data, error } = await supabase.storage
    .from(STUDIO_BUCKET)
    .createSignedUrls(missing, signedFor, { download: options.download });
  if (error) {
    console.error("createSignedUrls failed", error.message);
    return result;
  }
  if (signedUrlCache.size > SIGNED_URL_CACHE_LIMIT) signedUrlCache.clear();
  for (const item of data ?? []) {
    if (!item.path || !item.signedUrl) continue;
    result.set(item.path, item.signedUrl);
    if (cache) {
      signedUrlCache.set(keyOf(item.path), {
        url: item.signedUrl,
        expiresAt: now + signedFor * 1000,
      });
    }
  }
  return result;
}

export async function signPath(
  supabase: TypedSupabaseClient,
  path: string | null | undefined,
  expiresIn = SIGNED_URL_TTL_S,
): Promise<string | null> {
  if (!path) return null;
  return (await signPaths(supabase, [path], { expiresIn })).get(path) ?? null;
}

export async function uploadObject(
  supabase: TypedSupabaseClient,
  path: string,
  data: Buffer | Uint8Array,
  contentType: string,
  options: { cacheControl?: string } = {},
): Promise<void> {
  const { error } = await supabase.storage.from(STUDIO_BUCKET).upload(path, data, {
    contentType,
    upsert: true,
    cacheControl: options.cacheControl ?? "31536000",
  });
  if (error) {
    throw new AppError("provider_unavailable", "Could not save the file to Supabase Storage.", {
      detail: error.message,
      retryable: true,
    });
  }
}

export async function downloadObject(supabase: TypedSupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(STUDIO_BUCKET).download(path);
  if (error || !data) {
    throw new AppError("not_found", "Could not read a stored file.", {
      detail: error?.message ?? path,
    });
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function removeObjects(supabase: TypedSupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(STUDIO_BUCKET).remove(paths);
  if (error) console.warn("Storage cleanup failed", error.message);
  for (const path of paths) {
    signedUrlCache.delete(`v:${path}`);
    signedUrlCache.delete(`d:${path}`);
  }
}

/**
 * Removes every file directly inside a folder (no recursion). Used to clear
 * uploads that never got a database row, e.g. after an interrupted upload.
 */
export async function removeFolderFiles(
  supabase: TypedSupabaseClient,
  folder: string,
): Promise<void> {
  const { data, error } = await supabase.storage.from(STUDIO_BUCKET).list(folder, { limit: 1000 });
  if (error) {
    console.warn("Storage listing failed", folder, error.message);
    return;
  }
  // Folders come back as entries without an id; only files are removed.
  const files = (data ?? []).filter((entry) => entry.id).map((entry) => `${folder}/${entry.name}`);
  await removeObjects(supabase, files);
}
