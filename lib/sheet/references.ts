import type { SourcePhotoRow } from "@/lib/supabase/database.types";

export type SheetReference = { path: string; caption: string };

type Photo = Pick<SourcePhotoRow, "kind" | "piece_id" | "storage_path">;

/**
 * The sheet's references, most informative first, so a model that takes only
 * a few (Grok Image 2.0 takes five) still gets every view and the details:
 * one front and one back per piece, then the detail photos, then further
 * angles of the same views. Approved ghost images stand in for the phone
 * photos of their view.
 */
export function orderSheetReferences<P extends Photo>(
  photos: P[],
  caption: (photo: P) => string,
  approved: { front: string | null; back: string | null },
): SheetReference[] {
  const references: SheetReference[] = [];
  const add = (path: string, text: string) => {
    if (!references.some((reference) => reference.path === path)) {
      references.push({ path, caption: text });
    }
  };
  const addPhoto = (photo: P) => add(photo.storage_path, caption(photo));
  const firstPerPiece = (list: P[]) =>
    list.filter(
      (photo, index) => list.findIndex((other) => other.piece_id === photo.piece_id) === index,
    );
  const fronts = approved.front ? [] : photos.filter((photo) => photo.kind === "front");
  const backs = approved.back ? [] : photos.filter((photo) => photo.kind === "back");

  if (approved.front) add(approved.front, "Approved catalogue front view");
  firstPerPiece(fronts).forEach(addPhoto);
  if (approved.back) add(approved.back, "Approved catalogue back view");
  firstPerPiece(backs).forEach(addPhoto);
  photos.filter((photo) => photo.kind === "detail").forEach(addPhoto);
  [...fronts, ...backs].forEach(addPhoto);
  return references;
}
