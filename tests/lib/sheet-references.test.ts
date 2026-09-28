import { describe, expect, it } from "vitest";

import { orderSheetReferences } from "@/lib/sheet/references";

type Photo = { kind: "front" | "back" | "detail"; piece_id: string; storage_path: string };

const photo = (kind: Photo["kind"], piece: string, name: string): Photo => ({
  kind,
  piece_id: piece,
  storage_path: `${piece}/${name}.jpg`,
});
const caption = (item: Photo) => `${item.piece_id} ${item.kind}`;
const paths = (references: { path: string }[]) => references.map((reference) => reference.path);

describe("sheet references", () => {
  // The owner's first product: four fronts, three backs and one detail photo.
  const dress = [
    photo("front", "dress", "front-1"),
    photo("front", "dress", "front-2"),
    photo("back", "dress", "back-1"),
    photo("front", "dress", "front-3"),
    photo("back", "dress", "back-2"),
    photo("detail", "dress", "lace"),
    photo("front", "dress", "front-4"),
    photo("back", "dress", "back-3"),
  ];

  it("puts one front, one back and the details before further angles", () => {
    const references = orderSheetReferences(dress, caption, { front: null, back: null });
    expect(paths(references)).toEqual([
      "dress/front-1.jpg",
      "dress/back-1.jpg",
      "dress/lace.jpg",
      "dress/front-2.jpg",
      "dress/front-3.jpg",
      "dress/front-4.jpg",
      "dress/back-2.jpg",
      "dress/back-3.jpg",
    ]);
    // A five-reference model (Grok Image 2.0) still sees both views and the lace.
    expect(paths(references.slice(0, 5))).toContain("dress/lace.jpg");
    expect(references[0]!.caption).toBe("dress front");
  });

  it("gives every piece of a set its own front and back first", () => {
    const set = [
      photo("front", "robe", "front-1"),
      photo("front", "robe", "front-2"),
      photo("front", "shorts", "front-1"),
      photo("back", "robe", "back-1"),
      photo("back", "shorts", "back-1"),
      photo("detail", "robe", "trim"),
    ];
    expect(paths(orderSheetReferences(set, caption, { front: null, back: null }))).toEqual([
      "robe/front-1.jpg",
      "shorts/front-1.jpg",
      "robe/back-1.jpg",
      "shorts/back-1.jpg",
      "robe/trim.jpg",
      "robe/front-2.jpg",
    ]);
  });

  it("uses approved ghost images in place of the phone photos of their view", () => {
    const references = orderSheetReferences(dress, caption, {
      front: "ghost/front.png",
      back: null,
    });
    expect(paths(references).slice(0, 3)).toEqual([
      "ghost/front.png",
      "dress/back-1.jpg",
      "dress/lace.jpg",
    ]);
    expect(references[0]!.caption).toBe("Approved catalogue front view");
    expect(paths(references).some((path) => path.startsWith("dress/front"))).toBe(false);
  });
});
