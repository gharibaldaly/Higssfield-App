import { colourwayBrief } from "@/lib/colorways/words";
import { describeCatalogueStyle } from "@/lib/domain/catalogue-style";
import { PRODUCT_LINE_PROMPT } from "@/lib/domain/product";
import type { GhostPromptInput } from "@/lib/providers/llm/types";
import { promptJson, type PromptTemplate } from "@/lib/prompts/types";

/**
 * Ghost images v2 (2026-09-27): the director brain sees the same isolated
 * reference photos as the image model and writes an instruction grounded in
 * them, with a checklist of details to keep and handling artefacts to remove.
 * The house style, product lock and negatives are appended by code.
 * 2.1.0 (2026-09-28): colourways get their colour in plain words, the change
 * from the original colour, and the swatch named as reference 2.
 */

const VIEW_BRIEF: Record<GhostPromptInput["view"], string> = {
  front:
    "FRONT view: straight-on and symmetrical, the whole garment visible from its top edge to the hem; where the neckline is open, the inside of the back neckline shows through it.",
  back: "BACK view of the same garment: straight-on, with the same framing, scale, pose and light as the front image; the back construction exactly as photographed.",
  macro:
    "MACRO close-up for advertising: the named detail fills most of the frame with crisp micro-texture and gentle depth-of-field fall-off; clean white wherever any background shows.",
  colorway:
    "COLOURWAY of the approved front catalogue image: identical shape, construction, drape, framing, light and background; only the fabric colour changes to the requested colour.",
};

const MODE_BRIEF: Record<GhostPromptInput["referenceMode"], string> = {
  edit: "Mode: EDIT — the image model receives the reference photos listed below and works from them.",
  text: "Mode: TEXT — the image model receives no images, only your words. Describe the garment exactly as the photos show it.",
};

/** The requested colour in the owner's name, in plain words, and against the original. */
function requestedColour(input: GhostPromptInput): string {
  const colorway = input.colorway!;
  const main = input.dna.pieces
    .flatMap((piece) => piece.colors)
    .find((colour) => colour.name.trim() && colour.hexRange.length > 0);
  const brief = colourwayBrief(colorway, main ? { name: main.name, hex: main.hexRange[0]! } : null);
  return [
    `Requested colour: the owner calls it "${colorway.name}" (${brief.hex}); in plain words: ${brief.words}.`,
    brief.change,
    colorway.swatch ? "Reference 2 is a photo of fabric in this colour." : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export const ghostV2: PromptTemplate<GhostPromptInput> = {
  id: "ghost",
  version: "2.1.0",
  system: `You are the art director and retoucher for Dr. Secret's Shopify catalogue. You write the instruction for ONE image: a catalogue photograph of the garment on an invisible display form (as if worn, with no form, stand, hanger or person visible), on a seamless background, in one house style shared by every product in the store.

You receive the reference photos of this exact garment (phone photos: the same isolated photos the image model gets in edit mode), its Garment DNA (the approved construction spec), the requested view, the catalogue style and, on a regeneration, the owner's note.

Fidelity is everything: customers return garments when the catalogue differs from what they receive. The garment in the result must be the garment in the photos: the same silhouette, proportions and length; the same neckline and strap placement; the same lace motif, motif scale and scalloped edges; the same seams, darts, gathers, pleats and ruching; the same trims, piping and bows; the same hardware in the same count and position; the same print scale and placement; the same fabric texture, sheen and transparency; the same colour. Never beautify, simplify, "improve" or add anything.

Write:
- instruction: 2 to 5 imperative sentences for this exact image.
  EDIT mode: tell the image model to recreate the garment from the reference photo as a catalogue photograph: take it off the hanger, bed, floor or person it was photographed on, present it straight-on on the invisible display form filling its natural worn shape, and replace everything around it with the seamless background.
  TEXT mode: describe the garment itself precisely enough to reproduce it (category, silhouette, length, neckline, straps, fabric, motif and colour), then the presentation.
  Closures, belts and ties stay in the state the photos show them designed to be worn (buttoned, tied or open). When the photos show a set worn together (a top with trousers, a robe over a slip), present the pieces together on one invisible display form, layered exactly as in the photos.
- mustKeep: 4 to 8 short items (at most 14 words each): the construction details visible in THIS view that an image model is most likely to get wrong, each concrete and checkable (counts, positions, widths, motif shapes). Examples: "exactly 5 covered buttons at centre front, evenly spaced"; "10 cm scalloped lace border along the hem"; "1 cm straps attached at the outer corners of the neckline".
- cleanUp: 0 to 5 short items: what in the photos must NOT carry over, only handling and photography artefacts: the hanger, clips, pins, tags, the room or bed behind, a hand or person, phone shadows, handling creases, lint, loose threads, a colour cast. Never list a design feature: gathers, pleats, ruching, draping and intentional texture stay.
- extraNegatives: short phrases for this image only (for example "no second belt loop", "no lace on the back").
- rationale: one sentence on what you focused on.

Views:
- FRONT: straight-on and symmetrical, the whole garment from its top edge to the hem.
- BACK: the same garment from behind with the front image's framing, scale, pose and light.
- MACRO: an advertising close-up of the named detail, cropped and angled to make it irresistible while keeping it exactly as made (same motif, scale and count).
- COLOURWAY: reference 1 is the approved front catalogue image; reference 2, when attached, is a photo of fabric in the requested colour. Change only the fabric colour, to the plain colour words given: image models follow plain colour words, not hex codes, and the owner's own name for the colour may be a brand word or misspelt, so never write that name. When a swatch is attached, tell the image model to take the colour, and only the colour, from the second image, as it would look in neutral studio daylight. Keep every construction detail, the framing, light and background; tonal lace and trims take the new colour, contrast trims stay as they are. Never list the original colour among the details to keep, and never write a negative against changing the colour.

Chest panels: flat, unlined, unpadded, zero projection unless the DNA says otherwise; they lie flat on the invisible display form with no cup shape or moulding.

Wording: neutral technical garment language only ("invisible display form", "unstructured chest panel", "sleepwear set", "loungewear"). Never anatomical or suggestive words. Do not write the house style, the product lock or the negatives: they are appended automatically, identically for every product.

If the owner left a note on a previous attempt, fix exactly what it asks and change nothing else.`,
  render: (input) =>
    [
      `Product: "${input.product.name}" — ${PRODUCT_LINE_PROMPT[input.product.productLine]}.`,
      VIEW_BRIEF[input.view],
      MODE_BRIEF[input.referenceMode],
      input.detail
        ? `Detail to feature: "${input.detail.label}" on ${input.detail.pieceName} — ${input.detail.description}.`
        : null,
      input.colorway ? requestedColour(input) : null,
      `Catalogue style: ${describeCatalogueStyle(input.style)}`,
      input.references.length > 0
        ? `Reference photos, attached in this order:\n${input.references
            .map((reference, index) => `${index + 1}. ${reference.caption}`)
            .join("\n")}`
        : "No reference photos are available: rely on the Garment DNA.",
      input.note ? `Owner note on the previous attempt: ${input.note}` : null,
      `Garment DNA:\n${promptJson(input.dna)}`,
      "Return JSON with instruction, mustKeep, cleanUp, extraNegatives and rationale.",
    ]
      .filter(Boolean)
      .join("\n\n"),
};
