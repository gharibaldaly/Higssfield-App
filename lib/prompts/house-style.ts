import { colourWords, type ColourwayBrief, type OriginalColour } from "@/lib/colorways/words";
import type { CatalogueStyle } from "@/lib/domain/catalogue-style";
import type { GarmentDna } from "@/lib/domain/garment-dna";
import type { ProductLine } from "@/lib/domain/product";
import { colourDistance, hexToRgb } from "@/lib/images/framing";
import type { GhostScenePrompt, GhostView } from "@/lib/providers/llm/types";

/**
 * The catalogue's house system: every ghost prompt is assembled here, by
 * code, in the shape of the owner's reference prompts (lib/prompts/v3/ghost.ts),
 * so every image in the store is asked for in the same words. The director
 * brain only supplies the garment: what it is, its colour, the construction
 * list for the view, and what in the photos to leave out.
 */

export type GhostParagraphInput = {
  view: GhostView;
  scene: GhostScenePrompt;
  dna: GarmentDna;
  style: CatalogueStyle;
  productLine: ProductLine;
  referenceMode: "edit" | "text";
  detail: { label: string } | null;
  /** A colourway's requested colour, in words, and whether its swatch photo is attached. */
  colourway: (ColourwayBrief & { swatch: boolean }) | null;
};

const PHOTOGRAPHY: Record<ProductLine, string> = {
  SECRET: "luxury high-end sleepwear e-commerce photography",
  HOURS: "luxury high-end homewear and pyjama e-commerce photography",
  VOWS: "luxury high-end bridal sleepwear e-commerce photography",
};

const DISPLAY =
  "displayed on an invisible display form in the classic ghost technique, with absolutely no visible form, stand or human body parts";
const FINISH =
  "perfectly symmetrical, professionally shaped and naturally filled, immaculate and perfectly ironed with no wrinkles or distortions";
const MACRO_FINISH = "immaculate and perfectly pressed with no wrinkles, lint or loose threads";
/**
 * Trims are tidied as a stylist would set them (the owner's ask on
 * 2026-09-29: a crumpled bow comes out neat), never restyled or resized.
 */
const GROOMING =
  "every bow, ribbon, tie, charm and trim neatly set as a stylist would arrange it for the shot: bows open and symmetrical with smooth loops and straight tails, ribbons and ties uncreased, charms hanging straight, each kept at exactly its original size, shape, position, count and construction, only tidied and never restyled";
const QUALITY =
  "crisp fabric and stitching detail, photorealistic 4K resolution, realistic textile rendering, premium catalogue finish";
const CLOSING = "no text, no logo, no accessories, no humans";
const SEAMS = "and all original seams and panel divisions";
const TRIMS_TAKE_COLOUR =
  "tonal fabric, lace and trims take the new colour with their original relative tones, sheen and transparency, contrast trims keep their own colour";

const SHADOW: Record<CatalogueStyle["shadow"], string> = {
  none: "no cast shadow",
  soft: "very subtle natural shadow",
  grounded: "a subtle grounded shadow beneath the garment",
};

function isWhite(hex: string): boolean {
  const rgb = hexToRgb(hex);
  return rgb !== null && colourDistance(rgb, [255, 255, 255]) <= 3;
}

function backgroundPhrase(style: CatalogueStyle): string {
  return isWhite(style.background)
    ? "clean pure white (#FFFFFF) seamless background, flat and even edge to edge"
    : `clean seamless solid ${style.background.toUpperCase()} background, flat and even edge to edge`;
}

function lightingPhrase(style: CatalogueStyle): string {
  const own = style.lighting
    .trim()
    .replace(/;\s*/g, ", ")
    .replace(/[.;,\s]+$/, "");
  return own ? `soft diffused studio lighting, ${own}` : "soft diffused studio lighting";
}

function framingPhrase(style: CatalogueStyle): string {
  return `whole garment centred in frame with about ${style.paddingPercent}% clear margin on every side, ${style.aspectRatio} aspect ratio`;
}

/** Trimmed, without trailing punctuation, no repeats, at most `max` items. */
function cleanList(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = item.trim().replace(/[.;,\s]+$/, "");
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === max) break;
  }
  return out;
}

/** The first named colour of the first piece: the garment's main colour, as the DNA has it. */
export function mainColourOf(dna: GarmentDna): OriginalColour | null {
  const colour = dna.pieces
    .flatMap((piece) => piece.colors)
    .find((candidate) => candidate.name.trim() && candidate.hexRange.length > 0);
  return colour ? { name: colour.name.trim(), hex: colour.hexRange[0]! } : null;
}

/** When the brain leaves the construction empty: the DNA's own steps for the view. */
function constructionFromDna(dna: GarmentDna, view: GhostView): string[] {
  return dna.pieces.flatMap((piece) =>
    (view === "back" ? piece.backConstruction : piece.frontConstruction)
      .filter((step) => step.detail.trim())
      .map((step) =>
        step.zone.trim() ? `${step.zone.trim()}: ${step.detail.trim()}` : step.detail,
      ),
  );
}

/**
 * One ghost prompt in the house shape: the opening names the exact garment
 * and its colour, the construction list sits inside the sentence, then the
 * finish, the composition, the photography, the light, the background and
 * the short closing negatives. The product lock and the strict negatives are
 * appended after it by composeGenerationPrompt.
 */
export function composeGhostParagraph(input: GhostParagraphInput): string {
  const { view, scene, dna, style, referenceMode } = input;
  const garment =
    scene.garment.trim().replace(/[.;,\s]+$/, "") ||
    dna.pieces[0]?.silhouette.trim() ||
    dna.pieces[0]?.category.trim() ||
    "garment";
  const main = mainColourOf(dna);
  const colour = input.colourway
    ? input.colourway.words
    : scene.colour.trim().replace(/[.;,\s]+$/, "") ||
      (main ? colourWords(main.name, main.hex).words : "");
  const named = colour ? `${colour} ${garment}` : garment;
  const accurate = colour ? `accurate ${colour} colour` : "accurate colour";
  const construction = cleanList(scene.construction, 10);
  const items =
    construction.length > 0 ? construction : cleanList(constructionFromDna(dna, view), 10);
  const list = items.length > 0 ? `${items.join(", ")}, ${SEAMS}` : SEAMS.replace(/^and /, "");
  const photography = PHOTOGRAPHY[input.productLine];
  const light = lightingPhrase(style);
  const background = backgroundPhrase(style);
  const cleanUp = referenceMode === "edit" ? cleanList(scene.cleanUp, 5) : [];
  const leaveOut =
    cleanUp.length > 0
      ? ` Leave out from the reference photos: ${cleanUp.join(", ")}; every designed gather, pleat, ruche and drape fold stays exactly as made.`
      : "";
  const source =
    referenceMode === "edit"
      ? "Working only from the attached reference photos of this exact garment, create"
      : "Create";

  if (view === "macro") {
    const detail = input.detail?.label.trim() || "signature detail";
    return (
      [
        `${source} a premium ultra-realistic e-commerce macro photograph of the ${detail} of the exact ${named}, as it sits on an invisible display form with no visible form, stand or human body parts, preserving the exact original construction of this detail: ${list}; the detail fills most of the frame, tack-sharp, with the real thread structure, weave and sheen of the fabric visible and gentle depth-of-field fall-off`,
        MACRO_FINISH,
        GROOMING,
        `${accurate} and true fabric texture`,
        photography,
        `${light} with a soft raking accent that reveals the texture`,
        `${background} wherever any background shows`,
        `${style.aspectRatio} aspect ratio`,
        QUALITY,
        CLOSING,
      ].join(", ") +
      "." +
      leaveOut
    );
  }

  if (view === "colorway" && input.colourway) {
    const { words, hex, change, swatch } = input.colourway;
    const colourNote = [
      change,
      swatch
        ? "The second reference image is a photo of fabric in this colour: match that colour as it would look in neutral studio daylight, and take nothing else from it."
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      `Working only from the approved catalogue front image (reference 1), create a premium ultra-realistic e-commerce fashion photograph of the exact ${garment} re-rendered in ${words} (${hex}): only the fabric colour changes.${colourNote ? ` ${colourNote}` : ""} Preserve the exact original garment construction, proportions, framing, pose, drape, light and background of that image: ${list}; ${TRIMS_TAKE_COLOUR}; ` +
      [
        FINISH,
        GROOMING,
        `${accurate} and subtle fabric texture`,
        "front-facing centred composition identical to the approved image",
        framingPhrase(style),
        photography,
        light,
        SHADOW[style.shadow],
        background,
        QUALITY,
        CLOSING,
      ].join(", ") +
      "."
    );
  }

  const opening =
    view === "back"
      ? `${source} a premium ultra-realistic e-commerce fashion photograph of the exact ${named} shown from the rear, ${DISPLAY}, accurately reconstructing and preserving the original back construction: ${list}; preserve the exact colour, fabric texture, strap width, stitching style and construction details ${referenceMode === "edit" ? "from the reference" : "as specified"}`
      : `${source} a premium ultra-realistic e-commerce fashion photograph of the exact ${named}, ${DISPLAY}, preserving the exact original garment construction and proportions: ${list}`;
  const composition =
    view === "back"
      ? "rear-facing centred composition with the same framing, scale and light as the front image"
      : "front-facing centred composition";
  return (
    `${opening}${view === "back" ? ", " : "; "}` +
    [
      FINISH,
      GROOMING,
      `${accurate} and subtle fabric texture`,
      composition,
      framingPhrase(style),
      photography,
      light,
      SHADOW[style.shadow],
      background,
      QUALITY,
      CLOSING,
    ].join(", ") +
    "." +
    leaveOut
  );
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
  items.push(
    "no crumpled, twisted or drooping bows, ribbons, ties or charms, and no change to their size, shape, position or count",
  );
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
