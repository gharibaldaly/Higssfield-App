"use client";

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image"));
    image.src = src;
  });
}

/** Average colour of a normalised region (defaults to the central 50%). */
export async function averageColor(
  src: string,
  region: { x: number; y: number; w: number; h: number } = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  const sampleWidth = Math.max(1, Math.round(image.naturalWidth * region.w));
  const sampleHeight = Math.max(1, Math.round(image.naturalHeight * region.h));
  const scale = Math.min(1, 200 / Math.max(sampleWidth, sampleHeight));
  canvas.width = Math.max(1, Math.round(sampleWidth * scale));
  canvas.height = Math.max(1, Math.round(sampleHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(
    image,
    image.naturalWidth * region.x,
    image.naturalHeight * region.y,
    sampleWidth,
    sampleHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    r += data[index]!;
    g += data[index + 1]!;
    b += data[index + 2]!;
  }
  return toHex(r / pixels, g / pixels, b / pixels);
}

/** Colour at a normalised point, averaged over a small square to avoid noise. */
export async function sampleAt(
  src: string,
  point: { x: number; y: number },
  radiusPx = 3,
): Promise<string> {
  const image = await loadImage(src);
  const size = radiusPx * 2 + 1;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas unavailable");
  const cx = point.x * image.naturalWidth;
  const cy = point.y * image.naturalHeight;
  context.drawImage(image, cx - radiusPx, cy - radiusPx, size, size, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3]! === 0) continue;
    r += data[index]!;
    g += data[index + 1]!;
    b += data[index + 2]!;
    count += 1;
  }
  if (count === 0) return "#000000";
  return toHex(r / count, g / count, b / count);
}
