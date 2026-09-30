import { PRODUCT_LINE_PROMPT } from "@/lib/domain/product";
import type { ClassifyPhotosInput } from "@/lib/providers/llm/types";
import type { PromptTemplate } from "@/lib/prompts/types";

/**
 * Sorts a model's phone photos into views before the Garment DNA is written,
 * so a batch of unnamed photos (IMG_2231.jpg…) still gets the right front,
 * back and detail references.
 */
export const classifyPhotosV1: PromptTemplate<ClassifyPhotosInput> = {
  id: "classify-photos",
  version: "1.1.0",
  system: `You sort phone photos of ONE garment model (one style) for Dr. Secret's catalogue studio. For every photo, in the order attached, decide:
- view: "front" = the whole garment seen from the front (hanging, lying flat or worn); "back" = the whole garment seen from the back; "detail" = a close view of part of the garment (lace, trim, strap, closure, fabric, hem, label…); "other" = not useful as a garment reference (a loose fabric swatch, packaging, a tag on its own, a blurred or unrelated photo).
- label: a short neutral description of what the photo shows, at most 8 words (for example "full front on a hanger", "lace hem close-up", "crossed back straps").
- clarity: 1 to 5, how well the photo serves as a reference: 5 = sharp, evenly lit, the whole view visible and uncluttered; 1 = blurred, cut off or hidden.
- showsOuterLayer: only when the request names an outer layer (a robe, kimono or cardigan worn over the garment): true when that outer piece is in the photo (worn over the garment, or shown on its own, or a close view of it), false when the photo shows the garment without it. null when the request names no outer layer.

Use neutral technical garment wording only. Return one entry per photo with its 1-based index.`,
  render: (input) =>
    [
      `Model: "${input.product.name}" — ${PRODUCT_LINE_PROMPT[input.product.productLine]}.`,
      input.outerLayer
        ? `Outer layer: this model is a set whose piece "${input.outerLayer}" is worn over the garment in some photos and left off in others. For every photo, showsOuterLayer says whether the ${input.outerLayer} is in it.`
        : "Outer layer: none (showsOuterLayer is null for every photo).",
      `Photos, in the order attached:\n${input.photos
        .map((photo, index) => `${index + 1}. ${photo.caption}`)
        .join("\n")}`,
      "Return JSON with one entry per photo.",
    ].join("\n\n"),
};
