import { describe, expect, it } from "vitest";

import { DEFAULT_CATALOGUE_STYLE } from "@/lib/domain/catalogue-style";
import type { GarmentDna, PieceDna } from "@/lib/domain/garment-dna";
import {
  buildProductLock,
  buildStrictNegatives,
  composeGenerationPrompt,
  negativePromptTerms,
  STRICT_NEGATIVES,
} from "@/lib/prompts/blocks";
import { ghostV3 } from "@/lib/prompts/v3/ghost";
import { findForbiddenWords, neutralizeWording } from "@/lib/prompts/wording";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

describe("neutralizeWording", () => {
  it("replaces anatomical and filter-triggering words with neutral garment terms", () => {
    const text = neutralizeWording(
      "A sexy lingerie set on a ghost mannequin, bust area padded, visible cleavage, nude satin.",
    );
    expect(text).toContain("invisible display form");
    expect(text).toContain("sleepwear set");
    expect(text).toContain("chest panel");
    expect(text).toContain("warm beige satin");
    expect(findForbiddenWords(text)).toEqual([]);
  });

  it("does not touch ordinary garment words", () => {
    const text = "Pearl button on the bralette strap, button count five.";
    expect(neutralizeWording(text)).toBe(text);
  });

  it("collapses repeated replacements", () => {
    expect(neutralizeWording("mannequin mannequin")).toBe("invisible display form");
  });
});

describe("buildProductLock", () => {
  it("locks every piece with construction, counts, colours and rules", () => {
    const lock = buildProductLock(ROBE_SET_DNA);
    expect(lock).toMatch(/^PRODUCT LOCK/);
    expect(lock).toContain('Piece 1 "Robe"');
    expect(lock).toContain('Piece 2 "Slip dress"');
    expect(lock).toContain("exactly 5 × pearl button");
    expect(lock).toContain("#E8C4C0–#DDB3AE");
    expect(lock).toContain("Keep exactly 5 pearl buttons");
    expect(lock).toContain("Set: Robe worn open over the slip dress");
    expect(lock).toContain("Never alter (whole product)");
  });

  it("keeps construction in top-to-bottom order", () => {
    const lock = buildProductLock(ROBE_SET_DNA, { view: "front", piecePositions: [1] });
    const collar = lock.indexOf("collar:");
    const waist = lock.indexOf("waist:");
    const hem = lock.indexOf("hem:");
    expect(collar).toBeGreaterThan(-1);
    expect(collar).toBeLessThan(waist);
    expect(waist).toBeLessThan(hem);
  });

  it("describes a flat, unpadded chest panel by default", () => {
    const lock = buildProductLock(ROBE_SET_DNA, { piecePositions: [2] });
    expect(lock).toContain("unstructured, flat, unlined, unpadded, zero projection");
  });

  it("only includes the requested view", () => {
    expect(buildProductLock(ROBE_SET_DNA, { view: "back" })).not.toContain("Front, top to bottom");
    expect(buildProductLock(ROBE_SET_DNA, { view: "front" })).not.toContain("Back, top to bottom");
  });

  it("switches the colour rule for colourways", () => {
    const lock = buildProductLock(ROBE_SET_DNA, {
      colorOverride: { name: "Wine", hex: "#4d0011" },
    });
    expect(lock).toContain("recolour the whole piece to wine red (#4D0011).");
    expect(lock).not.toContain("keep exactly this colour");
    // The global rule "Blush colour must match the photos" would undo the colourway.
    expect(lock).not.toContain("Blush colour must match");
    expect(buildProductLock(ROBE_SET_DNA)).toContain("Blush colour must match the photos");
    expect(buildStrictNegatives({ name: "Wine", hex: "#4d0011" })).toContain(
      "no colour other than wine red (#4D0011) on the recoloured fabric,",
    );
  });
});

/** One piece in one colour, like the owner's first colourway product (2026-09-28). */
const BRALETTE: PieceDna = {
  ...ROBE_SET_DNA.pieces[1]!,
  position: 1,
  pieceName: "Bralette",
  category: "bralette top",
  colors: [{ name: "Taupe Grey", hexRange: ["#8D828C", "#998E98"], location: "Entire garment" }],
  hardware: [
    { item: "strap slider", count: 2, finish: "colour-matched taupe plastic", location: "straps" },
  ],
  doNotAlter: ["Keep flat 1.5 cm elastic straps", "Keep the rose lace motif at the band"],
};

const BRALETTE_DNA: GarmentDna = {
  ...ROBE_SET_DNA,
  setComposition: "",
  pieces: [BRALETTE],
  globalDoNotAlter: [
    "Retain exact taupe-grey monochrome color-matching across fabric, straps, and hardware",
    "Do not add underwires, lace, or decorative bows",
  ],
};

const CASHMIR = { name: "cashmir", hex: "#B499A0" };

describe("colourway prompts", () => {
  it("gives the colour in plain words, with the change from the original", () => {
    const lock = buildProductLock(BRALETTE_DNA, { colorOverride: { ...CASHMIR, swatch: true } });
    expect(lock).toContain("recolour the whole piece to dusty rose (#B499A0).");
    expect(lock).toContain(
      "Compared with the original taupe grey, it is lighter, pink instead of mauve.",
    );
    expect(lock).toContain(
      "The second reference image is a photo of fabric in this colour: match that colour as it would look in neutral studio daylight",
    );
    expect(lock).toContain("Wherever this lock names the original taupe grey, read dusty rose.");
    // The owner's label may mean nothing to an image model, or read as a fabric.
    expect(lock).not.toContain("cashmir");
  });

  it("only mentions the swatch when the image model receives it", () => {
    const lock = buildProductLock(BRALETTE_DNA, { colorOverride: CASHMIR });
    expect(lock).not.toContain("second reference image");
  });

  it("drops the rules that pin the original colour and keeps every other rule", () => {
    const lock = buildProductLock(BRALETTE_DNA, { colorOverride: CASHMIR });
    expect(lock).not.toContain("Retain exact taupe-grey");
    expect(lock).toContain("Do not add underwires, lace, or decorative bows");
    expect(lock).toContain("Keep flat 1.5 cm elastic straps");
    expect(lock).toContain("Keep the rose lace motif at the band");
    // Ordinary images keep the colour rule.
    expect(buildProductLock(BRALETTE_DNA)).toContain("Retain exact taupe-grey monochrome");
  });

  it("never drops a motif rule for sharing a one-word colour name", () => {
    const rose: PieceDna = {
      ...BRALETTE,
      colors: [{ name: "Rose", hexRange: ["#E8A0B0"], location: "body" }],
      doNotAlter: ["Keep the rose lace motif"],
    };
    const lock = buildProductLock(
      { ...BRALETTE_DNA, pieces: [rose], globalDoNotAlter: [] },
      { colorOverride: CASHMIR },
    );
    expect(lock).toContain("Keep the rose lace motif");
  });

  it("recolours the main colour and keeps contrast colours", () => {
    const contrast: PieceDna = {
      ...BRALETTE,
      colors: [
        { name: "Blush", hexRange: ["#E8C4C0"], location: "body" },
        { name: "Black", hexRange: ["#141414"], location: "lace trim" },
      ],
      doNotAlter: ["Keep the black lace trim colour", "Blush colour must match the photos"],
    };
    const lock = buildProductLock(
      { ...BRALETTE_DNA, pieces: [contrast], globalDoNotAlter: [] },
      { colorOverride: CASHMIR },
    );
    expect(lock).toContain(
      "recolour the blush parts to dusty rose (#B499A0); parts in black keep their colour.",
    );
    expect(lock).toContain("Keep the black lace trim colour");
    expect(lock).not.toContain("Blush colour must match");
  });

  it("keeps the negatives on the new colour", () => {
    expect(buildStrictNegatives(CASHMIR, BRALETTE_DNA)).toContain(
      "no colour other than dusty rose (#B499A0) on the recoloured fabric, no trace of the original taupe grey,",
    );
    const prompt = composeGenerationPrompt({
      scene: "Scene.",
      dna: BRALETTE_DNA,
      colorOverride: CASHMIR,
      extraNegatives: ["no colour shift", "no taupe grey", "no colour change on the straps"],
    });
    expect(prompt).toContain("Also: no taupe grey.");
    expect(prompt).not.toContain("no colour shift");
    expect(prompt).not.toContain("no colour change");
    // Other images keep a brain's "no colour shift".
    expect(
      composeGenerationPrompt({
        scene: "Scene.",
        dna: BRALETTE_DNA,
        extraNegatives: ["no colour shift"],
      }),
    ).toContain("Also: no colour shift.");
    expect(negativePromptTerms(true)).not.toContain("colour shift");
    expect(negativePromptTerms()).toContain("colour shift");
  });

  it("tells the director brain the words, the change and the swatch", () => {
    const text = ghostV3.render({
      product: { name: "Bralette", productLine: "SECRET", notes: null, pieces: [] },
      dna: BRALETTE_DNA,
      view: "colorway",
      style: DEFAULT_CATALOGUE_STYLE,
      detail: null,
      colorway: { ...CASHMIR, swatch: true },
      references: [],
      referenceMode: "edit",
      note: null,
      promptBudget: 6000,
    });
    expect(text).toContain(
      'Requested colour: the owner calls it "cashmir" (#B499A0); in plain words: dusty rose.',
    );
    expect(text).toContain('Write exactly "dusty rose" as the colour.');
    expect(text).toContain("it is lighter, pink instead of mauve.");
    expect(text).toContain("Reference 2 is a photo of fabric in this colour.");
    expect(ghostV3.system).toContain("never the owner's name for it");
    expect(ghostV3.system).toContain("never write a negative against changing the colour");
  });
});

describe("composeGenerationPrompt", () => {
  it("always appends the product lock and strict negatives", () => {
    const prompt = composeGenerationPrompt({
      scene: "Front view on a mannequin.",
      dna: ROBE_SET_DNA,
      view: "front",
    });
    expect(prompt).toContain("PRODUCT LOCK");
    expect(prompt).toContain("STRICT NEGATIVES");
    expect(prompt.startsWith("Front view on a invisible display form.")).toBe(true);
    expect(findForbiddenWords(prompt)).toEqual([]);
  });

  it("compacts the lock to fit a small budget but keeps both blocks", () => {
    const full = composeGenerationPrompt({ scene: "Scene.", dna: ROBE_SET_DNA });
    const compact = composeGenerationPrompt({
      scene: "Scene.",
      dna: ROBE_SET_DNA,
      maxChars: full.length - 50,
    });
    expect(compact.length).toBeLessThan(full.length);
    expect(compact).toContain("PRODUCT LOCK");
    expect(compact).toContain(STRICT_NEGATIVES.slice(0, 40));
  });

  it("adds extra negatives from the director brain", () => {
    const prompt = composeGenerationPrompt({
      scene: "Scene.",
      dna: ROBE_SET_DNA,
      extraNegatives: ["no belt knot", " "],
    });
    expect(prompt).toContain("Also: no belt knot.");
  });
});
