import "server-only";

import type { CreateProductInput, RegisterPhotoInput } from "@/lib/domain/product";
import { AppError } from "@/lib/errors";
import { removeObjects } from "@/lib/storage/objects";
import { isOwnedPath } from "@/lib/storage/paths";
import type { ProductPieceRow, ProductRow, SourcePhotoRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export async function createProduct(
  supabase: TypedSupabaseClient,
  input: CreateProductInput,
): Promise<ProductRow> {
  const { data: product, error } = await supabase
    .from("products")
    .insert({
      name: input.name,
      product_line: input.productLine,
      piece_count: input.pieceCount,
      sku: input.sku || null,
      notes: input.notes || null,
    })
    .select("*")
    .single();
  if (error || !product)
    throw new AppError("unknown", "Could not create the product.", { detail: error?.message });

  const { error: piecesError } = await supabase.from("product_pieces").insert(
    input.pieceNames.map((name, index) => ({
      product_id: product.id,
      position: index + 1,
      name,
    })),
  );
  if (piecesError) {
    await supabase.from("products").delete().eq("id", product.id);
    throw new AppError("unknown", "Could not create the product pieces.", {
      detail: piecesError.message,
    });
  }
  return product;
}

export async function updateProduct(
  supabase: TypedSupabaseClient,
  input: {
    productId: string;
    name: string;
    productLine: ProductRow["product_line"];
    sku?: string;
    notes?: string;
    pieces: { id: string; name: string }[];
  },
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({
      name: input.name,
      product_line: input.productLine,
      sku: input.sku || null,
      notes: input.notes || null,
    })
    .eq("id", input.productId);
  if (error)
    throw new AppError("unknown", "Could not save the product.", { detail: error.message });
  for (const piece of input.pieces) {
    const { error: pieceError } = await supabase
      .from("product_pieces")
      .update({ name: piece.name })
      .eq("id", piece.id)
      .eq("product_id", input.productId);
    if (pieceError)
      throw new AppError("unknown", "Could not rename a piece.", { detail: pieceError.message });
  }
}

export async function getProduct(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<ProductRow> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error)
    throw new AppError("unknown", "Could not load the product.", { detail: error.message });
  if (!data) throw new AppError("not_found", "Product not found.");
  return data;
}

export async function getPieces(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<ProductPieceRow[]> {
  const { data, error } = await supabase
    .from("product_pieces")
    .select("*")
    .eq("product_id", productId)
    .order("position");
  if (error) throw new AppError("unknown", "Could not load the pieces.", { detail: error.message });
  return data ?? [];
}

export async function getPhotos(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<SourcePhotoRow[]> {
  const { data, error } = await supabase
    .from("source_photos")
    .select("*")
    .eq("product_id", productId)
    .order("position")
    .order("created_at");
  if (error) throw new AppError("unknown", "Could not load the photos.", { detail: error.message });
  return data ?? [];
}

export async function registerPhoto(
  supabase: TypedSupabaseClient,
  ownerId: string,
  input: RegisterPhotoInput,
): Promise<SourcePhotoRow> {
  const expectedPrefix = `${ownerId}/products/${input.productId}/sources/`;
  if (!isOwnedPath(input.storagePath, ownerId) || !input.storagePath.startsWith(expectedPrefix)) {
    throw new AppError("validation", "Invalid upload path.");
  }
  const { count } = await supabase
    .from("source_photos")
    .select("id", { count: "exact", head: true })
    .eq("piece_id", input.pieceId);
  const { data, error } = await supabase
    .from("source_photos")
    .insert({
      product_id: input.productId,
      piece_id: input.pieceId,
      kind: input.kind,
      label: input.label || null,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      width: input.width ?? null,
      height: input.height ?? null,
      size_bytes: input.sizeBytes ?? null,
      position: count ?? 0,
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not save the photo.", { detail: error?.message });
  return data;
}

export async function updatePhoto(
  supabase: TypedSupabaseClient,
  photoId: string,
  patch: { kind?: SourcePhotoRow["kind"]; label?: string | null },
): Promise<void> {
  const { error } = await supabase.from("source_photos").update(patch).eq("id", photoId);
  if (error)
    throw new AppError("unknown", "Could not update the photo.", { detail: error.message });
}

export async function deletePhoto(supabase: TypedSupabaseClient, photoId: string): Promise<void> {
  const { data: photo } = await supabase
    .from("source_photos")
    .select("storage_path")
    .eq("id", photoId)
    .maybeSingle();
  const { error } = await supabase.from("source_photos").delete().eq("id", photoId);
  if (error)
    throw new AppError("unknown", "Could not delete the photo.", { detail: error.message });
  if (photo) await removeObjects(supabase, [photo.storage_path]);
}

/** Deletes a product, its rows (cascade) and every file it owns. */
export async function deleteProduct(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<void> {
  const [photos, colorways, crops, generations] = await Promise.all([
    supabase.from("source_photos").select("storage_path").eq("product_id", productId),
    supabase.from("colorways").select("swatch_path, sample_image_path").eq("product_id", productId),
    supabase.from("reference_crops").select("storage_path").eq("product_id", productId),
    supabase.from("generations").select("storage_path").eq("product_id", productId),
  ]);
  const photoPaths = (photos.data ?? []).map((row) => row.storage_path);
  const paths = [
    ...photoPaths,
    ...(colorways.data ?? [])
      .flatMap((row) => [row.swatch_path, row.sample_image_path])
      .filter((path): path is string => Boolean(path) && !photoPaths.includes(path!)),
    ...(crops.data ?? []).map((row) => row.storage_path),
    ...(generations.data ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => Boolean(path)),
  ];
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error)
    throw new AppError("unknown", "Could not delete the product.", { detail: error.message });
  await removeObjects(supabase, paths);
}

export async function setProductFavorite(
  supabase: TypedSupabaseClient,
  productId: string,
  isFavorite: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({ is_favorite: isFavorite })
    .eq("id", productId);
  if (error)
    throw new AppError("unknown", "Could not update the product.", { detail: error.message });
}

export function photoCaption(photo: SourcePhotoRow, piece: ProductPieceRow | undefined): string {
  const pieceLabel = piece ? `Piece ${piece.position} "${piece.name}"` : "Product";
  const label = photo.label ? ` — ${photo.label}` : "";
  return `${pieceLabel} — ${photo.kind}${label}`;
}
