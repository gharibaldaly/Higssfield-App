import { describe, expect, it } from "vitest";

import {
  colourWords,
  colourwayBrief,
  describeColourChange,
  describeHex,
  namedColour,
} from "@/lib/colorways/words";
import { colourwayContext } from "@/lib/generations/fidelity";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

/** The owner's first colourways (B20124, 2026-09-28), sampled from phone swatches. */
const TAUPE_GREY = { name: "Taupe Grey", hex: "#8D828C" };

describe("describeHex", () => {
  it("puts the owner's swatches into plain words", () => {
    expect(describeHex("#B499A0")).toBe("dusty rose");
    expect(describeHex("#8D9392")).toBe("neutral medium grey");
    expect(describeHex("#3B4156")).toBe("navy blue");
    expect(describeHex("#A1887C")).toBe("taupe brown");
    expect(describeHex("#8D828C")).toBe("medium mauve-grey");
  });

  it("names common fashion colours the way a buyer would", () => {
    const names = Object.fromEntries(
      Object.entries({
        black: "#111111",
        white: "#FFFFFF",
        offWhite: "#F5F3EE",
        ivory: "#FFFFF0",
        champagne: "#F1DDCF",
        nude: "#E3BC9A",
        camel: "#C19A6B",
        chocolate: "#4B2E1F",
        wine: "#722F37",
        red: "#C8102E",
        blush: "#F4C2C2",
        mauve: "#B784A7",
        lilac: "#C8A2C8",
        lavender: "#C8B6E2",
        navy: "#1B2A4A",
        petrol: "#1F4E5F",
        teal: "#008080",
        sage: "#9CAF88",
        emerald: "#046307",
        mustard: "#E1AD01",
      }).map(([name, hex]) => [name, describeHex(hex)]),
    );
    expect(names).toEqual({
      black: "black",
      white: "white",
      offWhite: "off-white",
      ivory: "ivory",
      champagne: "champagne",
      nude: "nude beige",
      camel: "camel",
      chocolate: "dark chocolate brown",
      wine: "wine red",
      red: "red",
      blush: "blush",
      mauve: "mauve",
      lilac: "lilac",
      lavender: "lavender",
      navy: "navy blue",
      petrol: "dark petrol blue",
      teal: "teal",
      sage: "sage green",
      emerald: "emerald green",
      mustard: "mustard yellow",
    });
  });
});

describe("colourWords", () => {
  it("describes a label it does not know from the swatch", () => {
    expect(colourWords("cashmir", "#B499A0")).toEqual({ words: "dusty rose", fromHex: true });
    expect(colourWords("B2", "#3B4156")).toEqual({ words: "navy blue", fromHex: true });
  });

  it("refines a colour name the swatch agrees with", () => {
    expect(colourWords("gray", "#8D9392").words).toBe("neutral medium grey");
    expect(colourWords("blue", "#3B4156").words).toBe("navy blue");
    expect(colourWords("brown", "#A1887C").words).toBe("taupe brown");
  });

  it("keeps black and white as named, whatever the phone made of the swatch", () => {
    expect(colourWords("black", "#2C353F")).toEqual({ words: "black", fromHex: false });
    expect(colourWords("Off-White", "#8D9392")).toEqual({ words: "off-white", fromHex: false });
  });

  it("trusts the label when the swatch contradicts it", () => {
    // A dark name on a mid-grey swatch: the lightness does not fit navy.
    expect(colourWords("كحلي", "#8D9392")).toEqual({ words: "navy blue", fromHex: false });
    expect(colourWords("wine", "#8D9392").words).toBe("wine red");
  });

  it("reads Arabic labels, with the article and hamza forms", () => {
    expect(namedColour("الأسود")?.words).toBe("black");
    expect(namedColour("إسود")?.words).toBe("black");
    expect(namedColour("موف فاتح")?.words).toBe("mauve");
    expect(namedColour("بترولي")?.words).toBe("petrol teal");
  });

  it("reads the longest name first and keeps the label's word order", () => {
    expect(namedColour("off white")?.words).toBe("off-white");
    expect(namedColour("Rose Gold")?.words).toBe("rose pink gold");
    expect(namedColour("tired 2")).toBeNull();
  });
});

describe("describeColourChange", () => {
  it("says how a close colour differs from the original", () => {
    expect(describeColourChange(TAUPE_GREY.hex, "#B499A0")).toBe("lighter, pink instead of mauve");
    expect(describeColourChange(TAUPE_GREY.hex, "#8D9392")).toBe(
      "neutral, with none of its mauve tint",
    );
    expect(describeColourChange(TAUPE_GREY.hex, "#3B4156")).toBe(
      "much darker, blue instead of mauve",
    );
  });

  it("leaves the hue out when it came only from the owner's label", () => {
    expect(describeColourChange(TAUPE_GREY.hex, "#2C353F", false)).toBe("much darker");
  });

  it("says nothing about a colour that does not differ", () => {
    expect(describeColourChange("#8D828C", "#8F848E")).toBeNull();
  });
});

describe("colourwayBrief", () => {
  it("gives the words, the hex and the change from the original colour", () => {
    expect(colourwayBrief({ name: "cashmir", hex: "#b499a0" }, TAUPE_GREY)).toEqual({
      words: "dusty rose",
      hex: "#B499A0",
      original: "taupe grey",
      change: "Compared with the original taupe grey, it is lighter, pink instead of mauve.",
    });
    expect(colourwayBrief({ name: "black", hex: "#2C353F" }, TAUPE_GREY).change).toBe(
      "Compared with the original taupe grey, it is much darker.",
    );
  });

  it("works without an original colour", () => {
    expect(colourwayBrief({ name: "cashmir", hex: "#B499A0" }, null)).toMatchObject({
      words: "dusty rose",
      original: null,
      change: null,
    });
  });
});

describe("colourway fidelity context", () => {
  it("asks the checker to report a colourway that kept the original colour", () => {
    const context = colourwayContext({ name: "cashmir", hex: "#B499A0" }, ROBE_SET_DNA);
    expect(context).toContain("only the colour should differ");
    expect(context).toContain("The requested colour is dusty rose (#B499A0).");
    expect(context).toContain('Report a major "colour" issue');
    expect(context).toContain("kept the original blush");
  });
});
