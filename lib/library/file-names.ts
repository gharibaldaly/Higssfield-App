import { extensionFor } from "@/lib/storage/paths";

/** What a downloaded file is named after: the model and the view it shows. */
export type NamedOutput = {
  model: string;
  slot: string;
  slotLabel: string | null;
  purpose: string;
  mimeType: string | null;
};

const FORBIDDEN = /[\\/:*?"<>|\x00-\x1f\x7f]/g;

/** A name that every file system accepts, with the letters kept (Arabic included). */
export function safeFileName(text: string, fallback: string): string {
  const cleaned = text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(FORBIDDEN, "-")
    .trim()
    .replace(/[. ]+$/, "");
  return (cleaned || fallback).slice(0, 80);
}

function viewName({ slot, slotLabel, purpose }: NamedOutput): string {
  if (slot === "front") return "front";
  if (slot === "back") return "back";
  const macro = /^macro_(\d+)$/.exec(slot);
  if (macro) return slotLabel ? `closeup-${macro[1]}-${slotLabel}` : `closeup-${macro[1]}`;
  if (slot.startsWith("colorway:")) return slotLabel ? `colour-${slotLabel}` : "colour";
  switch (purpose) {
    case "ghost_front":
      return "front";
    case "ghost_back":
      return "back";
    case "macro":
      return slotLabel ? `closeup-${slotLabel}` : "closeup";
    case "colorway":
      return slotLabel ? `colour-${slotLabel}` : "colour";
    case "product_sheet":
      return "sheet";
    case "shot_preview":
      return "shot-frame";
    case "shot_video":
      return "shot";
    default:
      return "image";
  }
}

/**
 * Where an output goes in a downloaded archive: one folder per model, and
 * the model's name in every file name, so files from many folders can be
 * dropped into a shop upload together and still be told apart.
 */
export function outputFileName(output: NamedOutput): string {
  const model = safeFileName(output.model, "model");
  const view = safeFileName(viewName(output), "image");
  return `${model}/${model}-${view}.${extensionFor(output.mimeType ?? "image/png")}`;
}

/** The same names, with " (2)", " (3)"… added to any that repeat. */
export function uniqueFileNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    const slash = name.lastIndexOf("/");
    return dot > slash
      ? `${name.slice(0, dot)} (${count})${name.slice(dot)}`
      : `${name} (${count})`;
  });
}
