import { PRODUCT_LINE_PROMPT } from "@/lib/domain/product";
import type { GhostPromptInput } from "@/lib/providers/llm/types";
import { promptJson, type PromptTemplate } from "@/lib/prompts/types";

const VIEW_BRIEF: Record<GhostPromptInput["view"], string> = {
  front:
    "FRONT view: straight-on, symmetrical, centred, the full garment visible from top edge to hem.",
  back: "BACK view of the same garment: straight-on, identical framing and scale to the front image, the full back visible.",
  macro:
    "MACRO close-up for advertising: the named detail fills most of the frame, crisp micro-texture, gentle depth-of-field fall-off, catalogue background colour where any background shows.",
  colorway:
    "COLOURWAY re-render of the approved front image: identical pose, framing, drape and every construction detail — only the colour changes to the requested colour.",
};

export const ghostV1: PromptTemplate<GhostPromptInput> = {
  id: "ghost",
  version: "1.0.0",
  system: `You write image prompts for Dr. Secret's Shopify catalogue: ghost-mannequin product photographs. The garment is presented on an invisible display form — with natural volume and drape as if worn, the inside of the back neckline visible where the cut allows — while no form, stand, pins or person is visible.

You receive the Garment DNA, the requested view, the catalogue style and captions of the isolated reference images. Write "scene": concise, concrete instructions for this exact image — view and framing, how the garment sits and drapes on the invisible display form, which construction details must be clearly visible from this angle, how the fabric reads (sheen, transparency, texture) and how the catalogue style applies. A product lock with the full DNA and strict negatives is appended automatically, so do not repeat the whole DNA — name the details that matter for this view.

Rules:
- Photographic realism, true-to-life colour, no stylisation.
- Neutral technical wording only: "invisible display form", "unstructured chest panel", "sleepwear set", "loungewear". Never anatomical or suggestive words.
- If the owner left a note about a previous attempt, fix exactly what the note asks and change nothing else.
- Put extra things to avoid for this particular image into extraNegatives (short phrases).`,
  render: (input) =>
    [
      `Product: "${input.product.name}" — ${PRODUCT_LINE_PROMPT[input.product.productLine]}.`,
      VIEW_BRIEF[input.view],
      input.detail
        ? `Detail to feature: "${input.detail.label}" on ${input.detail.pieceName} — ${input.detail.description}.`
        : null,
      input.colorway
        ? `Requested colour: ${input.colorway.name} (${input.colorway.hex.toUpperCase()}).`
        : null,
      `Catalogue style: ${input.styleDescription}`,
      `Reference images supplied to the image model: ${input.referenceCaptions.join("; ") || "none"}.`,
      input.note ? `Owner note on the previous attempt: ${input.note}` : null,
      `Garment DNA:\n${promptJson(input.dna)}`,
      "Return JSON with scene, extraNegatives and a one-sentence rationale.",
    ]
      .filter(Boolean)
      .join("\n\n"),
};
