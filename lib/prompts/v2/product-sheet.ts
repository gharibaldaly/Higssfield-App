import { PRODUCT_LINE_PROMPT } from "@/lib/domain/product";
import type { SheetPlanInput } from "@/lib/providers/llm/types";
import { promptJson, type PromptTemplate } from "@/lib/prompts/types";

/**
 * The product sheet is built from the owner's photos: the brain chooses what
 * each card shows and where it is on which photo, and the studio cuts those
 * regions out at full resolution. Nothing is drawn, so nothing can drift from
 * the real garment (v1 had an image model draw the whole sheet).
 */
export const productSheetV2: PromptTemplate<SheetPlanInput> = {
  id: "product-sheet",
  version: "2.0.0",
  system: `You plan Dr. Secret's product sheet from the owner's real photos of one garment. Nothing on the sheet is drawn: every image on it is cut out of the photos you are shown, at full resolution, so the sheet is exactly as true as your choices.

The sheet (landscape 16:9): a title; a hero card with the whole front; 3–5 overview bullets; a back-view card; a 3×2 grid of six close-up detail cards; a bottom row of two cards.

Choose:
1. front: the photo that shows the whole front most clearly (sharp, straight on, well lit, nothing covering it) and a box around the whole garment in that photo.
2. back: the same for the back, or null when no photo shows the back.
3. detailCards: exactly six different details that prove quality and fidelity — lace motif, trims, straps, closures, seams, hardware, fabric sheen. Each must be a real detail from the Garment DNA and clearly visible in the photo you name. Prefer close-up photos; otherwise the sharpest photo in which the detail is large. Box it tightly with a small margin: the box is cut out of the full-resolution photo, so a small box in a sharp photo still gives a crisp close-up. Never box the same region twice. Label each in at most three words.
4. bottomCards: for a set of two or three pieces, the first card is kind "pieces" with photo and box null (the studio places each piece's front photo side by side), and the second is a fabric swatch. For a single piece, both cards are fabric swatches, one per main fabric (for example the lace and the satin): a flat, evenly lit area of that fabric only, with no edge, seam or trim in the box.
5. title: the garment's name as it would appear in a catalogue, at most 60 characters. overviewBullets: 3–5 factual bullets of at most eight words. Write them in English.

Boxes are [ymin, xmin, ymax, xmax] as integers from 0 to 1000 relative to the photo as shown, with 0,0 at its top-left corner. Photo numbers are the numbers in the captions.

Choose only what the photos really show; never describe a detail you cannot see. Use neutral technical wording ("invisible display form", "unstructured chest panel", "sleepwear set"); never anatomical or suggestive words.`,
  render: (input) =>
    [
      `Product: "${input.product.name}" — ${PRODUCT_LINE_PROMPT[input.product.productLine]}.`,
      `Pieces: ${input.product.pieces.map((piece) => `"${piece.name}"`).join(", ")}.`,
      `Photos, in the order attached:\n${input.photos.map((photo) => photo.caption).join("\n")}`,
      input.note ? `Owner note on the previous sheet: ${input.note}` : null,
      `Garment DNA:\n${promptJson(input.dna)}`,
      "Return the sheet plan as JSON.",
    ]
      .filter(Boolean)
      .join("\n\n"),
};
