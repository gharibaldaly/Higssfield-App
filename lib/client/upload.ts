"use client";

import { ACCEPTED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "@/lib/domain/product";
import { STUDIO_BUCKET } from "@/lib/storage/paths";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AcceptedPhotoType = (typeof ACCEPTED_PHOTO_TYPES)[number];

export function isAcceptedPhoto(file: File): file is File & { type: AcceptedPhotoType } {
  return (
    (ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type) && file.size <= MAX_PHOTO_BYTES
  );
}

export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * Upload straight from the browser to the private `studio` bucket using the
 * owner's session (Storage RLS limits writes to the owner's own folder), so
 * large phone photos never pass through a Server Action.
 */
export async function uploadToStudio(path: string, file: Blob, contentType: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.storage.from(STUDIO_BUCKET).upload(path, file, {
    contentType,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);
}

export function extensionForType(type: string): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}
