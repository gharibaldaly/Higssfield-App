import { describe, expect, it } from "vitest";

import { guessOuterPiece, layerPiecesOf } from "@/lib/catalogue/layers";
import { fidelityContext } from "@/lib/generations/fidelity";
import { buildProductLock } from "@/lib/prompts/blocks";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

const PIECES = [
  { position: 1, name: "Slip dress" },
  { position: 2, name: "Robe" },
];

describe("robe sets", () => {
  it("guesses the outer piece from its name, in English and Arabic", () => {
    expect(guessOuterPiece(PIECES)).toBe(2);
    expect(
      guessOuterPiece([
        { position: 1, name: "روب" },
        { position: 2, name: "بودي" },
      ]),
    ).toBe(1);
    expect(
      guessOuterPiece([
        { position: 1, name: "Kimono" },
        { position: 2, name: "Short" },
      ]),
    ).toBe(1);
    // A nightgown is not an outer layer, and a single piece has none.
    expect(
      guessOuterPiece([
        { position: 1, name: "Nightgown" },
        { position: 2, name: "Short" },
      ]),
    ).toBeNull();
    expect(guessOuterPiece([{ position: 1, name: "Robe" }])).toBeNull();
  });

  it("splits a set into its outer piece and the pieces beneath", () => {
    expect(layerPiecesOf(PIECES, 2)).toEqual({
      outerPiece: { position: 2, name: "Robe" },
      innerPieces: [{ position: 1, name: "Slip dress" }],
    });
    expect(layerPiecesOf(PIECES, 3)).toBeNull();
    expect(layerPiecesOf(PIECES, null)).toBeNull();
    // A robe alone has nothing beneath it.
    expect(layerPiecesOf([{ position: 1, name: "Robe" }], 1)).toBeNull();
  });

  it("leaves the set line out of a lock for pieces rendered alone", () => {
    const alone = buildProductLock(ROBE_SET_DNA, {
      view: "front",
      piecePositions: [2],
      set: false,
    });
    expect(alone).toContain('Piece 2 "Slip dress"');
    expect(alone).not.toContain("Set: Robe worn open over the slip dress");
    expect(alone).not.toContain('Piece 1 "Robe"');
    expect(buildProductLock(ROBE_SET_DNA, { view: "front" })).toContain(
      "Set: Robe worn open over the slip dress",
    );
  });

  it("tells the fidelity checker that the robe is left out on purpose", () => {
    const context = fidelityContext({
      purpose: "ghost_front",
      slot: "front_inner",
      params: { _meta: { slotLabel: "Robe" } },
    });
    expect(context).toContain('without its outer layer (the "Robe")');
    expect(context).toContain("its absence is never an issue");
    expect(context).toContain("any part of it in the result is a major issue");
    expect(fidelityContext({ purpose: "ghost_front", slot: "front", params: {} })).toContain(
      "Ghost-mannequin FRONT view",
    );
    expect(fidelityContext({ purpose: "ghost_front", slot: "front", params: {} })).not.toContain(
      "outer layer",
    );
  });
});
