/**
 * Pure helpers for catalogue framing: every front, back and colourway image is
 * trimmed to the garment and re-padded with the same margins, so a grid of
 * thirty products lines up without anyone touching the garment pixels.
 */

export type Rgb = [number, number, number];

export function parseAspectRatio(aspect: string): number | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  if (!match) return null;
  const ratio = Number(match[1]) / Number(match[2]);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/** Largest per-channel difference (0 = identical, 255 = opposite). */
export function colourDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** Edge colours this close to the catalogue background still read as the same background. */
export const BACKGROUND_TOLERANCE = 10;

/**
 * Canvas for a trimmed garment: centred, with `paddingPercent` of clear margin
 * on the tighter axis, at the catalogue aspect ratio. Never smaller than the
 * garment, so nothing is ever scaled.
 */
export function framedCanvas(
  garment: { width: number; height: number },
  aspect: number,
  paddingPercent: number,
): { width: number; height: number; left: number; top: number } {
  const padding = Math.min(30, Math.max(0, paddingPercent)) / 100;
  const inner = 1 - 2 * padding;
  let width = garment.width / inner;
  let height = garment.height / inner;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;
  const finalWidth = Math.max(garment.width, Math.round(width));
  const finalHeight = Math.max(garment.height, Math.round(height));
  return {
    width: finalWidth,
    height: finalHeight,
    left: Math.floor((finalWidth - garment.width) / 2),
    top: Math.floor((finalHeight - garment.height) / 2),
  };
}

/**
 * Median colour of a ring of edge pixels and how much of the ring matches it.
 * `pixels` is raw RGB (3 channels) of a width × height image.
 */
export function edgeColourStats(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
  ringFraction = 0.03,
): { colour: Rgb; uniformity: number } {
  const ring = Math.max(2, Math.round(Math.min(width, height) * ringFraction));
  const samples: Rgb[] = [];
  for (let y = 0; y < height; y += 1) {
    const edgeRow = y < ring || y >= height - ring;
    for (let x = 0; x < width; x += 1) {
      if (!edgeRow && x >= ring && x < width - ring) continue;
      const offset = (y * width + x) * 3;
      samples.push([pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]);
    }
  }
  if (samples.length === 0) return { colour: [255, 255, 255], uniformity: 0 };
  const median = (channel: 0 | 1 | 2) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  };
  const colour: Rgb = [median(0), median(1), median(2)];
  const matching = samples.filter((sample) => colourDistance(sample, colour) <= 14).length;
  return { colour, uniformity: matching / samples.length };
}

/** Per-channel median of raw RGB pixels: robust to highlights, shadows and lace holes. */
export function medianColour(pixels: Uint8Array | Buffer): Rgb {
  const count = Math.floor(pixels.length / 3);
  if (count === 0) return [0, 0, 0];
  const channel = (offset: 0 | 1 | 2) => {
    const values = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) values[index] = pixels[index * 3 + offset]!;
    values.sort();
    return values[Math.floor(count / 2)]!;
  };
  return [channel(0), channel(1), channel(2)];
}
