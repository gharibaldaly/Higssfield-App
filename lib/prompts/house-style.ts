import type { CatalogueStyle } from "@/lib/domain/catalogue-style";
import { colourDistance, hexToRgb } from "@/lib/images/framing";
import type { GhostView } from "@/lib/providers/llm/types";

/**
 * The catalogue's house style, written by code (never by the LLM) so every
 * ghost image in the store gets exactly the same background, light, camera,
 * framing and finish. Only the garment changes from one product to the next.
 */

function isWhite(hex: string): boolean {
  const rgb = hexToRgb(hex);
  return rgb !== null && colourDistance(rgb, [255, 255, 255]) <= 3;
}

function backgroundPhrase(style: CatalogueStyle): string {
  return isWhite(style.background)
    ? "seamless pure white #FFFFFF background"
    : `seamless solid ${style.background.toUpperCase()} background`;
}

const SHADOW_LINE: Record<CatalogueStyle["shadow"], string> = {
  none: "No cast shadow: the garment floats cleanly on the background.",
  soft: "Only a very faint, soft shadow directly beneath the garment.",
  grounded: "A subtle grounded shadow beneath the garment.",
};

const FINISH =
  "Clean, freshly pressed finish: no handling creases, dust, lint or loose threads; designed gathers, pleats, ruching and drape folds stay exactly as made.";

const REALISM =
  "A real high-end e-commerce photograph with true fabric texture, not CGI, not a 3D render, not an illustration.";

export function buildHouseStyle(style: CatalogueStyle, view: GhostView): string {
  const background = backgroundPhrase(style);
  if (view === "macro") {
    return [
      "HOUSE STYLE (same for every close-up in the catalogue):",
      `Where any background shows, it is a ${background}.`,
      "The named detail fills most of the frame, tack-sharp, with gentle depth-of-field fall-off; the real thread structure, weave and sheen of the fabric are visible.",
      `Light: ${style.lighting}; a soft raking accent reveals the texture. Aspect ratio ${style.aspectRatio}.`,
      FINISH,
      REALISM,
    ].join(" ");
  }
  return [
    "HOUSE STYLE (same for every catalogue image):",
    `${background[0]!.toUpperCase()}${background.slice(1)}, flat and evenly lit edge to edge: no grey cast, gradient, vignette, floor line or horizon.`,
    "Invisible display form: the garment keeps its natural worn shape with nothing visible holding it; upright, symmetrical and centred; straps, sleeves and hems fall naturally.",
    "Straight-on camera at mid-garment height, long-lens look with no perspective distortion, sharp from edge to edge.",
    `Light: ${style.lighting}.`,
    `The whole garment in frame, centred, with about ${style.paddingPercent}% clear margin on every side; aspect ratio ${style.aspectRatio}.`,
    SHADOW_LINE[style.shadow],
    view === "colorway"
      ? "Framing, pose, drape and light identical to the approved front image."
      : null,
    FINISH,
    REALISM,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Ghost-only additions to the shared STRICT NEGATIVES. */
export function ghostNegatives(style: CatalogueStyle, view: GhostView): string[] {
  const items = [
    "no hanger, hook, clip, peg or pin anywhere in the image",
    "no room, wall, bed, floor, furniture, props or reflections",
    isWhite(style.background)
      ? "no grey, beige or tinted background, no gradient or vignette"
      : `no background colour other than ${style.background.toUpperCase()}, no gradient or vignette`,
  ];
  if (view !== "macro") {
    items.push("no change to the length, neckline depth, strap width or strap position");
  }
  return items;
}

/** Extra comma terms for providers with a separate negative prompt. */
export const GHOST_NEGATIVE_TERMS = [
  "hanger",
  "room background",
  "grey background",
  "gradient background",
  "floor",
  "props",
  "dust",
  "lint",
];
