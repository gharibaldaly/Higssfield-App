import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  cropRegions,
  fitToCanvas,
  probeImage,
  toLlmImage,
  toPixelRect,
} from "@/lib/images/process";
import { renderPlaceholder } from "@/lib/providers/higgsfield/mock";

async function solid(width: number, height: number, colour = "#aa3355"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();
}

describe("toPixelRect", () => {
  it("converts and clamps normalised boxes", () => {
    expect(toPixelRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 800, 400)).toEqual({
      left: 200,
      top: 200,
      width: 400,
      height: 100,
    });
    expect(toPixelRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100)).toEqual({
      left: 90,
      top: 90,
      width: 10,
      height: 10,
    });
    expect(toPixelRect({ x: 1, y: 1, w: 0.001, h: 0.001 }, 100, 100)).toEqual({
      left: 99,
      top: 99,
      width: 1,
      height: 1,
    });
  });
});

describe("image processing", () => {
  it("crops regions losslessly as PNG", async () => {
    const source = await solid(1600, 900);
    const [crop] = await cropRegions(source, [{ x: 0.5, y: 0.5, w: 0.25, h: 0.5 }]);
    expect(crop).toMatchObject({ width: 400, height: 450 });
    const meta = await sharp(crop!.data).metadata();
    expect(meta).toMatchObject({ format: "png", width: 400, height: 450 });
  });

  it("pads to the catalogue aspect ratio without scaling the garment", async () => {
    const source = await solid(1000, 1000);
    const fitted = await fitToCanvas(source, { aspectRatio: "4:5", background: "#F7F3EE" });
    expect(fitted).toMatchObject({ width: 1000, height: 1250, changed: true });
    const { data, info } = await sharp(fitted.data).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [
      ...data.subarray(
        (y * info.width + x) * info.channels,
        (y * info.width + x) * info.channels + 3,
      ),
    ];
    expect(pixel(500, 5)).toEqual([0xf7, 0xf3, 0xee]);
    expect(pixel(500, 625)).toEqual([0xaa, 0x33, 0x55]);

    const unchanged = await fitToCanvas(await solid(800, 1000), {
      aspectRatio: "4:5",
      background: "#FFFFFF",
    });
    expect(unchanged.changed).toBe(false);
  });

  it("widens tall images and ignores unknown ratios", async () => {
    const tall = await fitToCanvas(await solid(400, 1000), {
      aspectRatio: "1:1",
      background: "#FFFFFF",
    });
    expect(tall).toMatchObject({ width: 1000, height: 1000, changed: true });
    const ignored = await fitToCanvas(await solid(400, 1000), {
      aspectRatio: "square",
      background: "#FFFFFF",
    });
    expect(ignored.changed).toBe(false);
  });

  it("probes images and rejects garbage", async () => {
    expect(await probeImage(await solid(30, 20))).toEqual({
      width: 30,
      height: 20,
      mimeType: "image/png",
    });
    expect(await probeImage(Buffer.from("not an image"))).toBeNull();
  });

  it("downsizes photos for the director brain", async () => {
    const image = await toLlmImage(await solid(4000, 3000), 'Piece 1 "Robe" — front');
    const meta = await sharp(Buffer.from(image.base64, "base64")).metadata();
    expect(image.mimeType).toBe("image/jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);
  });

  it("renders mock placeholders at the requested ratio", async () => {
    const png = await renderPlaceholder({
      ratio: 9 / 16,
      reference: await solid(300, 300),
      accent: "#4D0011",
    });
    const meta = await sharp(png).metadata();
    expect(meta.width! / meta.height!).toBeCloseTo(9 / 16, 2);
  });
});
