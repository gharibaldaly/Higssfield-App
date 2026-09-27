import { describe, expect, it } from "vitest";

import {
  detailReferences,
  labelSimilarity,
  viewReferences,
  type PhotoRef,
} from "@/lib/catalogue/references";

function photo(
  id: string,
  piecePosition: number,
  kind: PhotoRef["kind"],
  label: string | null = null,
): PhotoRef {
  return {
    id,
    pieceId: `piece-${piecePosition}`,
    piecePosition,
    kind,
    label,
    storagePath: `owner/${id}.jpg`,
  };
}

// Deliberately out of piece order.
const PHOTOS: PhotoRef[] = [
  photo("slip-front", 2, "front"),
  photo("robe-front", 1, "front"),
  photo("robe-back", 1, "back"),
  photo("robe-lace", 1, "detail", "Lace hem scallops"),
  photo("robe-buttons", 1, "detail", "Pearl buttons on the cuff"),
  photo("slip-front-2", 2, "front", "second front"),
  photo("slip-neck", 2, "detail", "Lace neckline"),
];

const ids = (photos: PhotoRef[]) => photos.map((item) => item.id);

describe("labelSimilarity", () => {
  it("scores token overlap and ignores short words", () => {
    expect(labelSimilarity("Scalloped lace hem", "Lace hem scallops")).toBeCloseTo(0.5);
    expect(labelSimilarity("a lace", "lace")).toBe(1);
    expect(labelSimilarity("", "lace")).toBe(0);
  });

  it("understands Arabic labels", () => {
    expect(labelSimilarity("دانتيل الحافة", "دانتيل")).toBeCloseTo(0.5);
  });
});

describe("viewReferences", () => {
  it("returns one photo per piece in piece order", () => {
    expect(ids(viewReferences(PHOTOS, "front", 3))).toEqual(["robe-front", "slip-front"]);
    expect(ids(viewReferences(PHOTOS, "front", 1))).toEqual(["robe-front"]);
    expect(ids(viewReferences(PHOTOS, "back", 3))).toEqual(["robe-back"]);
  });

  it("filters by piece", () => {
    expect(ids(viewReferences(PHOTOS, "front", 3, [2]))).toEqual(["slip-front"]);
  });
});

describe("detailReferences", () => {
  it("prefers the best-matching detail photo of the right piece", () => {
    const refs = detailReferences(PHOTOS, { label: "Scalloped lace hem", piecePosition: 1 }, 2);
    expect(ids(refs)).toEqual(["robe-lace", "robe-buttons"]);
  });

  it("uses the description and piece bonus to break ties", () => {
    const refs = detailReferences(
      PHOTOS,
      { label: "Lace", description: "neckline edging", piecePosition: 2 },
      1,
    );
    expect(ids(refs)).toEqual(["slip-neck"]);
  });

  it("falls back to the piece's front photo when no detail photo matches", () => {
    const noDetails = PHOTOS.filter((item) => item.kind !== "detail");
    expect(
      ids(detailReferences(noDetails, { label: "Strap slider", piecePosition: 2 }, 2)),
    ).toEqual(["slip-front"]);
    expect(
      ids(detailReferences(noDetails, { label: "Strap slider", piecePosition: null }, 3)),
    ).toEqual(["robe-front", "slip-front"]);
  });
});
