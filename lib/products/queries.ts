import "server-only";

import { productStage, type ProductStage } from "@/lib/domain/product";
import { AppError } from "@/lib/errors";
import { signPaths } from "@/lib/storage/objects";
import type { ProductPieceRow, ProductRow, SourcePhotoRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export type ProductCardData = {
  id: string;
  name: string;
  productLine: ProductRow["product_line"];
  pieceCount: number;
  pieceNames: string[];
  coverUrl: string | null;
  photoCount: number;
  stage: ProductStage;
  isFavorite: boolean;
  hasSheet: boolean;
  colorwayCount: number;
  createdAt: string;
};

export async function listProductCards(supabase: TypedSupabaseClient): Promise<ProductCardData[]> {
  const [products, pieces, photos, dna, colorways] = await Promise.all([
    supabase
      .from("products")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("product_pieces").select("product_id, name, position").order("position"),
    supabase
      .from("source_photos")
      .select("product_id, kind, storage_path, position")
      .order("position"),
    supabase.from("garment_dna").select("product_id"),
    supabase.from("colorways").select("product_id"),
  ]);
  if (products.error)
    throw new AppError("unknown", "Could not load products.", { detail: products.error.message });

  const covers = new Map<string, string>();
  const photoCounts = new Map<string, number>();
  for (const photo of photos.data ?? []) {
    photoCounts.set(photo.product_id, (photoCounts.get(photo.product_id) ?? 0) + 1);
    if (photo.kind === "front" && !covers.has(photo.product_id))
      covers.set(photo.product_id, photo.storage_path);
  }
  for (const photo of photos.data ?? []) {
    if (!covers.has(photo.product_id)) covers.set(photo.product_id, photo.storage_path);
  }
  const signed = await signPaths(supabase, [...covers.values()]);
  const dnaProducts = new Set((dna.data ?? []).map((row) => row.product_id));
  const colorwayCounts = new Map<string, number>();
  for (const row of colorways.data ?? []) {
    colorwayCounts.set(row.product_id, (colorwayCounts.get(row.product_id) ?? 0) + 1);
  }

  return (products.data ?? []).map((product) => {
    const cover = covers.get(product.id);
    return {
      id: product.id,
      name: product.name,
      productLine: product.product_line,
      pieceCount: product.piece_count,
      pieceNames: (pieces.data ?? [])
        .filter((piece) => piece.product_id === product.id)
        .map((piece) => piece.name),
      coverUrl: cover ? (signed.get(cover) ?? null) : null,
      photoCount: photoCounts.get(product.id) ?? 0,
      stage: productStage({
        photoCount: photoCounts.get(product.id) ?? 0,
        hasDna: dnaProducts.has(product.id),
        approvedDnaId: product.approved_dna_id,
        approvedSheetId: product.approved_sheet_id,
      }),
      isFavorite: product.is_favorite,
      hasSheet: Boolean(product.approved_sheet_id),
      colorwayCount: colorwayCounts.get(product.id) ?? 0,
      createdAt: product.created_at,
    };
  });
}

export type PhotoView = {
  id: string;
  pieceId: string;
  kind: SourcePhotoRow["kind"];
  label: string | null;
  url: string | null;
  storagePath: string;
  width: number | null;
  height: number | null;
};

export type ProductIntake = {
  product: ProductRow;
  pieces: ProductPieceRow[];
  photos: PhotoView[];
  latestDna: { id: string; version: number; status: string } | null;
  colorwayCount: number;
  sheetStatus: string | null;
};

export async function loadProductIntake(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<ProductIntake | null> {
  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return null;
  const [pieces, photos, dna, colorways, sheet] = await Promise.all([
    supabase.from("product_pieces").select("*").eq("product_id", productId).order("position"),
    supabase
      .from("source_photos")
      .select("*")
      .eq("product_id", productId)
      .order("position")
      .order("created_at"),
    supabase
      .from("garment_dna")
      .select("id, version, status")
      .eq("product_id", productId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("colorways")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId),
    supabase
      .from("product_sheets")
      .select("status")
      .eq("product_id", productId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const signed = await signPaths(
    supabase,
    (photos.data ?? []).map((photo) => photo.storage_path),
  );
  return {
    product,
    pieces: pieces.data ?? [],
    photos: (photos.data ?? []).map((photo) => ({
      id: photo.id,
      pieceId: photo.piece_id,
      kind: photo.kind,
      label: photo.label,
      url: signed.get(photo.storage_path) ?? null,
      storagePath: photo.storage_path,
      width: photo.width,
      height: photo.height,
    })),
    latestDna: dna.data ?? null,
    colorwayCount: colorways.count ?? 0,
    sheetStatus: sheet.data?.status ?? null,
  };
}
