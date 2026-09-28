import { colourWords, colourwayBrief, type OriginalColour } from "@/lib/colorways/words";
import type { GarmentDna, PieceDna } from "@/lib/domain/garment-dna";
import { neutralizeWording } from "@/lib/prompts/wording";

/**
 * Deterministic prompt blocks. The LLM writes the creative part of a prompt;
 * these blocks are appended by code so the garment lock and the negatives are
 * present in every single image/video prompt, whatever the LLM returns.
 */

export type LockView = "front" | "back" | "detail" | "all";

type LockDetail = "full" | "compact" | "minimal";

function joinSteps(steps: PieceDna["frontConstruction"]): string {
  return steps
    .filter((step) => step.zone.trim() || step.detail.trim())
    .map((step) => `${step.zone.trim()}: ${step.detail.trim()}`)
    .join("; ");
}

function describeChestPanel(piece: PieceDna): string | null {
  const panel = piece.chestPanel;
  if (!panel) return null;
  const flatDefault =
    panel.structure === "unstructured" &&
    !panel.lined &&
    !panel.padded &&
    panel.projection === "zero";
  if (flatDefault) {
    return "Chest panel: unstructured, flat, unlined, unpadded, zero projection — it lies flat on the invisible display form.";
  }
  const parts = [
    `${panel.structure} construction`,
    panel.lined ? "lined" : "unlined",
    panel.padded ? "lightly padded" : "unpadded",
    `${panel.projection} projection`,
  ];
  return `Chest panel: ${parts.join(", ")}${panel.notes ? ` (${panel.notes})` : ""} — reproduce exactly, never add more shaping.`;
}

export type ColorOverride = {
  name: string;
  hex: string;
  /** Whether the image model also receives a photo of the fabric in this colour. */
  swatch?: boolean;
};

const SWATCH_LINE =
  "The second reference image is a photo of fabric in this colour: match that colour as it would look in neutral studio daylight, and take nothing else from it.";

/** The named colours of a piece; the first is its main colour. */
function namedColours(piece: PieceDna): OriginalColour[] {
  return piece.colors
    .filter((colour) => colour.name.trim() && colour.hexRange.length > 0)
    .map((colour) => ({ name: colour.name.trim(), hex: colour.hexRange[0]! }));
}

/** Words of a colour name, for spotting it in a rule ("Taupe Grey" → taupe, grey). */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 3);
}

/** Whether the text names any of these phrases ("taupe grey" also as "taupe-grey"). */
function mentions(text: string, phrases: string[][]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((words) =>
    new RegExp(`(?<![\\p{L}])${words.join("[\\s-]+")}(?![\\p{L}])`, "u").test(lower),
  );
}

const COLOUR_TERMS =
  /\b(colou?rs?|colou?r-?(match|matched|matching)|hues?|tones?|tonal|tints?|shades?|dyes?|dyed|monochrome)\b/i;

type ColourNames = { main: string[][]; contrast: string[][] };

/**
 * Whether a "never alter" rule pins the original colour, which a colourway
 * must not carry over ("Retain exact taupe-grey color-matching…"): a rule
 * about colour that names no contrast colour, or one naming the main colour
 * in full when that name has two words or more. A one-word name ("Rose") may
 * also name a lace motif, so it alone never drops a rule.
 */
function pinsOriginalColour(rule: string, names: ColourNames): boolean {
  if (mentions(rule, names.main)) return true;
  return COLOUR_TERMS.test(rule) && !mentions(rule, names.contrast);
}

/** The main colour names (two words or more) and contrast colour words of the pieces. */
function colourNamesOf(pieces: PieceDna[]): ColourNames {
  const main: string[][] = [];
  const contrast: string[][] = [];
  for (const piece of pieces) {
    namedColours(piece).forEach((colour, index) => {
      const words = nameWords(colour.name);
      if (index > 0) contrast.push(...words.map((word) => [word]));
      else if (words.length >= 2) main.push(words);
    });
  }
  return { main, contrast };
}

function colourwayLine(piece: PieceDna, colorOverride: ColorOverride): string {
  const [main, ...others] = namedColours(piece);
  const brief = colourwayBrief(colorOverride, main ?? null);
  const target =
    others.length > 0 && main
      ? `recolour the ${main.name.toLowerCase()} parts to ${brief.words} (${brief.hex}); parts in ${others
          .map((colour) => colour.name.toLowerCase())
          .join(", ")} keep their colour`
      : `recolour the whole piece to ${brief.words} (${brief.hex})`;
  return [
    `  Colour — ${target}.`,
    brief.change,
    colorOverride.swatch ? SWATCH_LINE : null,
    "Tonal fabric, lace and trims take the new colour with their original relative tones, sheen and transparency; contrast trims keep their own colour.",
    brief.original
      ? `Wherever this lock names the original ${brief.original}, read ${brief.words}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function describePiece(
  piece: PieceDna,
  view: LockView,
  detail: LockDetail,
  colorOverride: ColorOverride | null,
): string[] {
  const lines: string[] = [];
  lines.push(
    `• Piece ${piece.position} "${piece.pieceName}": ${piece.category}, ${piece.silhouette}${
      piece.lengthAndFit ? `, ${piece.lengthAndFit}` : ""
    }.`,
  );
  if (view === "front" || view === "all" || view === "detail") {
    const front = joinSteps(piece.frontConstruction);
    if (front) lines.push(`  Front, top to bottom — ${front}.`);
  }
  if (view === "back" || view === "all") {
    const back = joinSteps(piece.backConstruction);
    if (back) lines.push(`  Back, top to bottom — ${back}.`);
  }
  const fabrics = piece.fabrics
    .filter((fabric) => fabric.name.trim())
    .map((fabric) =>
      detail === "minimal"
        ? fabric.name
        : `${fabric.name} (${[fabric.finish, fabric.opacity].filter(Boolean).join(", ")}) at ${fabric.location}`,
    );
  if (fabrics.length > 0) lines.push(`  Fabrics — ${fabrics.join("; ")}.`);

  if (piece.motif.type !== "none" && piece.motif.description.trim()) {
    lines.push(
      detail === "minimal"
        ? `  Motif — ${piece.motif.type}: ${piece.motif.description}.`
        : `  Motif — ${piece.motif.type}: ${piece.motif.description}; scale ${piece.motif.scale}; placement ${piece.motif.placement}.`,
    );
  }
  const hardware = piece.hardware
    .filter((item) => item.item.trim())
    .map((item) => {
      const count = item.count === null ? "" : `exactly ${item.count} × `;
      return detail === "minimal"
        ? `${count}${item.item}`
        : `${count}${item.item} (${item.finish}) at ${item.location}`;
    });
  if (hardware.length > 0) lines.push(`  Hardware — ${hardware.join("; ")}.`);

  if (colorOverride) {
    lines.push(colourwayLine(piece, colorOverride));
  } else {
    const colours = piece.colors
      .filter((colour) => colour.name.trim())
      .map(
        (colour) =>
          `${colour.name} ${colour.hexRange.join("–")}${detail === "full" ? ` at ${colour.location}` : ""}`,
      );
    if (colours.length > 0)
      lines.push(`  Colour — ${colours.join("; ")}; keep exactly this colour.`);
  }

  const chest = describeChestPanel(piece);
  if (chest) lines.push(`  ${chest}`);

  const names = colourNamesOf([piece]);
  const never = piece.doNotAlter.filter(
    (item) => item.trim() && !(colorOverride && pinsOriginalColour(item, names)),
  );
  if (never.length > 0) lines.push(`  Never alter — ${never.join("; ")}.`);
  return lines;
}

export function buildProductLock(
  dna: GarmentDna,
  options: {
    view?: LockView;
    piecePositions?: number[];
    detail?: LockDetail;
    colorOverride?: ColorOverride | null;
  } = {},
): string {
  const view = options.view ?? "all";
  const detail = options.detail ?? "full";
  const colorOverride = options.colorOverride ?? null;
  const pieces = options.piecePositions
    ? dna.pieces.filter((piece) => options.piecePositions!.includes(piece.position))
    : dna.pieces;
  const lines = ["PRODUCT LOCK — reproduce this exact garment. Do not redesign anything."];
  if (dna.pieces.length > 1 && dna.setComposition.trim()) {
    lines.push(`• Set: ${dna.setComposition.trim()}`);
  }
  for (const piece of pieces) lines.push(...describePiece(piece, view, detail, colorOverride));
  const names = colourNamesOf(dna.pieces);
  const globalNever = dna.globalDoNotAlter.filter(
    (item) => item.trim() && !(colorOverride && pinsOriginalColour(item, names)),
  );
  if (globalNever.length > 0)
    lines.push(`• Never alter (whole product) — ${globalNever.join("; ")}.`);
  return lines.join("\n");
}

const NEGATIVE_LINES = [
  "STRICT NEGATIVES — do not add, remove or move any detail; no redesign;",
  "do not change the lace motif, seams, straps, button count, closures, trims, hem shape or print scale;",
  "COLOUR_LINE",
  "no stylisation, illustration, CGI or painterly effects;",
  "no person and no body parts;",
  "no visible display form, stand, pole, hanger hook, pins, clips, tags or labels;",
  "no added padding, lining, moulding or projection on the chest panel;",
  "no logos, text or watermarks on the garment.",
];

export function buildStrictNegatives(
  colorOverride: ColorOverride | null = null,
  dna: GarmentDna | null = null,
): string {
  const colourLine = colorOverride
    ? colourwayNegative(colorOverride, dna)
    : "no colour shift, tint or re-grade of the garment colour;";
  return NEGATIVE_LINES.map((line) => (line === "COLOUR_LINE" ? colourLine : line)).join(" ");
}

function colourwayNegative(colorOverride: ColorOverride, dna: GarmentDna | null): string {
  const { words } = colourWords(colorOverride.name, colorOverride.hex);
  const originals = [
    ...new Set(
      (dna?.pieces ?? []).flatMap((piece) =>
        namedColours(piece)
          .slice(0, 1)
          .map((colour) => colour.name.toLowerCase()),
      ),
    ),
  ];
  const trace = originals.length > 0 ? ` no trace of the original ${originals.join(" or ")},` : "";
  return `no colour other than ${words} (${colorOverride.hex.toUpperCase()}) on the recoloured fabric,${trace} no uneven dye, no tint on trims that were tonal;`;
}

/**
 * Negatives from the director brain that forbid the colour change a
 * colourway asks for ("no colour shift"); they are dropped from colourways.
 */
const COLOUR_CHANGE_BAN =
  /\bcolou?r[\s-]*(shift|change|drift|variation|alteration|difference)s?\b|\brecolou?r|\bre-?grad(e|ing)\b|\bdifferent colou?r|\boriginal colou?r/i;

export function keepColourwayNegatives(items: string[]): string[] {
  return items.filter((item) => !COLOUR_CHANGE_BAN.test(item));
}

export const STRICT_NEGATIVES = buildStrictNegatives();

/** Short comma list for providers that accept a separate negative prompt. */
const NEGATIVE_TERMS = [
  "added details",
  "missing details",
  "redesigned garment",
  "changed lace pattern",
  "wrong button count",
  "colour shift",
  "stylised",
  "illustration",
  "cgi",
  "person",
  "body parts",
  "visible display form",
  "stand",
  "pins",
  "clips",
  "text",
  "watermark",
  "logo",
  "padded chest panel",
  "warped fabric",
  "melted seams",
];

export const NEGATIVE_PROMPT_TERMS = NEGATIVE_TERMS.join(", ");

/** The negative terms for one image; a colourway leaves out "colour shift". */
export function negativePromptTerms(colourway = false): string {
  return colourway
    ? NEGATIVE_TERMS.filter((term) => term !== "colour shift").join(", ")
    : NEGATIVE_PROMPT_TERMS;
}

export type ComposeOptions = {
  scene: string;
  dna: GarmentDna;
  view?: LockView;
  piecePositions?: number[];
  style?: string | null;
  extraNegatives?: string[];
  colorOverride?: ColorOverride | null;
  maxChars?: number;
};

/**
 * Final provider prompt = scene + style + PRODUCT LOCK + STRICT NEGATIVES,
 * neutralised and fitted to the model's prompt budget by compacting the lock
 * (the negatives and the scene are never dropped).
 */
export function composeGenerationPrompt(options: ComposeOptions): string {
  const maxChars = options.maxChars ?? 4000;
  const trimmed = (options.extraNegatives ?? []).map((item) => item.trim()).filter(Boolean);
  const extras = options.colorOverride ? keepColourwayNegatives(trimmed) : trimmed;
  const baseNegatives = buildStrictNegatives(options.colorOverride ?? null, options.dna);
  const negatives =
    extras.length > 0 ? `${baseNegatives} Also: ${extras.join("; ")}.` : baseNegatives;
  const levels: LockDetail[] = ["full", "compact", "minimal"];
  let prompt = "";
  for (const detail of levels) {
    const lock = buildProductLock(options.dna, {
      view: options.view,
      piecePositions: options.piecePositions,
      detail,
      colorOverride: options.colorOverride,
    });
    prompt = neutralizeWording(
      [options.scene.trim(), options.style?.trim() || null, lock, negatives]
        .filter(Boolean)
        .join("\n\n"),
    );
    if (prompt.length <= maxChars) return prompt;
  }
  return prompt;
}
