import type { PhotoKind } from "@/lib/domain/product";

/**
 * Reference selection. The project rule: never feed whole product sheets or
 * mixed collages — pass isolated, cropped references that match the shot.
 */
export type PhotoRef = {
  id: string;
  pieceId: string;
  piecePosition: number;
  kind: PhotoKind;
  label: string | null;
  storagePath: string;
};

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9؀-ۿ]+/)
      .filter((token) => token.length > 2),
  );
}

/** Jaccard overlap between two labels (0–1). */
export function labelSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function byPiece(photos: PhotoRef[]): PhotoRef[] {
  return [...photos].sort((a, b) => a.piecePosition - b.piecePosition);
}

/** One photo of the given kind per piece (piece order), up to `max`. */
export function viewReferences(
  photos: PhotoRef[],
  kind: "front" | "back",
  max: number,
  piecePositions?: number[],
): PhotoRef[] {
  const seen = new Set<string>();
  const result: PhotoRef[] = [];
  for (const photo of byPiece(photos)) {
    if (photo.kind !== kind || seen.has(photo.pieceId)) continue;
    if (piecePositions && !piecePositions.includes(photo.piecePosition)) continue;
    seen.add(photo.pieceId);
    result.push(photo);
    if (result.length >= max) break;
  }
  return result;
}

/**
 * Best isolated reference for a close-up: the detail photo whose label best
 * matches the detail, preferring the right piece; falls back to that piece's
 * front photo.
 */
export function detailReferences(
  photos: PhotoRef[],
  detail: { label: string; description?: string; piecePosition: number | null },
  max: number,
): PhotoRef[] {
  const query = `${detail.label} ${detail.description ?? ""}`;
  const scored = photos
    .filter((photo) => photo.kind === "detail")
    .map((photo) => ({
      photo,
      score:
        labelSimilarity(query, photo.label ?? "") +
        (detail.piecePosition !== null && photo.piecePosition === detail.piecePosition ? 0.25 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const result = scored.filter((entry) => entry.score > 0).map((entry) => entry.photo);
  if (result.length < max) {
    const fronts = viewReferences(
      photos,
      "front",
      3,
      detail.piecePosition ? [detail.piecePosition] : undefined,
    );
    for (const photo of fronts) if (!result.includes(photo)) result.push(photo);
  }
  return result.slice(0, max);
}
