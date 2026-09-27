"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { createGhostBatchSchema, registerItemPhotosSchema } from "@/lib/ghost-batches/schemas";
import {
  createGhostBatch,
  deleteGhostBatch,
  registerBatchItemPhotos,
  removeBatchItem,
  renameBatch,
  requestBatchColours,
  retryBatchItem,
  setBatchStatus,
} from "@/lib/ghost-batches/service";
import { signPaths } from "@/lib/storage/objects";

export async function createGhostBatchAction(
  input: unknown,
): Promise<ActionResult<{ batchId: string; items: { itemId: string; productId: string }[] }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const result = await createGhostBatch(supabase, user.id, createGhostBatchSchema.parse(input));
    revalidatePath("/ghost");
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}

export async function registerBatchItemPhotosAction(
  input: unknown,
): Promise<ActionResult<{ phase: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const item = await registerBatchItemPhotos(
      supabase,
      user.id,
      registerItemPhotosSchema.parse(input),
    );
    return ok({ phase: item.phase });
  } catch (error) {
    return fail(error);
  }
}

export async function setBatchStatusAction(
  batchId: string,
  status: "running" | "paused",
): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await setBatchStatus(
      supabase,
      z.uuid().parse(batchId),
      z.enum(["running", "paused"]).parse(status),
    );
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function renameBatchAction(batchId: string, name: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await renameBatch(supabase, z.uuid().parse(batchId), name);
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function requestBatchColoursAction(batchId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await requestBatchColours(supabase, z.uuid().parse(batchId));
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function retryBatchItemAction(itemId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await retryBatchItem(supabase, z.uuid().parse(itemId));
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function removeBatchItemAction(itemId: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    await removeBatchItem(supabase, user.id, z.uuid().parse(itemId));
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function deleteGhostBatchAction(
  batchId: string,
  deleteModels: boolean,
): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    await deleteGhostBatch(
      supabase,
      user.id,
      z.uuid().parse(batchId),
      z.boolean().parse(deleteModels),
    );
    revalidatePath("/ghost");
    revalidatePath("/products");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

/** A model's photos with short-lived URLs, for picking a colour with the eyedropper. */
export async function batchItemPhotosAction(
  productId: string,
): Promise<ActionResult<{ id: string; url: string | null; storagePath: string; label: string }[]>> {
  try {
    const { supabase } = await requireOwnerForAction();
    const { data } = await supabase
      .from("source_photos")
      .select("id, kind, label, storage_path")
      .eq("product_id", z.uuid().parse(productId))
      .order("position");
    const photos = data ?? [];
    const urls = await signPaths(
      supabase,
      photos.map((photo) => photo.storage_path),
    );
    return ok(
      photos.map((photo) => ({
        id: photo.id,
        url: urls.get(photo.storage_path) ?? null,
        storagePath: photo.storage_path,
        label: photo.label ?? photo.kind,
      })),
    );
  } catch (error) {
    return fail(error);
  }
}
