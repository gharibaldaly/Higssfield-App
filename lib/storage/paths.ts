/** Every object lives in the private `studio` bucket under the owner's id. */
export const STUDIO_BUCKET = "studio";

export const SIGNED_URL_TTL_S = 60 * 60;

/** Signed reference URLs handed to Higgsfield must outlive a long provider queue. */
export const PROVIDER_REFERENCE_TTL_S = 24 * 60 * 60;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function extensionFor(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}

export const storagePaths = {
  sourcePhoto: (ownerId: string, productId: string, photoId: string, mimeType: string) =>
    `${ownerId}/products/${productId}/sources/${photoId}.${extensionFor(mimeType)}`,
  swatch: (ownerId: string, productId: string, fileId: string, mimeType: string) =>
    `${ownerId}/products/${productId}/swatches/${fileId}.${extensionFor(mimeType)}`,
  crop: (
    ownerId: string,
    productId: string,
    sheetId: string,
    cropId: string,
    mimeType = "image/png",
  ) =>
    `${ownerId}/products/${productId}/sheets/${sheetId}/crops/${cropId}.${extensionFor(mimeType)}`,
  /** The sheet board built from the photos; a new name for every render, so no cache shows an old one. */
  sheetImage: (ownerId: string, productId: string, sheetId: string, renderId: string) =>
    `${ownerId}/products/${productId}/sheets/${sheetId}/board-${renderId}.jpg`,
  /** A reference the owner uploaded for a free generation (not tied to a product). */
  freeReference: (ownerId: string, fileId: string, mimeType: string) =>
    `${ownerId}/free/references/${fileId}.${extensionFor(mimeType)}`,
  generation: (ownerId: string, generationId: string, mimeType: string) =>
    `${ownerId}/generations/${generationId}.${extensionFor(mimeType)}`,
  /** Temporary copies of brain images, deleted once the gateway has answered. */
  brainLinks: (ownerId: string, callId: string) => `${ownerId}/tmp/brain/${callId}`,
};

/** True when a storage path belongs to the given owner's folder. */
export function isOwnedPath(path: string, ownerId: string): boolean {
  return path.startsWith(`${ownerId}/`) && !path.includes("..");
}
