import "server-only";

import { z } from "zod";

import {
  parseItemMeta,
  type CreateGhostBatchInput,
  type RegisterItemPhotosInput,
} from "@/lib/ghost-batches/schemas";
import { AppError } from "@/lib/errors";
import { ownerRegistry, resolveModel } from "@/lib/generations/models";
import { sampleSwatchColour } from "@/lib/images/process";
import { deleteProduct } from "@/lib/products/service";
import { getOwnerSettings } from "@/lib/settings/service";
import { downloadObject, removeFolderFiles } from "@/lib/storage/objects";
import { isOwnedPath } from "@/lib/storage/paths";
import type { GhostBatchItemRow, GhostBatchRow, Json } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export async function getBatch(
  supabase: TypedSupabaseClient,
  batchId: string,
): Promise<GhostBatchRow> {
  const { data, error } = await supabase
    .from("ghost_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new AppError("unknown", "Could not load the batch.", { detail: error.message });
  if (!data) throw new AppError("not_found", "Batch not found.");
  return data;
}

async function getItem(supabase: TypedSupabaseClient, itemId: string): Promise<GhostBatchItemRow> {
  const { data, error } = await supabase
    .from("ghost_batch_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new AppError("unknown", "Could not load the model.", { detail: error.message });
  if (!data) throw new AppError("not_found", "Model not found in this batch.");
  return data;
}

/**
 * Starts a batch (or adds models to one): every model becomes a one-piece
 * product, so the DNA, colourway and catalogue pipeline runs unchanged.
 * Photos are uploaded by the browser afterwards, straight to Storage.
 */
export async function createGhostBatch(
  supabase: TypedSupabaseClient,
  ownerId: string,
  input: CreateGhostBatchInput,
): Promise<{
  batchId: string;
  items: { itemId: string; productId: string }[];
}> {
  let batch: GhostBatchRow;
  if (input.batchId) {
    batch = await getBatch(supabase, input.batchId);
  } else {
    const settings = await getOwnerSettings(supabase, ownerId);
    const { model } = resolveModel(await ownerRegistry(settings), {
      kind: "image",
      preferredModes: ["image-to-image", "text-to-image"],
      requestedId: input.modelId,
    });
    const { data, error } = await supabase
      .from("ghost_batches")
      .insert({
        name: input.name,
        model_id: model.id,
        style: settings.catalogueStyle as unknown as Json,
        options: input.options as unknown as Json,
      })
      .select("*")
      .single();
    if (error || !data)
      throw new AppError("unknown", "Could not start the batch.", { detail: error?.message });
    batch = data;
  }

  const { count } = await supabase
    .from("ghost_batch_items")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batch.id);
  const models = input.models.map((model) => ({
    ...model,
    productId: crypto.randomUUID(),
    itemId: crypto.randomUUID(),
  }));

  const { error: productsError } = await supabase.from("products").insert(
    models.map((model) => ({
      id: model.productId,
      name: model.name,
      product_line: model.productLine,
      piece_count: 1,
    })),
  );
  if (productsError) {
    throw new AppError("unknown", "Could not create the models.", {
      detail: productsError.message,
    });
  }
  const productIds = models.map((model) => model.productId);
  const cleanUp = async () => {
    await supabase.from("products").delete().in("id", productIds);
  };
  const { error: piecesError } = await supabase.from("product_pieces").insert(
    models.map((model) => ({
      product_id: model.productId,
      position: 1,
      name: model.name.slice(0, 120),
    })),
  );
  if (piecesError) {
    await cleanUp();
    throw new AppError("unknown", "Could not create the models.", { detail: piecesError.message });
  }
  const { error: itemsError } = await supabase.from("ghost_batch_items").insert(
    models.map((model, index) => ({
      id: model.itemId,
      batch_id: batch.id,
      product_id: model.productId,
      position: (count ?? 0) + index,
    })),
  );
  if (itemsError) {
    await cleanUp();
    throw new AppError("unknown", "Could not add the models to the batch.", {
      detail: itemsError.message,
    });
  }
  if (input.batchId && batch.status !== "running") {
    await supabase.from("ghost_batches").update({ status: "running" }).eq("id", batch.id);
  }
  return {
    batchId: batch.id,
    items: models.map((model) => ({ itemId: model.itemId, productId: model.productId })),
  };
}

/**
 * Records a model's uploaded photos and colour swatches, then hands the model
 * to the runner. Swatch colours are read from the centre of each swatch photo.
 */
export async function registerBatchItemPhotos(
  supabase: TypedSupabaseClient,
  ownerId: string,
  input: RegisterItemPhotosInput,
): Promise<GhostBatchItemRow> {
  const item = await getItem(supabase, input.itemId);
  if (item.phase !== "uploading" && item.phase !== "failed") {
    throw new AppError("validation", "This model's photos are already registered.");
  }
  const { data: piece } = await supabase
    .from("product_pieces")
    .select("id")
    .eq("product_id", item.product_id)
    .eq("position", 1)
    .maybeSingle();
  if (!piece) throw new AppError("not_found", "The model's garment record is missing.");

  const sourcePrefix = `${ownerId}/products/${item.product_id}/sources/`;
  const swatchPrefix = `${ownerId}/products/${item.product_id}/swatches/`;
  const valid = (path: string, prefix: string) =>
    isOwnedPath(path, ownerId) && path.startsWith(prefix);
  if (
    !input.photos.every((photo) => valid(photo.storagePath, sourcePrefix)) ||
    !input.swatches.every((swatch) => valid(swatch.storagePath, swatchPrefix))
  ) {
    throw new AppError("validation", "Invalid upload path.");
  }

  const { count: existing } = await supabase
    .from("source_photos")
    .select("id", { count: "exact", head: true })
    .eq("product_id", item.product_id);
  const photos = input.photos.map((photo, index) => ({ ...photo, id: crypto.randomUUID(), index }));
  if (photos.length > 0) {
    const { error } = await supabase.from("source_photos").insert(
      photos.map((photo) => ({
        id: photo.id,
        product_id: item.product_id,
        piece_id: piece.id,
        kind: photo.kind,
        storage_path: photo.storagePath,
        mime_type: photo.mimeType,
        width: photo.width ?? null,
        height: photo.height ?? null,
        size_bytes: photo.sizeBytes ?? null,
        position: (existing ?? 0) + photo.index,
      })),
    );
    if (error)
      throw new AppError("unknown", "Could not save the photos.", { detail: error.message });
  }

  const { count: colours } = await supabase
    .from("colorways")
    .select("id", { count: "exact", head: true })
    .eq("product_id", item.product_id);
  for (const [index, swatch] of input.swatches.entries()) {
    let hex = "#808080";
    try {
      hex = await sampleSwatchColour(await downloadObject(supabase, swatch.storagePath));
    } catch (error) {
      console.error("Swatch colour could not be read", swatch.storagePath, error);
    }
    await supabase.from("colorways").insert({
      product_id: item.product_id,
      name: swatch.name,
      hex,
      source: "swatch",
      swatch_path: swatch.storagePath,
      position: (colours ?? 0) + index,
    });
  }

  const { count: total } = await supabase
    .from("source_photos")
    .select("id", { count: "exact", head: true })
    .eq("product_id", item.product_id);
  const meta = parseItemMeta(item.meta);
  const autoTagged = [
    ...meta.autoTagged,
    ...photos.filter((photo) => photo.tagSource === "order").map((photo) => photo.id),
  ];
  const { data, error } = await supabase
    .from("ghost_batch_items")
    .update({
      phase: (total ?? 0) > 0 ? "pending" : "failed",
      error: (total ?? 0) > 0 ? null : "No garment photos were uploaded for this model.",
      meta: {
        ...meta,
        autoTagged,
        classified: false,
        failedUploads: meta.failedUploads + input.failedUploads,
      } as unknown as Json,
    })
    .eq("id", item.id)
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not update the model.", { detail: error?.message });
  return data;
}

export async function setBatchStatus(
  supabase: TypedSupabaseClient,
  batchId: string,
  status: GhostBatchRow["status"],
): Promise<void> {
  const { error } = await supabase.from("ghost_batches").update({ status }).eq("id", batchId);
  if (error)
    throw new AppError("unknown", "Could not update the batch.", { detail: error.message });
}

export async function renameBatch(
  supabase: TypedSupabaseClient,
  batchId: string,
  name: string,
): Promise<void> {
  const parsed = z.string().trim().min(1).max(160).parse(name);
  const { error } = await supabase.from("ghost_batches").update({ name: parsed }).eq("id", batchId);
  if (error)
    throw new AppError("unknown", "Could not rename the batch.", { detail: error.message });
}

/** Opens the colour stage: every model with an approved front gets its colours rendered. */
export async function requestBatchColours(
  supabase: TypedSupabaseClient,
  batchId: string,
): Promise<void> {
  const batch = await getBatch(supabase, batchId);
  const { error } = await supabase
    .from("ghost_batches")
    .update({
      colours_requested_at: batch.colours_requested_at ?? new Date().toISOString(),
      status: "running",
    })
    .eq("id", batchId);
  if (error)
    throw new AppError("unknown", "Could not start the colours.", { detail: error.message });
}

/**
 * Puts a stuck or failed model back in line: interrupted uploads continue with
 * the photos that arrived, failed analyses run again, failed jobs are requeued.
 */
export async function retryBatchItem(supabase: TypedSupabaseClient, itemId: string): Promise<void> {
  const item = await getItem(supabase, itemId);
  const meta = parseItemMeta(item.meta);
  const { count: photos } = await supabase
    .from("source_photos")
    .select("id", { count: "exact", head: true })
    .eq("product_id", item.product_id);
  if ((photos ?? 0) === 0) {
    throw new AppError("validation", "Add at least one photo of this model first.");
  }
  const { data: product } = await supabase
    .from("products")
    .select("approved_dna_id")
    .eq("id", item.product_id)
    .maybeSingle();
  if (product?.approved_dna_id) {
    await supabase
      .from("catalogue_jobs")
      .update({ status: "queued", error: null, finished_at: null })
      .eq("batch_id", item.batch_id)
      .eq("product_id", item.product_id)
      .in("status", ["failed", "canceled"]);
  }
  const phase: GhostBatchItemRow["phase"] = product?.approved_dna_id ? "generating" : "pending";
  const { error } = await supabase
    .from("ghost_batch_items")
    .update({
      phase,
      error: null,
      claimed_at: null,
      meta: { ...meta, attempts: 0 } as unknown as Json,
    })
    .eq("id", item.id);
  if (error) throw new AppError("unknown", "Could not retry the model.", { detail: error.message });
  await supabase.from("ghost_batches").update({ status: "running" }).eq("id", item.batch_id);
}

/** Deletes a model's product with everything it owns, uploads that never got a row included. */
async function deleteModel(
  supabase: TypedSupabaseClient,
  ownerId: string,
  productId: string,
): Promise<void> {
  await deleteProduct(supabase, productId);
  for (const folder of ["sources", "swatches"]) {
    await removeFolderFiles(supabase, `${ownerId}/products/${productId}/${folder}`);
  }
}

/** Removes a model from its batch together with its product, photos and images. */
export async function removeBatchItem(
  supabase: TypedSupabaseClient,
  ownerId: string,
  itemId: string,
): Promise<void> {
  const item = await getItem(supabase, itemId);
  await deleteModel(supabase, ownerId, item.product_id);
}

/**
 * Deletes a batch. With `deleteModels`, its models' products go too (photos,
 * DNA and every generated image); otherwise they stay under Products.
 */
export async function deleteGhostBatch(
  supabase: TypedSupabaseClient,
  ownerId: string,
  batchId: string,
  deleteModels: boolean,
): Promise<void> {
  if (deleteModels) {
    const { data: items } = await supabase
      .from("ghost_batch_items")
      .select("product_id")
      .eq("batch_id", batchId);
    for (const item of items ?? []) await deleteModel(supabase, ownerId, item.product_id);
  }
  const { error } = await supabase.from("ghost_batches").delete().eq("id", batchId);
  if (error)
    throw new AppError("unknown", "Could not delete the batch.", { detail: error.message });
}
