import type { GhostLayers, GhostPiece } from "@/lib/providers/llm/types";

/**
 * Sets photographed in parts.
 * - Robe sets: a piece worn as an outer layer over the garment. A front & back
 *   job of such a set renders a second front without that piece (see
 *   `planSlots`), while the colourways start from the front with it.
 * - Pyjama sets: the top (and the robe, if any) is photographed on the display
 *   form and the bottoms (shorts or trousers) lie flat in one photo. The
 *   images compose the bottoms beneath the top, so the catalogue shows the
 *   complete pyjama.
 */

/** Piece names that read as an outer layer, in English and Arabic. */
const OUTER_LAYER_NAME =
  /\b(robe|robes|kimono|cardigan|jacket|gown|wrap|cover[- ]?up)\b|روب|كيمونو|جاكيت|كارديجان/iu;

/** Piece names that read as the bottoms of a pyjama, in English and Arabic. */
const BOTTOMS_NAME =
  /\b(shorts?|pants?|trousers?|bottoms?|slacks|joggers?|leggings?|culottes?|boxers?)\b|شورت|بنطلون|بنطال|شورط/iu;

/**
 * The piece of a set that reads as its outer layer, by its name; null for a
 * single piece or a set without one. A suggestion the owner can change.
 */
export function guessOuterPiece(pieces: { position: number; name: string }[]): number | null {
  if (pieces.length < 2) return null;
  return pieces.find((piece) => OUTER_LAYER_NAME.test(piece.name))?.position ?? null;
}

/**
 * The piece of a set that reads as its bottoms (shorts, trousers), by its
 * name; null for a single piece or a set without one. A suggestion the owner
 * can change.
 */
export function guessBottomsPiece(pieces: { position: number; name: string }[]): number | null {
  if (pieces.length < 2) return null;
  return pieces.find((piece) => BOTTOMS_NAME.test(piece.name))?.position ?? null;
}

export type LayerPieces = Pick<GhostLayers, "outerPiece" | "innerPieces" | "bottomsPiece">;

/**
 * How a set's pieces go together, from the job's options: the outer piece
 * (a robe) worn over the rest, and the bottoms photographed flat. Null when
 * the options name neither, or name pieces that leave nothing to wear them
 * with (a robe alone, or bottoms with no top).
 */
export function setLayersOf(
  pieces: GhostPiece[],
  options: { outerPosition?: number | null; bottomsPosition?: number | null },
): LayerPieces | null {
  const outerPiece = options.outerPosition
    ? (pieces.find((piece) => piece.position === options.outerPosition) ?? null)
    : null;
  const innerPieces = pieces.filter((piece) => piece.position !== outerPiece?.position);
  // Bottoms need a top to be worn with: another inner piece.
  const bottomsPiece =
    (options.bottomsPosition &&
      innerPieces.length >= 2 &&
      innerPieces.find((piece) => piece.position === options.bottomsPosition)) ||
    null;
  if (!outerPiece && !bottomsPiece) return null;
  if (outerPiece && innerPieces.length === 0) return null;
  return { outerPiece, innerPieces, bottomsPiece };
}

/** The outer piece and the pieces beneath it, from a robe set's option. */
export function layerPiecesOf(
  pieces: GhostPiece[],
  outerPosition: number | null | undefined,
): LayerPieces | null {
  return setLayersOf(pieces, { outerPosition });
}
