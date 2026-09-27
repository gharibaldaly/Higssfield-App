import { z } from "zod";

/**
 * Product sheet layout (landscape 16:9). The same geometry is used twice:
 * 1. described to the image model so it draws the cards where we expect, and
 * 2. to auto-crop isolated reference images once the sheet is approved.
 * Coordinates are normalised (0–1) relative to the full canvas.
 */

export const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

export type NormalizedRect = z.infer<typeof normalizedRectSchema>;

export const SHEET_CROP_KINDS = [
  "front",
  "back",
  "detail",
  "pieces",
  "swatch",
  "matching",
] as const;
export type SheetCropKind = (typeof SHEET_CROP_KINDS)[number];

export const sheetCardSchema = z.object({
  id: z.string(),
  role: z.enum(["title", "hero", "bullets", "back", "detail", "bottom"]),
  cropKind: z.enum(SHEET_CROP_KINDS).nullable(),
  label: z.string().nullable(),
  rect: normalizedRectSchema,
  imageRect: normalizedRectSchema.nullable(),
});

export const sheetLayoutSchema = z.object({
  version: z.literal(1),
  aspectRatio: z.literal("16:9"),
  canvas: z.object({ width: z.number(), height: z.number() }),
  cards: z.array(sheetCardSchema),
});

export type SheetCard = z.infer<typeof sheetCardSchema>;
export type SheetLayout = z.infer<typeof sheetLayoutSchema>;

// Reference canvas in pixels; everything is normalised against it.
const W = 1600;
const H = 900;
const MARGIN = 40;
const GUTTER = 20;
const CARD_PADDING = 10;
const LABEL_BAND = 30;

type PxRect = { x: number; y: number; w: number; h: number };

function norm(rect: PxRect): NormalizedRect {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return { x: round(rect.x / W), y: round(rect.y / H), w: round(rect.w / W), h: round(rect.h / H) };
}

function inner(rect: PxRect, withLabel: boolean): PxRect {
  return {
    x: rect.x + CARD_PADDING,
    y: rect.y + CARD_PADDING,
    w: rect.w - CARD_PADDING * 2,
    h: rect.h - CARD_PADDING * 2 - (withLabel ? LABEL_BAND : 0),
  };
}

export type SheetLayoutInput = {
  detailLabels: string[];
  bottomCards: { kind: "pieces" | "matching" | "swatch"; label: string }[];
};

export function computeSheetLayout(input: SheetLayoutInput): SheetLayout {
  const innerW = W - MARGIN * 2;
  const innerH = H - MARGIN * 2;
  const leftW = innerW * 0.37 - GUTTER / 2;
  const rightX = MARGIN + leftW + GUTTER;
  const rightW = innerW - leftW - GUTTER;

  const cards: SheetCard[] = [];

  // Left column: title band, hero front view, then bullets + back view side by side.
  const titleH = 64;
  const heroY = MARGIN + titleH + GUTTER;
  const lowerH = 300;
  const heroH = innerH - titleH - lowerH - GUTTER * 2;
  const lowerY = heroY + heroH + GUTTER;
  const bulletsW = leftW * 0.55 - GUTTER / 2;
  const backW = leftW - bulletsW - GUTTER;

  const title: PxRect = { x: MARGIN, y: MARGIN, w: leftW, h: titleH };
  const hero: PxRect = { x: MARGIN, y: heroY, w: leftW, h: heroH };
  const bullets: PxRect = { x: MARGIN, y: lowerY, w: bulletsW, h: lowerH };
  const back: PxRect = { x: MARGIN + bulletsW + GUTTER, y: lowerY, w: backW, h: lowerH };

  cards.push({
    id: "title",
    role: "title",
    cropKind: null,
    label: null,
    rect: norm(title),
    imageRect: null,
  });
  cards.push({
    id: "hero",
    role: "hero",
    cropKind: "front",
    label: "Front",
    rect: norm(hero),
    imageRect: norm(inner(hero, false)),
  });
  cards.push({
    id: "bullets",
    role: "bullets",
    cropKind: null,
    label: null,
    rect: norm(bullets),
    imageRect: null,
  });
  cards.push({
    id: "back",
    role: "back",
    cropKind: "back",
    label: "Back",
    rect: norm(back),
    imageRect: norm(inner(back, true)),
  });

  // Right column: 3×2 grid of macro details, then two bottom cards.
  const gridH = Math.round(innerH * 0.64);
  const cellW = (rightW - GUTTER * 2) / 3;
  const cellH = (gridH - GUTTER) / 2;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const index = row * 3 + col;
      const rect: PxRect = {
        x: rightX + col * (cellW + GUTTER),
        y: MARGIN + row * (cellH + GUTTER),
        w: cellW,
        h: cellH,
      };
      cards.push({
        id: `detail-${index + 1}`,
        role: "detail",
        cropKind: "detail",
        label: input.detailLabels[index] ?? `Detail ${index + 1}`,
        rect: norm(rect),
        imageRect: norm(inner(rect, true)),
      });
    }
  }

  const bottomY = MARGIN + gridH + GUTTER;
  const bottomH = innerH - gridH - GUTTER;
  const bottomW = (rightW - GUTTER) / 2;
  for (let index = 0; index < 2; index += 1) {
    const card = input.bottomCards[index] ?? { kind: "swatch" as const, label: "Fabrics" };
    const rect: PxRect = {
      x: rightX + index * (bottomW + GUTTER),
      y: bottomY,
      w: bottomW,
      h: bottomH,
    };
    cards.push({
      id: `bottom-${index + 1}`,
      role: "bottom",
      cropKind: card.kind,
      label: card.label,
      rect: norm(rect),
      imageRect: norm(inner(rect, true)),
    });
  }

  return { version: 1, aspectRatio: "16:9", canvas: { width: W, height: H }, cards };
}

/** Cards that become isolated reference crops. */
export function croppableCards(layout: SheetLayout): (SheetCard & { imageRect: NormalizedRect })[] {
  return layout.cards.filter(
    (card): card is SheetCard & { imageRect: NormalizedRect } =>
      card.imageRect !== null && card.cropKind !== null,
  );
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Geometry description included in the sheet image prompt. */
export function describeLayout(layout: SheetLayout): string {
  const lines = layout.cards.map((card) => {
    const where = `left ${pct(card.rect.x)}, top ${pct(card.rect.y)}, width ${pct(card.rect.w)}, height ${pct(card.rect.h)}`;
    switch (card.role) {
      case "title":
        return `Title band (${where}).`;
      case "hero":
        return `Hero card with the full front view (${where}).`;
      case "bullets":
        return `Overview bullets card (${where}).`;
      case "back":
        return `Back-view card labelled "Back" (${where}).`;
      case "detail":
        return `Macro detail card "${card.label}" (${where}).`;
      case "bottom":
        return `Bottom card "${card.label}" (${where}).`;
    }
  });
  return lines.join("\n");
}
