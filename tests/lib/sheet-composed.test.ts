import { describe, expect, it } from "vitest";

import type { SheetPhotoPlan } from "@/lib/domain/sheet";
import { composeSheetLayout, fitSourceBox, type SheetPhoto } from "@/lib/sheet/composed";
import { composedLayoutSchema, croppableCards } from "@/lib/sheet/layout";

const CANVAS = { width: 3840, height: 2160 };

const photos: SheetPhoto[] = [
  { path: "p/front.jpg", kind: "front", pieceId: "dress", aspect: 0.75 },
  { path: "p/back.jpg", kind: "back", pieceId: "dress", aspect: 0.75 },
  { path: "p/lace.jpg", kind: "detail", pieceId: "dress", aspect: 1.5 },
];

const plan: SheetPhotoPlan = {
  title: "Royal Blue Slip Dress",
  overviewBullets: ["Stretch satin", "Corded lace", "Clear sliders"],
  front: { photo: 1, box: [50, 100, 950, 900] },
  back: { photo: 2, box: [60, 120, 940, 880] },
  detailCards: Array.from({ length: 6 }, (_, index) => ({
    label: `Detail ${index + 1}`,
    description: "A real detail",
    photo: 3,
    box: [100 + index * 100, 100, 200 + index * 100, 300],
  })),
  bottomCards: [
    {
      kind: "swatch",
      label: "Lace",
      description: "Corded lace",
      photo: 3,
      box: [400, 400, 600, 600],
    },
    { kind: "swatch", label: "Satin", description: "Satin", photo: 1, box: [600, 300, 700, 500] },
  ],
};

const input = {
  plan,
  photos,
  approved: { front: null, back: null },
  pieceFronts: [],
  canvas: CANVAS,
};

const cardAspect = (rect: { w: number; h: number }) =>
  (rect.w * CANVAS.width) / (rect.h * CANVAS.height);

describe("sheet built from photos", () => {
  it("names the photo region behind every image card", () => {
    const { layout, warnings } = composeSheetLayout(input);
    expect(composedLayoutSchema.safeParse(layout).success).toBe(true);
    expect(warnings).toEqual([]);
    const byId = new Map(layout.cards.map((card) => [card.id, card]));
    expect(byId.get("hero")?.sources[0]?.path).toBe("p/front.jpg");
    expect(byId.get("back")?.sources[0]?.path).toBe("p/back.jpg");
    expect(byId.get("detail-3")?.sources[0]?.path).toBe("p/lace.jpg");
    expect(byId.get("bottom-2")?.sources[0]?.path).toBe("p/front.jpg");
    expect(byId.get("title")?.sources).toEqual([]);
    expect(croppableCards(layout).every((card) => card.sources.length === 1)).toBe(true);
  });

  it("gives close-up cards the card's own shape, so nothing is stretched", () => {
    const { layout } = composeSheetLayout(input);
    for (const card of layout.cards.filter((item) => item.role === "detail")) {
      const box = card.sources[0]!.box;
      // Pixel shape of the box on the 3:2 detail photo equals the card's shape.
      expect((box.w * 1.5) / box.h).toBeCloseTo(cardAspect(card.imageRect!), 2);
    }
  });

  it("keeps the whole garment in the front view (padded, not reshaped)", () => {
    const { layout } = composeSheetLayout(input);
    const hero = layout.cards.find((card) => card.id === "hero")!;
    expect(hero.sources[0]!.box.x).toBeLessThan(0.1);
    expect(hero.sources[0]!.box.w).toBeGreaterThan(0.8);
  });

  it("uses approved catalogue images for the front and back", () => {
    const { layout } = composeSheetLayout({
      ...input,
      approved: { front: "gen/front.png", back: "gen/back.png" },
    });
    const byId = new Map(layout.cards.map((card) => [card.id, card]));
    expect(byId.get("hero")?.sources).toEqual([
      { path: "gen/front.png", box: { x: 0, y: 0, w: 1, h: 1 } },
    ]);
    expect(byId.get("back")?.sources[0]?.path).toBe("gen/back.png");
  });

  it("falls back to something real, and says so, when the brain's answer is unusable", () => {
    const { layout, warnings } = composeSheetLayout({
      ...input,
      plan: {
        ...plan,
        detailCards: plan.detailCards.map((card, index) =>
          index === 0 ? { ...card, photo: 9 } : index === 1 ? { ...card, box: [5, 5, 5, 5] } : card,
        ),
      },
    });
    const byId = new Map(layout.cards.map((card) => [card.id, card]));
    expect(byId.get("detail-1")?.sources[0]?.path).toBe("p/lace.jpg");
    expect(byId.get("detail-2")?.sources[0]?.path).toBe("p/lace.jpg");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('Detail "Detail 1": no such photo (9)');
    expect(warnings[1]).toContain('Detail "Detail 2": the box was unusable');
  });

  it("leaves the back card empty when no photo shows the back", () => {
    const { layout } = composeSheetLayout({
      ...input,
      plan: { ...plan, back: null },
      photos: photos.filter((photo) => photo.kind !== "back"),
    });
    expect(layout.cards.find((card) => card.id === "back")?.sources).toEqual([]);
  });

  it("builds a set's pieces card from each piece's front photo", () => {
    const { layout } = composeSheetLayout({
      ...input,
      plan: {
        ...plan,
        bottomCards: [
          { kind: "pieces", label: "The set", description: "", photo: null, box: null },
          plan.bottomCards[0]!,
        ],
      },
      pieceFronts: ["robe/front.jpg", "slip/front.jpg"],
    });
    const set = layout.cards.find((card) => card.id === "bottom-1")!;
    expect(set.cropKind).toBe("pieces");
    expect(set.sources.map((source) => source.path)).toEqual(["robe/front.jpg", "slip/front.jpg"]);
  });

  it("reshapes an owner's box only on cards that are filled edge to edge", () => {
    const { layout } = composeSheetLayout(input);
    const detail = layout.cards.find((card) => card.id === "detail-1")!;
    const hero = layout.cards.find((card) => card.id === "hero")!;
    const drawn = { x: 0.4, y: 0.4, w: 0.1, h: 0.3 };
    const fitted = fitSourceBox(detail, drawn, 1, CANVAS);
    expect(fitted.w / fitted.h).toBeCloseTo(cardAspect(detail.imageRect!), 2);
    expect(fitSourceBox(hero, drawn, 1, CANVAS)).toEqual(drawn);
  });
});
