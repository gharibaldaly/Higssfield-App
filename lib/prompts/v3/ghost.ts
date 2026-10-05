import { colourwayBrief } from "@/lib/colorways/words";
import { describeCatalogueStyle } from "@/lib/domain/catalogue-style";
import { PRODUCT_LINE_PROMPT } from "@/lib/domain/product";
import {
  innerPiecesPhrase,
  mainColourOf,
  pieceNoun,
  topPiecesPhrase,
} from "@/lib/prompts/house-style";
import type { GhostLayers, GhostPromptInput } from "@/lib/providers/llm/types";
import { promptJson, type PromptTemplate } from "@/lib/prompts/types";

/**
 * Ghost images v3 (2026-09-28): the owner's reference prompts became the
 * house system. Code assembles every prompt in their shape (see
 * `composeGhostParagraph` in lib/prompts/house-style.ts); the director brain
 * fills only the garment slots: what the garment is, its colour in words, the
 * construction list for the view, and what in the photos to leave out.
 * v2 (an instruction with KEEP EXACTLY / LEAVE OUT lines and a HOUSE STYLE
 * block) lives in git history.
 */

/**
 * The owner's two reference prompts (2026-09-28), in the studio's neutral
 * wording. Another product: the brain copies their style and density, never a
 * detail.
 */
export const STYLE_EXAMPLES = {
  front:
    "Create a premium ultra-realistic e-commerce fashion photograph of the exact burgundy wine-coloured women's demi balconette bralette top with shaping channels, displayed on an invisible display form in the classic ghost technique, with absolutely no visible form, stand or human body parts, preserving the exact original garment construction and proportions: smooth rounded chest panels, textured upper panel band, tonal narrow adjustable shoulder straps with matching sliders and rings, delicate scalloped strap edges, reinforced underband with precise tonal zigzag stitching, small centred decorative charm, and all original seams and panel divisions; perfectly symmetrical, professionally shaped and naturally filled, immaculate and perfectly ironed with no wrinkles or distortions, accurate deep wine-burgundy colour and subtle fabric texture, front-facing centred composition, luxury high-end sleepwear e-commerce photography, soft diffused studio lighting, very subtle natural shadow, clean white seamless background, crisp fabric and stitching detail, photorealistic 4K resolution, realistic textile rendering, premium catalogue finish, no text, no logo, no accessories, no humans.",
  back: "Create a premium ultra-realistic e-commerce fashion photograph of the exact burgundy wine-coloured women's bralette top shown from the rear, displayed on an invisible display form in the classic ghost technique, with absolutely no visible form, stand or human body parts, accurately reconstructing and preserving the original back construction: two narrow adjustable tonal shoulder straps descending naturally from the shoulders into the band, matching sliders and rings, smooth elastic back band with precise tonal zigzag stitching, centred multi-position hook-and-eye closure with its original fabric reinforcement, small brand tag positioned naturally below the closure, clean straight band proportions and authentic seam placement; preserve the exact colour, fabric texture, strap width, stitching style and construction details from the reference, perfectly symmetrical, professionally shaped, immaculate and wrinkle-free, luxury high-end sleepwear e-commerce photography, soft diffused studio lighting, minimal soft shadow, clean white seamless background, sharp textile and stitching definition, photorealistic 4K detail, premium catalogue presentation, no text, no visible form, no human, no distortion.",
} as const;

const VIEW_BRIEF: Record<GhostPromptInput["view"], string> = {
  front:
    "FRONT view: the construction of the front, top to bottom; the whole garment visible from its top edge to the hem.",
  back: "BACK view of the same garment: the construction of the back, top to bottom (straps into the band, closures, tags, seams), with the front image's framing, scale and light.",
  macro:
    "MACRO close-up for advertising: the named detail only. The construction items describe the detail (motif and motif scale, edges, stitching, hardware, texture), not the whole garment.",
  colorway:
    "COLOURWAY of the approved front catalogue image: identical construction, framing, drape, light and background; only the fabric colour changes to the requested colour.",
};

const MODE_BRIEF: Record<GhostPromptInput["referenceMode"], string> = {
  edit: "Mode: EDIT — the image model receives the reference photos listed below and works from them.",
  text: "Mode: TEXT — the image model receives no images, only the prompt. The garment phrase and the construction items must describe the garment precisely enough to reproduce it.",
};

/**
 * A set photographed in parts: what this image shows of it. A robe set's
 * full set keeps the robe worn over the garment, and its inner image shows
 * the garment alone, where the robe must not be described, named or locked.
 * A pyjama set's bottoms are photographed flat on their own, and the image
 * composes them beneath the top as the set is worn.
 */
export function layersBrief(layers: GhostLayers, view: GhostPromptInput["view"]): string {
  const parts: string[] = [];
  const inner = innerPiecesPhrase(layers);
  if (layers.outerPiece) {
    const outer = pieceNoun(layers.outerPiece.name) || "outer layer";
    const pieces = layers.innerPieces
      .map((piece) => `piece ${piece.position} "${piece.name}"`)
      .join(", ");
    const set = `Robe set: piece ${layers.outerPiece.position} "${layers.outerPiece.name.trim()}" is an outer layer worn over ${inner} (${pieces}).`;
    if (layers.show === "inner") {
      parts.push(
        `${set} This image shows ${inner} ALONE, WITHOUT the ${outer}. The garment phrase names only ${inner}; the construction items describe only ${inner}'s ${view === "back" ? "back" : "front"}, top to bottom, as the photos without the ${outer} show it. Never describe, name or count anything of the ${outer}.`,
      );
      if (layers.fromSetPhotos) {
        parts.push(
          `The attached photos show the set with the ${outer} on: describe only the garment beneath it, exactly as seen through or under the ${outer}, and put the ${outer} in cleanUp.`,
        );
      }
    } else {
      parts.push(
        `${set} This image shows the FULL SET worn together, the ${outer} over ${inner}, as the reference photos with the ${outer} show. Name the set as one garment phrase ("… bodysuit and sheer ${outer.toLowerCase()} set"), and list the construction of both layers as seen from this view: the ${outer} first, then what shows of ${inner} beneath it.`,
      );
    }
  }
  if (layers.bottomsPiece) {
    const bottoms = pieceNoun(layers.bottomsPiece.name) || "bottoms";
    const top = topPiecesPhrase(layers);
    parts.push(
      `Pyjama set photographed in parts: ${top} on the display form, and piece ${layers.bottomsPiece.position} "${layers.bottomsPiece.name.trim()}" lying flat on its own in its one reference photo. This image shows the COMPLETE SET worn together on the invisible display form: ${top} exactly as its photos show it, with the ${bottoms} worn beneath it as they hang when worn. Name the set as one garment phrase ("… satin pyjama set of a camp-collar shirt and ${bottoms}"). List the construction of ${top} from this view top to bottom, then the ${bottoms} as the flat photo shows them: waistband, fit (wide or narrow) and leg width, length, hem, pockets, trims and any detail, each item concrete. ${
        view === "back"
          ? `The ${bottoms} have no back photo: describe their back from the flat photo only (the same length, width, colour, waistband and hem) and never invent a detail for it.`
          : `Never invent anything the flat photo does not show.`
      } Never describe the ${bottoms} as lying flat or folded: the house system renders them worn, and the flat photo's pose is not a detail.`,
    );
  }
  return parts.join(" ");
}

/** The requested colour in the owner's name, in plain words, and against the original. */
function requestedColour(input: GhostPromptInput): string {
  const colorway = input.colorway!;
  const brief = colourwayBrief(colorway, mainColourOf(input.dna));
  return [
    `Requested colour: the owner calls it "${colorway.name}" (${brief.hex}); in plain words: ${brief.words}. Write exactly "${brief.words}" as the colour.`,
    brief.change,
    colorway.swatch ? "Reference 2 is a photo of fabric in this colour." : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export const ghostV3: PromptTemplate<GhostPromptInput> = {
  id: "ghost",
  version: "3.3.0",
  system: `You are the art director and retoucher for Dr. Secret's Shopify catalogue. You fill in the garment-specific parts of ONE catalogue image prompt. The prompt itself has a fixed shape, the house system, that code assembles identically for every product in the store; you write only what describes THIS garment, exactly as its reference photos and its Garment DNA (the approved construction spec) show it.

The house system reads like these two reference prompts. They describe another product: copy their style, density and level of detail, never a single detail of that garment.

FRONT example: ${STYLE_EXAMPLES.front}

BACK example: ${STYLE_EXAMPLES.back}

You return:
- garment: the noun phrase that follows "the exact {colour}" in the example: the category with the words that define this piece, 3 to 12 words ("women's bias-cut satin slip dress with lace-trimmed V neckline"). When the photos show a set worn together (a top with trousers, a robe over a slip), name the set and its pieces as one phrase.
- colour: the garment's colour in 2 to 4 plain colour words, as the photos show it in neutral daylight ("deep wine-burgundy", "blush pink", "ivory with black lace"). Never a brand name for a colour.
- construction: 6 to 10 items in the style of the examples, each 3 to 12 words, listing the construction visible in THIS view from top to bottom: panels and bands, straps and their width, edges and trims, closures with their counts, stitching, hardware with its finish, hems and their shape, the motif and its scale. Each item concrete and checkable, with counts, positions and widths where the photos show them; the details an image model is most likely to get wrong come first. Never the colour (it has its own place), never the background, lighting or framing (the house system writes them), never anything the photos and the DNA do not show.
- cleanUp: 0 to 5 short items: what in the photos must NOT carry over, only handling and photography artefacts: the hanger, clips, pins, tags, the room or bed behind, a hand or person, phone shadows, handling creases, lint, loose threads, a colour cast. Never a design feature: gathers, pleats, ruching, draping and intentional texture stay. Never a crumpled, twisted or flipped bow, ribbon, tie or charm: the house system already asks for every trim to be set neatly at its original size, shape and position, and listing it here would remove it.
- extraNegatives: short phrases for this image only ("no second belt loop", "no lace on the back").
- rationale: one sentence on what you focused on.

Fidelity is everything: customers return garments when the catalogue differs from what they receive. The garment in the result must be the garment in the photos: the same silhouette, proportions and length; the same neckline and strap placement; the same lace motif, motif scale and scalloped edges; the same seams, darts, gathers, pleats and ruching; the same trims, piping and bows; the same hardware in the same count and position; the same print scale and placement; the same fabric texture, sheen and transparency; the same colour. Never beautify, simplify, "improve" or add anything. Tidying a trim (a bow opened and straightened, a ribbon smoothed) is presentation and is wanted; changing its size, shape, position or count is not. Closures, belts and ties stay in the state the photos show them designed to be worn (buttoned, tied or open).

Views:
- FRONT: the front, top to bottom.
- BACK: the back, top to bottom: how the straps run into the band, closures and their positions, tags, seams.
- MACRO: the named detail only; the items describe the detail, not the whole garment.
- COLOURWAY: reference 1 is the approved front catalogue image and the construction is its front, exactly as in that image; reference 2, when attached, is a photo of fabric in the requested colour. The colour is the plain colour words given below, never the owner's name for it: image models follow plain colour words, not hex codes, and the owner's own name for the colour may be a brand word or misspelt. Never list the original colour among the construction items, and never write a negative against changing the colour.

Robe sets: some models are a set with an outer layer (a robe, kimono or cardigan) worn over the garment, and the request says which piece it is. The set's images show the full set worn together, the outer layer over the garment. Its extra front shows the garment ALONE, without the outer layer: name and describe only the garment, never the outer layer, and never invent what the outer layer hid; the photos without it (or, failing those, what shows beneath it) are the only source.

Pyjama sets photographed in parts: the top (and the robe, if any) is photographed on the display form, and the bottoms (shorts or trousers) lie flat in one photo of their own; the request says which piece the bottoms are. Every front and back image shows the COMPLETE set worn together, the bottoms beneath the top as they hang when worn. The flat photo is the only source for the bottoms: their fit (wide or narrow), leg width, length, colour, waistband, hem, pockets and trims. Describe the bottoms as worn, never as flat or folded, and never invent a back or a detail the photo does not show.

Chest panels: flat, unlined, unpadded, zero projection unless the DNA says otherwise; they lie flat on the invisible display form with no cup shape or moulding.

Wording: neutral technical garment language only ("invisible display form", "chest panel", "sleepwear set", "loungewear"). Never anatomical or suggestive words. Do not write the opening, the presentation, the finish, the photography, the background, the product lock or the negatives: the house system writes them.

If the owner left a note on a previous attempt, put its fix into the construction items, cleanUp or extraNegatives, exactly what it asks, and change nothing else.`,
  render: (input) =>
    [
      `Product: "${input.product.name}" — ${PRODUCT_LINE_PROMPT[input.product.productLine]}.`,
      VIEW_BRIEF[input.view],
      input.layers ? layersBrief(input.layers, input.view) : null,
      MODE_BRIEF[input.referenceMode],
      input.detail
        ? `Detail to feature: "${input.detail.label}" on ${input.detail.pieceName} — ${input.detail.description}.`
        : null,
      input.colorway ? requestedColour(input) : null,
      `Catalogue style (written by the house system, for your information only): ${describeCatalogueStyle(input.style)}`,
      input.references.length > 0
        ? `Reference photos, attached in this order:\n${input.references
            .map((reference, index) => `${index + 1}. ${reference.caption}`)
            .join("\n")}`
        : "No reference photos are available: rely on the Garment DNA.",
      input.note ? `Owner note on the previous attempt: ${input.note}` : null,
      `Garment DNA:\n${promptJson(input.dna)}`,
      "Return JSON with garment, colour, construction, cleanUp, extraNegatives and rationale.",
    ]
      .filter(Boolean)
      .join("\n\n"),
};
