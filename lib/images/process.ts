import "server-only";

import sharp from "sharp";

import {
  BACKGROUND_TOLERANCE,
  colourDistance,
  edgeColourStats,
  framedCanvas,
  hexToRgb,
  medianColour,
  parseAspectRatio,
  rgbToHex,
} from "@/lib/images/framing";
import type { LlmImage } from "@/lib/providers/llm/types";
import type { NormalizedRect } from "@/lib/sheet/layout";

/** Claude and Gemini both work best with ≤1568 px on the long edge. */
const LLM_LONG_EDGE = 1568;

export async function toLlmImage(
  buffer: Buffer,
  caption: string,
  options: { longEdge?: number } = {},
): Promise<LlmImage> {
  const longEdge = options.longEdge ?? LLM_LONG_EDGE;
  const data = await sharp(buffer)
    .rotate()
    .resize({
      width: longEdge,
      height: longEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { mimeType: "image/jpeg", base64: data.toString("base64"), caption };
}

/** Long edges tried, largest first, when inline brain images must fit a size budget. */
const SHRINK_LONG_EDGES = [
  1568, 1408, 1280, 1152, 1024, 960, 896, 832, 768, 704, 640, 576, 512, 448, 384,
];

const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/**
 * Re-encodes brain images at the largest common long edge whose base64 fits
 * `maxBase64Chars` in total, or null when even the smallest edge does not.
 * For gateways that count inline image data as text.
 */
export async function shrinkLlmImages(
  images: LlmImage[],
  maxBase64Chars: number,
): Promise<{ images: LlmImage[]; longEdge: number } | null> {
  const sources = images.map((image) => Buffer.from(image.base64, "base64"));
  const encode = (longEdge: number) =>
    Promise.all(
      sources.map((source) =>
        sharp(source)
          .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer(),
      ),
    );
  // Sizes fall as the edge falls, so a binary search finds the largest edge that fits.
  let best: { buffers: Buffer[]; longEdge: number } | null = null;
  let low = 0;
  let high = SHRINK_LONG_EDGES.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const longEdge = SHRINK_LONG_EDGES[middle]!;
    const buffers = await encode(longEdge);
    const total = buffers.reduce((sum, buffer) => sum + base64Length(buffer.length), 0);
    if (total <= maxBase64Chars) {
      best = { buffers, longEdge };
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (!best) return null;
  const { buffers, longEdge } = best;
  return {
    longEdge,
    images: images.map((image, index) => ({
      mimeType: "image/jpeg",
      base64: buffers[index]!.toString("base64"),
      caption: image.caption,
    })),
  };
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

/**
 * Pads an image to the catalogue aspect ratio with the catalogue background
 * colour. Never scales or recompresses the garment pixels beyond PNG encoding.
 */
export async function fitToCanvas(
  buffer: Buffer,
  options: { aspectRatio: string; background: string },
): Promise<{ data: Buffer; width: number; height: number; changed: boolean }> {
  const target = parseAspectRatio(options.aspectRatio);
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

export type CatalogueCanvas = {
  aspectRatio: string;
  background: string;
  paddingPercent: number;
  /** Trim to the garment and re-pad with uniform margins (front, back and colourways). */
  reframe: boolean;
};

export type CatalogueFinish = {
  data: Buffer;
  width: number;
  height: number;
  changed: boolean;
  reframed: boolean;
  /** The flat colour around the image edge, or null when the edge is not one colour. */
  edgeColour: string | null;
  /** True when the edge is one flat colour matching the catalogue background. */
  backgroundOk: boolean;
};

/** A trim that keeps less than this share of either side most likely ate a pale garment. */
const MIN_TRIM_SHARE = 0.15;

/**
 * Finishes a catalogue result without resampling the garment:
 * - reads the colour around the edge (does the background match the catalogue?);
 * - for front, back and colourway images, trims the flat background away and
 *   re-pads the garment with the catalogue margin, so every product sits at
 *   the same scale in the grid;
 * - pads to the catalogue aspect ratio with the image's own edge colour, so a
 *   near-white background never shows a seam.
 * Trimmed rows and columns only ever hold pixels within the trim threshold of
 * the background colour.
 */
export async function finishCatalogueImage(
  buffer: Buffer,
  canvas: CatalogueCanvas,
): Promise<CatalogueFinish> {
  let source = buffer;
  let changed = false;
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) {
    return {
      data: buffer,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      changed: false,
      reframed: false,
      edgeColour: null,
      backgroundOk: false,
    };
  }
  // Transparent pixels (some models return cut-outs) sit on the catalogue background.
  if (meta.hasAlpha && !(await sharp(source).stats()).isOpaque) {
    source = await sharp(source).flatten({ background: canvas.background }).png().toBuffer();
    changed = true;
  }

  const sample = await sharp(source)
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stats = edgeColourStats(sample.data, sample.info.width, sample.info.height);
  const uniform = stats.uniformity >= 0.96;
  const target = hexToRgb(canvas.background) ?? [255, 255, 255];
  const edgeColour = uniform ? rgbToHex(stats.colour) : null;
  const backgroundOk = uniform && colourDistance(stats.colour, target) <= BACKGROUND_TOLERANCE;
  const fill = edgeColour ?? canvas.background;
  const aspect = parseAspectRatio(canvas.aspectRatio);

  if (canvas.reframe && uniform && aspect) {
    try {
      const trimmed = await sharp(source)
        .trim({ background: fill, threshold: 12 })
        .png()
        .toBuffer({ resolveWithObject: true });
      const { width, height } = trimmed.info;
      const plausible =
        width >= meta.width * MIN_TRIM_SHARE && height >= meta.height * MIN_TRIM_SHARE;
      if (plausible) {
        const frame = framedCanvas({ width, height }, aspect, canvas.paddingPercent);
        const data = await sharp(trimmed.data)
          .extend({
            top: frame.top,
            bottom: frame.height - height - frame.top,
            left: frame.left,
            right: frame.width - width - frame.left,
            background: fill,
          })
          .png()
          .toBuffer();
        return {
          data,
          width: frame.width,
          height: frame.height,
          changed: true,
          reframed: true,
          edgeColour,
          backgroundOk,
        };
      }
    } catch {
      // Nothing to trim (or an unreadable edge): fall back to plain padding.
    }
  }

  const fitted = await fitToCanvas(source, { aspectRatio: canvas.aspectRatio, background: fill });
  return {
    data: fitted.data,
    width: fitted.width,
    height: fitted.height,
    changed: changed || fitted.changed,
    reframed: false,
    edgeColour,
    backgroundOk,
  };
}

/** The fabric colour of a swatch photo: the median of its centre, as #RRGGBB. */
export async function sampleSwatchColour(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .rotate()
    .resize({ width: 160, height: 160, fit: "cover", position: "centre" })
    .extract({ left: 40, top: 40, width: 80, height: 80 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return rgbToHex(medianColour(data));
}
