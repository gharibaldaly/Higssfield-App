import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";

import { SHEET_DESIGN, type SheetPhotoPlan } from "@/lib/domain/sheet";
import { composeSheetLayout } from "@/lib/sheet/composed";
import type { ComposedLayout, NormalizedRect } from "@/lib/sheet/layout";
import {
  BOARD,
  cutCardReference,
  describeSource,
  renderBoard,
  type SourceImage,
} from "@/lib/sheet/render";

type Rgb = [number, number, number];

/** A 1200×1600 "photo": grey, with a red and a blue square where the details are. */
async function photo(): Promise<Buffer> {
  const square = (background: string) =>
    sharp({ create: { width: 240, height: 240, channels: 3, background } })
      .png()
      .toBuffer();
  return sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#808080" } })
    .composite([
      { input: await square("#D01010"), left: 120, top: 160 },
      { input: await square("#1030D0"), left: 720, top: 1000 },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function pixel(image: Buffer, x: number, y: number): Promise<Rgb> {
  const { data } = await sharp(image)
    .extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}

const near = (actual: Rgb, expected: Rgb, tolerance = 40) =>
  actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance);

const centre = (rect: NormalizedRect) => ({
  x: (rect.x + rect.w / 2) * BOARD.width,
  y: (rect.y + rect.h / 2) * BOARD.height,
});

// Boxes on the photo, as the brain gives them: [ymin, xmin, ymax, xmax] on 0–1000.
const RED = [100, 100, 250, 300];
const BLUE = [625, 600, 775, 800];

const plan: SheetPhotoPlan = {
  title: "Royal Blue Lace & Satin Mini Slip Dress",
  overviewBullets: ["Stretch satin body", "Corded floral lace panel", "Clear strap sliders"],
  front: { photo: 1, box: [0, 0, 1000, 1000] },
  back: null,
  detailCards: Array.from({ length: 6 }, (_, index) => ({
    label: index % 2 === 0 ? "Red square" : "Blue square",
    description: "",
    photo: 1,
    box: index % 2 === 0 ? RED : BLUE,
  })),
  bottomCards: [
    { kind: "swatch", label: "Red", description: "", photo: 1, box: RED },
    { kind: "swatch", label: "Blue", description: "", photo: 1, box: BLUE },
  ],
};

describe("sheet rendering from photos", () => {
  let layout: ComposedLayout;
  let sources: Map<string, SourceImage>;
  let board: Buffer;

  beforeAll(async () => {
    const source = await describeSource(await photo());
    sources = new Map([["p/front.jpg", source]]);
    layout = composeSheetLayout({
      plan,
      photos: [{ path: "p/front.jpg", kind: "front", pieceId: "dress", aspect: 0.75 }],
      approved: { front: null, back: null },
      pieceFronts: [],
      canvas: BOARD,
    }).layout;
    board = (
      await renderBoard(
        layout,
        { title: plan.title, bullets: plan.overviewBullets, missingImage: "No photo" },
        sources,
      )
    ).data;
  }, 60_000);

  it("renders a 4K board on the sheet's off-white background", async () => {
    const meta = await sharp(board).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([3840, 2160, "jpeg"]);
    expect(near(await pixel(board, 6, 6), [0xfa, 0xf8, 0xf5], 6)).toBe(true);
  });

  it("fills each detail card with the photo region it names", async () => {
    for (const card of layout.cards.filter((item) => item.role === "detail")) {
      const { x, y } = centre(card.imageRect!);
      const expected: Rgb = card.label === "Red square" ? [0xd0, 0x10, 0x10] : [0x10, 0x30, 0xd0];
      expect(near(await pixel(board, x, y), expected), card.id).toBe(true);
    }
  });

  it("shows the whole photo on the hero card and says so where a photo is missing", async () => {
    const hero = layout.cards.find((card) => card.id === "hero")!;
    const { x, y } = centre(hero.imageRect!);
    expect(near(await pixel(board, x, y), [0x80, 0x80, 0x80])).toBe(true);
    // No back photo: the back card stays white apart from its note.
    const back = layout.cards.find((card) => card.id === "back")!;
    const corner = await pixel(
      board,
      back.imageRect!.x * BOARD.width + 8,
      back.imageRect!.y * BOARD.height + 8,
    );
    expect(near(corner, [255, 255, 255], 6)).toBe(true);
  });

  it("writes the title in charcoal", async () => {
    const title = layout.cards.find((card) => card.id === "title")!;
    const { data, info } = await sharp(board)
      .extract({
        left: Math.round(title.rect.x * BOARD.width),
        top: Math.round(title.rect.y * BOARD.height),
        width: Math.round(title.rect.w * BOARD.width),
        height: Math.round(title.rect.h * BOARD.height),
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index]! < 90 && data[index + 1]! < 90 && data[index + 2]! < 90) dark += 1;
    }
    expect(dark).toBeGreaterThan(2000);
    expect(SHEET_DESIGN.heading).toBe("#1A1A1A");
  });

  it("cuts the ads' references from the full-resolution photo, not from the board", async () => {
    const detail = layout.cards.find((card) => card.id === "detail-1")!;
    const cut = await cutCardReference(detail, sources);
    expect(cut).not.toBeNull();
    const box = detail.sources[0]!.box;
    // The crop is the region at the photo's own resolution (1200×1600), no larger.
    expect(cut!.width).toBe(Math.round(box.w * 1200));
    expect(cut!.height).toBe(Math.round(box.h * 1600));
    expect(near(await pixel(cut!.data, cut!.width / 2, cut!.height / 2), [0xd0, 0x10, 0x10])).toBe(
      true,
    );
    const back = layout.cards.find((card) => card.id === "back")!;
    expect(await cutCardReference(back, sources)).toBeNull();
  });

  it("reads photos upright, as the brain saw them", async () => {
    // A landscape JPEG tagged "rotate 90°" is a portrait photo once turned.
    const tagged = await sharp({
      create: { width: 400, height: 300, channels: 3, background: "#808080" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const upright = await describeSource(tagged);
    expect([upright.width, upright.height]).toEqual([300, 400]);
  });
});
