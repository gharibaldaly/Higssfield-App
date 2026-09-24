import { describe, expect, it } from "vitest";

import {
  dnaCompletenessIssues,
  emptyGarmentDna,
  garmentDnaSchema,
  hexColor,
  normalizeGarmentDna,
  sellingDetails,
} from "@/lib/domain/garment-dna";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

const PIECES = [
  { position: 1, name: "Robe" },
  { position: 2, name: "Slip dress" },
];

describe("garment DNA schema", () => {
  it("accepts the fixture and a blank manual draft", () => {
    expect(garmentDnaSchema.safeParse(ROBE_SET_DNA).success).toBe(true);
    const blank = emptyGarmentDna(PIECES);
    expect(garmentDnaSchema.safeParse(blank).success).toBe(true);
    expect(blank.pieces.map((piece) => piece.pieceName)).toEqual(["Robe", "Slip dress"]);
    expect(emptyGarmentDna([{ position: 1, name: "Cami" }]).setComposition).toBe("single piece");
  });

  it("rejects malformed colours and too many pieces", () => {
    expect(hexColor.safeParse("#E8C4C0").success).toBe(true);
    expect(hexColor.safeParse("#FFF").success).toBe(false);
    expect(hexColor.safeParse("blush").success).toBe(false);
    const fourPieces = {
      ...ROBE_SET_DNA,
      pieces: [...ROBE_SET_DNA.pieces, ...ROBE_SET_DNA.pieces],
    };
    expect(garmentDnaSchema.safeParse(fourPieces).success).toBe(false);
  });
});

describe("dnaCompletenessIssues", () => {
  it("blocks approval of a blank draft, per piece", () => {
    const issues = dnaCompletenessIssues(emptyGarmentDna(PIECES));
    expect(issues).toEqual([
      { piece: "Robe", field: "category" },
      { piece: "Robe", field: "frontConstruction" },
      { piece: "Robe", field: "colors" },
      { piece: "Robe", field: "doNotAlter" },
      { piece: "Slip dress", field: "category" },
      { piece: "Slip dress", field: "frontConstruction" },
      { piece: "Slip dress", field: "colors" },
      { piece: "Slip dress", field: "doNotAlter" },
    ]);
  });

  it("accepts a complete DNA", () => {
    expect(dnaCompletenessIssues(ROBE_SET_DNA)).toEqual([]);
  });
});

describe("normalizeGarmentDna", () => {
  it("uses the owner's piece names and de-duplicates rules", () => {
    const messy = {
      ...ROBE_SET_DNA,
      pieces: ROBE_SET_DNA.pieces.map((piece) => ({
        ...piece,
        pieceName: `LLM ${piece.pieceName}`,
        doNotAlter: [...piece.doNotAlter, ` ${piece.doNotAlter[0]!.toUpperCase()} `, ""],
      })),
      globalDoNotAlter: ["Keep colour", "keep colour", " "],
    };
    const normalized = normalizeGarmentDna(messy, [
      { position: 1, name: "Kimono robe" },
      { position: 2, name: "Midi slip" },
    ]);
    expect(normalized.pieces.map((piece) => piece.pieceName)).toEqual(["Kimono robe", "Midi slip"]);
    expect(normalized.pieces[0]?.doNotAlter).toEqual(ROBE_SET_DNA.pieces[0]?.doNotAlter);
    expect(normalized.globalDoNotAlter).toEqual(["Keep colour"]);
  });

  it("maps pieces by position and falls back when the model returned fewer", () => {
    const onlyOne = { ...ROBE_SET_DNA, pieces: [ROBE_SET_DNA.pieces[1]!] };
    const normalized = normalizeGarmentDna(onlyOne, PIECES);
    expect(normalized.pieces).toHaveLength(2);
    expect(normalized.pieces[1]?.category).toBe("slip dress");
    expect(normalized.pieces[0]?.position).toBe(1);
    expect(normalized.pieces[0]?.pieceName).toBe("Robe");
  });
});

describe("sellingDetails", () => {
  it("orders selling points first, then by importance, skipping blank labels", () => {
    const withBlank = {
      ...ROBE_SET_DNA,
      pieces: ROBE_SET_DNA.pieces.map((piece, index) =>
        index === 0
          ? {
              ...piece,
              keyDetails: [
                ...piece.keyDetails,
                {
                  label: " ",
                  description: "",
                  zone: "",
                  importance: "critical" as const,
                  sellingPoint: true,
                },
              ],
            }
          : piece,
      ),
    };
    expect(
      sellingDetails(withBlank).map((detail) => `${detail.pieceName}: ${detail.label}`),
    ).toEqual([
      "Robe: Scalloped lace hem",
      "Slip dress: Lace V neckline",
      "Robe: Satin sheen",
      "Robe: Side loops",
    ]);
  });
});
