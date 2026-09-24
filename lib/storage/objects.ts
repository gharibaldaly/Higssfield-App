import "server-only";

import { AppError } from "@/lib/errors";
import { SIGNED_URL_TTL_S, STUDIO_BUCKET } from "@/lib/storage/paths";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** Batch-sign storage paths; unknown or failed paths map to null. */
export async function signPaths(
  supabase: TypedSupabaseClient,
  paths: (string | null | undefined)[],
  options: { expiresIn?: number; download?: boolean } = {},
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const { data, error } = await supabase.storage
    .from(STUDIO_BUCKET)
    .createSignedUrls(unique, options.expiresIn ?? SIGNED_URL_TTL_S, {
      download: options.download,
    });
  if (error) {
    console.error("createSignedUrls failed", error.message);
    return result;
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) result.set(item.path, item.signedUrl);
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
): Promise<void> {
  const { error } = await supabase.storage.from(STUDIO_BUCKET).upload(path, data, {
    contentType,
    upsert: true,
    cacheControl: "31536000",
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
}
