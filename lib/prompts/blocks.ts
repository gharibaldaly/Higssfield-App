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

export type ColorOverride = { name: string; hex: string };

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
    lines.push(
      `  Colour — recolour the whole piece to ${colorOverride.name} ${colorOverride.hex.toUpperCase()}; fabric, lace and trims keep their original relative tones, sheen and transparency. Only the colour changes.`,
    );
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

  const never = piece.doNotAlter.filter((item) => item.trim());
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
  const globalNever = dna.globalDoNotAlter.filter((item) => item.trim());
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

export function buildStrictNegatives(colorOverride: ColorOverride | null = null): string {
  const colourLine = colorOverride
    ? `no colour other than the requested ${colorOverride.hex.toUpperCase()}, no uneven dye, no tint on trims that were tonal;`
    : "no colour shift, tint or re-grade of the garment colour;";
  return NEGATIVE_LINES.map((line) => (line === "COLOUR_LINE" ? colourLine : line)).join(" ");
}

export const STRICT_NEGATIVES = buildStrictNegatives();

/** Short comma list for providers that accept a separate negative prompt. */
export const NEGATIVE_PROMPT_TERMS = [
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
].join(", ");

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
  const extras = (options.extraNegatives ?? []).map((item) => item.trim()).filter(Boolean);
  const baseNegatives = buildStrictNegatives(options.colorOverride ?? null);
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
