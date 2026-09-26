import { describe, expect, it } from "vitest";

import { enforceSheetRules, type SheetPlan } from "@/lib/domain/sheet";
import {
  computeSheetLayout,
  croppableCards,
  describeLayout,
  sheetLayoutSchema,
  type NormalizedRect,
} from "@/lib/sheet/layout";

const DETAIL_LABELS = [
  "Lace hem",
  "Pearl buttons",
  "Satin sheen",
  "Collar",
  "Belt loops",
  "Back straps",
];

const layout = computeSheetLayout({
  detailLabels: DETAIL_LABELS,
  bottomCards: [
    { kind: "pieces", label: "The set" },
    { kind: "swatch", label: "Fabrics" },
  ],
});

const EPSILON = 1e-6;

function overlaps(a: NormalizedRect, b: NormalizedRect): boolean {
  return (
    a.x + EPSILON < b.x + b.w &&
    b.x + EPSILON < a.x + a.w &&
    a.y + EPSILON < b.y + b.h &&
    b.y + EPSILON < a.y + a.h
  );
}

function contains(outer: NormalizedRect, inner: NormalizedRect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.w <= outer.x + outer.w + EPSILON &&
    inner.y + inner.h <= outer.y + outer.h + EPSILON
  );
}

describe("computeSheetLayout", () => {
  it("produces a valid 16:9 layout", () => {
    expect(sheetLayoutSchema.safeParse(layout).success).toBe(true);
    expect(layout.canvas.width / layout.canvas.height).toBeCloseTo(16 / 9, 5);
  });

  it("keeps every card on the canvas without overlaps", () => {
    const canvas = { x: 0, y: 0, w: 1, h: 1 };
    for (const card of layout.cards) {
      expect(contains(canvas, card.rect)).toBe(true);
      if (card.imageRect) expect(contains(card.rect, card.imageRect)).toBe(true);
    }
    for (const [index, card] of layout.cards.entries()) {
      for (const other of layout.cards.slice(index + 1)) {
        expect(overlaps(card.rect, other.rect), `${card.id} overlaps ${other.id}`).toBe(false);
      }
    }
  });

  it("yields ten isolated crops: front, back, six details and two bottom cards", () => {
    const crops = croppableCards(layout);
    expect(crops.map((card) => card.cropKind)).toEqual([
      "front",
      "back",
      "detail",
      "detail",
      "detail",
      "detail",
      "detail",
      "detail",
      "pieces",
      "swatch",
    ]);
    expect(crops.filter((card) => card.role === "detail").map((card) => card.label)).toEqual(
      DETAIL_LABELS,
    );
  });

  it("fills missing labels and bottom cards with defaults", () => {
    const partial = computeSheetLayout({ detailLabels: ["Only one"], bottomCards: [] });
    const labels = partial.cards.filter((card) => card.role === "detail").map((card) => card.label);
    expect(labels[0]).toBe("Only one");
    expect(labels[5]).toBe("Detail 6");
    expect(
      partial.cards.filter((card) => card.role === "bottom").map((card) => card.cropKind),
    ).toEqual(["swatch", "swatch"]);
  });

  it("describes the geometry for the image prompt", () => {
    const text = describeLayout(layout);
    expect(text.split("\n")).toHaveLength(layout.cards.length);
    expect(text).toContain('Macro detail card "Pearl buttons"');
    expect(text).toContain('Bottom card "The set"');
    expect(text).toMatch(
      /Hero card with the full front view \(left \d+%, top \d+%, width \d+%, height \d+%\)/,
    );
  });
});

describe("enforceSheetRules", () => {
  const plan: SheetPlan = {
    title: "Blush robe set",
    overviewBullets: ["Scalloped lace", "Liquid satin", "Pearl buttons"],
    detailCards: DETAIL_LABELS.map((label) => ({
      label,
      description: `${label} close-up`,
      pieceName: "Robe",
    })),
    bottomCards: [
      { kind: "swatch", label: "Fabrics", description: "Fabric swatches" },
      { kind: "matching", label: "Matching", description: "Matching pieces" },
    ],
    prompt: "Product sheet",
  };

  it("adds the pieces card first for multi-piece sets", () => {
    const fixed = enforceSheetRules(plan, ["Robe", "Slip dress"]);
    expect(fixed.bottomCards.map((card) => card.kind)).toEqual(["pieces", "swatch"]);
    expect(fixed.bottomCards[0]?.description).toContain("Robe, Slip dress");
  });

  it("moves an existing pieces card to the front", () => {
    const fixed = enforceSheetRules(
      {
        ...plan,
        bottomCards: [
          { kind: "swatch", label: "Fabrics", description: "Fabric swatches" },
          { kind: "pieces", label: "Both pieces", description: "Side by side" },
        ],
      },
      ["Robe", "Slip dress"],
    );
    expect(fixed.bottomCards.map((card) => card.label)).toEqual(["Both pieces", "Fabrics"]);
  });

  it("never shows a pieces card for a single piece", () => {
    const fixed = enforceSheetRules(
      {
        ...plan,
        bottomCards: [{ kind: "pieces", label: "Pieces", description: "x" }, plan.bottomCards[0]!],
      },
      ["Robe"],
    );
    expect(fixed.bottomCards.map((card) => card.kind)).toEqual(["matching", "swatch"]);
  });
});
