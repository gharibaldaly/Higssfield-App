import "server-only";

import sharp from "sharp";

import type { LlmImage } from "@/lib/providers/llm/types";
import type { NormalizedRect } from "@/lib/sheet/layout";

/** Claude and Gemini both work best with ≤1568 px on the long edge. */
const LLM_LONG_EDGE = 1568;

export async function toLlmImage(buffer: Buffer, caption: string): Promise<LlmImage> {
  const data = await sharp(buffer)
    .rotate()
    .resize({
      width: LLM_LONG_EDGE,
      height: LLM_LONG_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { mimeType: "image/jpeg", base64: data.toString("base64"), caption };
}

export type ImageInfo = { width: number; height: number; mimeType: string };

export async function probeImage(buffer: Buffer): Promise<ImageInfo | null> {
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;
    const format = meta.format === "jpeg" ? "image/jpeg" : `image/${meta.format}`;
    return { width: meta.width, height: meta.height, mimeType: format };
  } catch {
    return null;
  }
}

/** Pixel rectangle for a normalised box, clamped to the image. */
export function toPixelRect(box: NormalizedRect, width: number, height: number) {
  const left = Math.max(0, Math.min(width - 1, Math.round(box.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(box.y * height)));
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(box.w * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(box.h * height)));
  return { left, top, width: cropWidth, height: cropHeight };
}

/** Lossless PNG crops of normalised regions (auto-crops from product sheets). */
export async function cropRegions(
  buffer: Buffer,
  boxes: NormalizedRect[],
): Promise<{ data: Buffer; width: number; height: number }[]> {
  const image = sharp(buffer).rotate();
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("Unreadable image");
  // After rotate(), EXIF orientations 5–8 swap width and height.
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  return Promise.all(
    boxes.map(async (box) => {
      const rect = toPixelRect(box, width, height);
      const data = await sharp(buffer).rotate().extract(rect).png().toBuffer();
      return { data, width: rect.width, height: rect.height };
    }),
  );
}

function parseAspect(aspect: string): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  if (!match) return null;
  return Number(match[1]) / Number(match[2]);
}

/**
 * Pads an image to the catalogue aspect ratio with the catalogue background
 * colour. Never scales or recompresses the garment pixels beyond PNG encoding.
 */
export async function fitToCanvas(
  buffer: Buffer,
  options: { aspectRatio: string; background: string },
): Promise<{ data: Buffer; width: number; height: number; changed: boolean }> {
  const target = parseAspect(options.aspectRatio);
  const meta = await sharp(buffer).metadata();
  if (!target || !meta.width || !meta.height) {
    return { data: buffer, width: meta.width ?? 0, height: meta.height ?? 0, changed: false };
  }
  const current = meta.width / meta.height;
  if (Math.abs(current - target) / target < 0.01) {
    return { data: buffer, width: meta.width, height: meta.height, changed: false };
  }
  let width = meta.width;
  let height = meta.height;
  if (current > target) height = Math.round(width / target);
  else width = Math.round(height * target);
  const top = Math.floor((height - meta.height) / 2);
  const left = Math.floor((width - meta.width) / 2);
  const data = await sharp(buffer)
    .extend({
      top,
      bottom: height - meta.height - top,
      left,
      right: width - meta.width - left,
      background: options.background,
    })
    .png()
    .toBuffer();
  return { data, width, height, changed: true };
}
