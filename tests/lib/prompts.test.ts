import { describe, expect, it } from "vitest";

import {
  buildProductLock,
  buildStrictNegatives,
  composeGenerationPrompt,
  STRICT_NEGATIVES,
} from "@/lib/prompts/blocks";
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
    expect(lock).toContain("recolour the whole piece to Wine #4D0011");
    expect(lock).not.toContain("keep exactly this colour");
    expect(buildStrictNegatives({ name: "Wine", hex: "#4d0011" })).toContain(
      "no colour other than the requested #4D0011",
    );
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
