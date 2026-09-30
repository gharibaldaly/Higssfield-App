import type { GhostPiece } from "@/lib/providers/llm/types";

/**
 * Robe sets: a piece worn as an outer layer over the garment. A front & back
 * job of such a set renders a second front without that piece (see
 * `planSlots`), while the colourways start from the front with it.
 */

/** Piece names that read as an outer layer, in English and Arabic. */
const OUTER_LAYER_NAME =
  /\b(robe|robes|kimono|cardigan|jacket|gown|wrap|cover[- ]?up)\b|روب|كيمونو|جاكيت|كارديجان/iu;

/**
 * The piece of a set that reads as its outer layer, by its name; null for a
 * single piece or a set without one. A suggestion the owner can change.
 */
export function guessOuterPiece(pieces: { position: number; name: string }[]): number | null {
  if (pieces.length < 2) return null;
  return pieces.find((piece) => OUTER_LAYER_NAME.test(piece.name))?.position ?? null;
}

export type LayerPieces = { outerPiece: GhostPiece; innerPieces: GhostPiece[] };

/** The outer piece and the inner pieces of a robe set, from the job's option. */
export function layerPiecesOf(
  pieces: GhostPiece[],
  outerPosition: number | null | undefined,
): LayerPieces | null {
  if (!outerPosition) return null;
  const outerPiece = pieces.find((piece) => piece.position === outerPosition);
  const innerPieces = pieces.filter((piece) => piece.position !== outerPosition);
  return outerPiece && innerPieces.length > 0 ? { outerPiece, innerPieces } : null;
}
