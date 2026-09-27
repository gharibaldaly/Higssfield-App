import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  colourDistance,
  edgeColourStats,
  framedCanvas,
  hexToRgb,
  medianColour,
  parseAspectRatio,
  rgbToHex,
} from "@/lib/images/framing";
import { finishCatalogueImage, sampleSwatchColour } from "@/lib/images/process";

async function garmentOn(
  background: string,
  box: { left: number; top: number; width: number; height: number },
  size = { width: 1000, height: 1000 },
): Promise<Buffer> {
  const garment = await sharp({
    create: { width: box.width, height: box.height, channels: 3, background: "#AA3355" },
  })
    .png()
    .toBuffer();
  return sharp({ create: { ...size, channels: 3, background } })
    .composite([{ input: garment, left: box.left, top: box.top }])
    .png()
    .toBuffer();
}

async function pixelAt(buffer: Buffer, x: number, y: number): Promise<string> {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return rgbToHex([data[offset]!, data[offset + 1]!, data[offset + 2]!]);
}

describe("framing helpers", () => {
  it("parses aspect ratios and colours", () => {
    expect(parseAspectRatio("4:5")).toBeCloseTo(0.8);
    expect(parseAspectRatio("square")).toBeNull();
    expect(hexToRgb("#FFB8CB")).toEqual([255, 184, 203]);
    expect(hexToRgb("nope")).toBeNull();
    expect(rgbToHex([255, 184, 203])).toBe("#FFB8CB");
    expect(colourDistance([255, 255, 255], [247, 250, 255])).toBe(8);
  });

  it("frames a tall garment with the margin on its height", () => {
    const frame = framedCanvas({ width: 400, height: 600 }, 4 / 5, 8);
    expect(frame).toEqual({ width: 571, height: 714, left: 85, top: 57 });
    expect(frame.top / frame.height).toBeCloseTo(0.08, 2);
  });

  it("frames a wide garment with the margin on its width", () => {
    const frame = framedCanvas({ width: 800, height: 400 }, 4 / 5, 8);
    expect(frame.width).toBe(952);
    expect(frame.left / frame.width).toBeCloseTo(0.08, 2);
    expect(frame.width / frame.height).toBeCloseTo(0.8, 2);
  });

  it("never makes the canvas smaller than the garment", () => {
    expect(framedCanvas({ width: 500, height: 500 }, 1, 0)).toEqual({
      width: 500,
      height: 500,
      left: 0,
      top: 0,
    });
  });

  it("takes the median colour, ignoring a few bright highlights", () => {
    const pixels = new Uint8Array([
      ...[31, 42, 68],
      ...[30, 40, 70],
      ...[250, 250, 250],
      ...[29, 41, 69],
      ...[32, 40, 71],
    ]);
    expect(medianColour(pixels)).toEqual([31, 41, 70]);
  });

  it("reads the colour around the edge and how flat it is", () => {
    const width = 20;
    const height = 20;
    const pixels = new Uint8Array(width * height * 3).fill(255);
    for (let y = 8; y < 12; y += 1) {
      for (let x = 8; x < 12; x += 1) pixels.set([170, 51, 85], (y * width + x) * 3);
    }
    expect(edgeColourStats(pixels, width, height)).toEqual({
      colour: [255, 255, 255],
      uniformity: 1,
    });
  });
});

describe("finishCatalogueImage", () => {
  const canvas = { aspectRatio: "4:5", background: "#FFFFFF", paddingPercent: 8, reframe: true };

  it("trims to the garment and re-pads it centred with the catalogue margin", async () => {
    const source = await garmentOn("#FFFFFF", { left: 100, top: 200, width: 300, height: 500 });
    const finished = await finishCatalogueImage(source, canvas);
    expect(finished).toMatchObject({
      reframed: true,
      changed: true,
      backgroundOk: true,
      edgeColour: "#FFFFFF",
      width: 476,
      height: 595,
    });
    expect(await pixelAt(finished.data, 238, 297)).toBe("#AA3355");
    expect(await pixelAt(finished.data, 5, 5)).toBe("#FFFFFF");
    // 8% margin above the garment: 595 × 0.08 ≈ 47 px of background.
    expect(await pixelAt(finished.data, 238, 44)).toBe("#FFFFFF");
    expect(await pixelAt(finished.data, 238, 50)).toBe("#AA3355");
  });

  it("flags an off-white background and pads with it to avoid seams", async () => {
    const source = await garmentOn("#EEEEEE", { left: 300, top: 250, width: 400, height: 500 });
    const finished = await finishCatalogueImage(source, canvas);
    expect(finished.backgroundOk).toBe(false);
    expect(finished.edgeColour).toBe("#EEEEEE");
    expect(await pixelAt(finished.data, 2, 2)).toBe("#EEEEEE");
  });

  it("leaves busy backgrounds unframed and flags them", async () => {
    const gradient = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><defs><linearGradient id="g"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#555555"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
    const finished = await finishCatalogueImage(gradient, canvas);
    expect(finished).toMatchObject({ reframed: false, backgroundOk: false, edgeColour: null });
  });

  it("keeps close-ups as generated when they already match the aspect ratio", async () => {
    const source = await garmentOn(
      "#FFFFFF",
      { left: 0, top: 0, width: 800, height: 1000 },
      { width: 800, height: 1000 },
    );
    const finished = await finishCatalogueImage(source, { ...canvas, reframe: false });
    expect(finished).toMatchObject({ changed: false, reframed: false, width: 800, height: 1000 });
  });

  it("does not reframe when the trim would swallow a pale garment", async () => {
    const source = await garmentOn("#FFFFFF", { left: 450, top: 450, width: 60, height: 60 });
    const finished = await finishCatalogueImage(source, canvas);
    expect(finished.reframed).toBe(false);
    expect(finished.width / finished.height).toBeCloseTo(0.8, 2);
  });
});

describe("sampleSwatchColour", () => {
  it("reads the fabric colour from the centre of a swatch photo", async () => {
    const swatch = await garmentOn("#FFFFFF", { left: 200, top: 200, width: 600, height: 600 });
    expect(await sampleSwatchColour(swatch)).toBe("#AA3355");
  });
});
