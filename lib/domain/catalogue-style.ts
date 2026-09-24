import { z } from "zod";

import { hexColor } from "@/lib/domain/garment-dna";

export const CATALOGUE_ASPECT_RATIOS = ["4:5", "1:1", "3:4", "2:3"] as const;
export const CATALOGUE_SHADOWS = ["none", "soft", "grounded"] as const;

/**
 * One catalogue look for the whole Shopify store: every ghost-mannequin image
 * shares background, framing, lighting and shadow so the grid stays calm.
 */
export const catalogueStyleSchema = z.object({
  background: hexColor,
  aspectRatio: z.enum(CATALOGUE_ASPECT_RATIOS),
  paddingPercent: z.number().min(0).max(30),
  shadow: z.enum(CATALOGUE_SHADOWS),
  lighting: z.string().trim().min(1).max(400),
});

export type CatalogueStyle = z.infer<typeof catalogueStyleSchema>;

export const DEFAULT_CATALOGUE_STYLE: CatalogueStyle = {
  background: "#F7F3EE",
  aspectRatio: "4:5",
  paddingPercent: 8,
  shadow: "soft",
  lighting:
    "soft, even, diffused studio light from the front-left; true-to-life colour; no harsh highlights",
};

export function parseCatalogueStyle(value: unknown): CatalogueStyle {
  const parsed = catalogueStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CATALOGUE_STYLE;
}

const SHADOW_PROMPT: Record<CatalogueStyle["shadow"], string> = {
  none: "no cast shadow",
  soft: "a very soft, diffused contact shadow directly beneath the garment",
  grounded: "a subtle grounded shadow that anchors the garment to the floor plane",
};

/** English description used in image prompts. */
export function describeCatalogueStyle(style: CatalogueStyle): string {
  return [
    `Seamless solid background colour ${style.background.toUpperCase()}, perfectly even, no gradient, no texture.`,
    `Aspect ratio ${style.aspectRatio}; garment centred with ${style.paddingPercent}% empty margin on every side; same scale and framing as the rest of the catalogue.`,
    `Lighting: ${style.lighting}.`,
    `Shadow: ${SHADOW_PROMPT[style.shadow]}.`,
  ].join(" ");
}
