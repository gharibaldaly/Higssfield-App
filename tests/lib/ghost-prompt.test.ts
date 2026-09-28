import { describe, expect, it } from "vitest";

import { colourwayBrief } from "@/lib/colorways/words";
import { DEFAULT_CATALOGUE_STYLE } from "@/lib/domain/catalogue-style";
import { composeGhostParagraph, type GhostParagraphInput } from "@/lib/prompts/house-style";
import { ghostV3, STYLE_EXAMPLES } from "@/lib/prompts/v3/ghost";
import { findForbiddenWords, neutralizeWording } from "@/lib/prompts/wording";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

const SCENE = {
  garment: "women's straight kimono robe with scalloped lace collar",
  colour: "blush pink",
  construction: [
    "shawl collar faced with 6 cm scalloped lace",
    "self-fabric belt through two side loops",
    "8 cm scalloped lace hem band",
    "exactly 5 ivory pearl buttons at each cuff.",
    " ",
    "8 cm scalloped lace hem band",
  ],
  cleanUp: ["the wooden hanger", "the bedroom wall behind"],
  extraNegatives: [],
  rationale: "",
};

const base: Omit<GhostParagraphInput, "view"> = {
  scene: SCENE,
  dna: ROBE_SET_DNA,
  style: DEFAULT_CATALOGUE_STYLE,
  productLine: "SECRET",
  referenceMode: "edit",
  detail: null,
  colourway: null,
};

/** Each marker must appear after the one before it. */
function expectOrder(text: string, markers: string[]) {
  let last = -1;
  for (const marker of markers) {
    const index = text.indexOf(marker);
    expect(index, marker).toBeGreaterThan(last);
    last = index;
  }
}

describe("composeGhostParagraph (the house system in the owner's prompt style)", () => {
  it("writes the front in the shape of the reference prompt", () => {
    const text = composeGhostParagraph({ ...base, view: "front" });
    expect(text.startsWith("Working only from the attached reference photos")).toBe(true);
    expect(text).toContain(
      "create a premium ultra-realistic e-commerce fashion photograph of the exact blush pink women's straight kimono robe with scalloped lace collar, displayed on an invisible display form in the classic ghost technique, with absolutely no visible form, stand or human body parts, preserving the exact original garment construction and proportions: shawl collar faced with 6 cm scalloped lace, self-fabric belt through two side loops, 8 cm scalloped lace hem band, exactly 5 ivory pearl buttons at each cuff, and all original seams and panel divisions; perfectly symmetrical, professionally shaped and naturally filled, immaculate and perfectly ironed with no wrinkles or distortions, accurate blush pink colour and subtle fabric texture, front-facing centred composition, whole garment centred in frame with about 8% clear margin on every side, 4:5 aspect ratio, luxury high-end sleepwear e-commerce photography, soft diffused studio lighting, ",
    );
    expect(text).toContain(
      "no cast shadow, clean pure white (#FFFFFF) seamless background, flat and even edge to edge, crisp fabric and stitching detail, photorealistic 4K resolution, realistic textile rendering, premium catalogue finish, no text, no logo, no accessories, no humans.",
    );
    expect(text).toContain(
      "Leave out from the reference photos: the wooden hanger, the bedroom wall behind; every designed gather, pleat, ruche and drape fold stays exactly as made.",
    );
  });

  it("keeps the parts in the order of the reference prompts", () => {
    expectOrder(composeGhostParagraph({ ...base, view: "front" }), [
      "of the exact ",
      "displayed on an invisible display form",
      "preserving the exact original garment construction and proportions:",
      "and all original seams and panel divisions;",
      "perfectly symmetrical",
      "accurate blush pink colour",
      "front-facing centred composition",
      "e-commerce photography",
      "soft diffused studio lighting",
      "seamless background",
      "photorealistic 4K resolution",
      "no text, no logo, no accessories, no humans.",
    ]);
  });

  it("writes the back from the rear, in the reference prompt's back wording", () => {
    const text = composeGhostParagraph({ ...base, view: "back" });
    expect(text).toContain("shown from the rear, displayed on an invisible display form");
    expect(text).toContain(
      "accurately reconstructing and preserving the original back construction:",
    );
    expect(text).toContain(
      "preserve the exact colour, fabric texture, strap width, stitching style and construction details from the reference, perfectly symmetrical",
    );
    expect(text).toContain(
      "rear-facing centred composition with the same framing, scale and light as the front image",
    );
  });

  it("in text mode has no reference to lean on and nothing to leave out", () => {
    const text = composeGhostParagraph({ ...base, view: "back", referenceMode: "text" });
    expect(text.startsWith("Create a premium ultra-realistic")).toBe(true);
    expect(text).toContain("construction details as specified");
    expect(text).not.toContain("Leave out");
  });

  it("writes a macro around the named detail", () => {
    const text = composeGhostParagraph({
      ...base,
      view: "macro",
      detail: { label: "Scalloped lace hem" },
    });
    expect(text).toContain(
      "macro photograph of the Scalloped lace hem of the exact blush pink women's straight kimono robe",
    );
    expect(text).toContain("the detail fills most of the frame, tack-sharp");
    expect(text).toContain("with a soft raking accent that reveals the texture");
    expect(text).toContain("wherever any background shows");
    expect(text).not.toContain("front-facing");
  });

  it("writes a colourway from the approved image in the requested colour words", () => {
    const text = composeGhostParagraph({
      ...base,
      view: "colorway",
      colourway: {
        ...colourwayBrief({ name: "cashmir", hex: "#B499A0" }, { name: "Blush", hex: "#E8C4C0" }),
        swatch: true,
      },
    });
    expect(
      text.startsWith("Working only from the approved catalogue front image (reference 1)"),
    ).toBe(true);
    expect(text).toContain("re-rendered in dusty rose (#B499A0): only the fabric colour changes.");
    expect(text).toContain("Compared with the original blush,");
    expect(text).toContain("The second reference image is a photo of fabric in this colour");
    expect(text).toContain("accurate dusty rose colour");
    expect(text).toContain("tonal fabric, lace and trims take the new colour");
    expect(text).toContain("front-facing centred composition identical to the approved image");
    expect(text).not.toContain("cashmir");
    expect(text).not.toContain("blush pink");
  });

  it("follows the catalogue style for background, shadow, framing and light", () => {
    const text = composeGhostParagraph({
      ...base,
      view: "front",
      style: {
        ...DEFAULT_CATALOGUE_STYLE,
        background: "#F7F3EE",
        shadow: "soft",
        paddingPercent: 12,
        aspectRatio: "3:4",
        lighting: "warm window light; no harsh highlights.",
      },
    });
    expect(text).toContain("clean seamless solid #F7F3EE background");
    expect(text).toContain("very subtle natural shadow");
    expect(text).toContain("about 12% clear margin on every side, 3:4 aspect ratio");
    expect(text).toContain(
      "soft diffused studio lighting, warm window light, no harsh highlights,",
    );
  });

  it("names the product line's photography", () => {
    expect(composeGhostParagraph({ ...base, view: "front", productLine: "HOURS" })).toContain(
      "luxury high-end homewear and pyjama e-commerce photography",
    );
  });

  it("falls back to the DNA when the brain leaves the garment, colour or construction blank", () => {
    const text = composeGhostParagraph({
      ...base,
      view: "front",
      scene: { ...SCENE, garment: "", colour: "", construction: [] },
    });
    expect(text).toContain("straight kimono robe, displayed on");
    // Every piece's front steps, in the DNA's top-to-bottom order.
    expect(text).toContain(
      "collar: shawl collar faced with scalloped lace, 6 cm wide, waist: self-fabric belt through 2 side loops, hem: scalloped lace band 8 cm, neckline: V neckline edged with lace, chest panel: lace panel, unlined, and all original seams and panel divisions;",
    );
    expect(text).not.toContain("accurate  colour");
  });

  it("already speaks the studio's neutral wording", () => {
    const text = composeGhostParagraph({ ...base, view: "front" });
    expect(neutralizeWording(text)).toBe(text);
    expect(findForbiddenWords(text)).toEqual([]);
  });
});

describe("ghost v3 template", () => {
  it("carries the owner's reference prompts as style examples, in neutral wording", () => {
    expect(ghostV3.version).toBe("3.0.0");
    expect(ghostV3.system).toContain(STYLE_EXAMPLES.front);
    expect(ghostV3.system).toContain(STYLE_EXAMPLES.back);
    expect(findForbiddenWords(ghostV3.system)).toEqual([]);
    expect(STYLE_EXAMPLES.front).toContain(
      "preserving the exact original garment construction and proportions:",
    );
    expect(STYLE_EXAMPLES.back).toContain(
      "accurately reconstructing and preserving the original back construction:",
    );
  });

  it("asks the brain only for the garment slots", () => {
    const text = ghostV3.render({
      product: { name: "Robe", productLine: "SECRET", notes: null, pieces: [] },
      dna: ROBE_SET_DNA,
      view: "front",
      style: DEFAULT_CATALOGUE_STYLE,
      detail: null,
      colorway: null,
      references: [],
      referenceMode: "text",
      note: "make the belt loops visible",
      promptBudget: 6000,
    });
    expect(text).toContain(
      "Return JSON with garment, colour, construction, cleanUp, extraNegatives and rationale.",
    );
    expect(text).toContain("Mode: TEXT");
    expect(text).toContain("Owner note on the previous attempt: make the belt loops visible");
  });
});
