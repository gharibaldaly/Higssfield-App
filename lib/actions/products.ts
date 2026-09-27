"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import {
  createProductSchema,
  registerPhotoSchema,
  updateProductSchema,
  PHOTO_KINDS,
} from "@/lib/domain/product";
import { fail, ok, type ActionResult } from "@/lib/errors";
import {
  createProduct,
  deletePhoto,
  deleteProduct,
  registerPhoto,
  setProductFavorite,
  updatePhoto,
  updateProduct,
} from "@/lib/products/service";

export async function createProductAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase } = await requireOwnerForAction();
    const product = await createProduct(supabase, createProductSchema.parse(input));
    revalidatePath("/products");
    return ok({ id: product.id });
  } catch (error) {
    return fail(error);
  }
}

export async function updateProductAction(input: unknown): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    const parsed = updateProductSchema.parse(input);
    await updateProduct(supabase, parsed);
    revalidatePath(`/products/${parsed.productId}`);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function deleteProductAction(productId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await deleteProduct(supabase, z.uuid().parse(productId));
    revalidatePath("/products");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function setProductFavoriteAction(
  productId: string,
  value: boolean,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await setProductFavorite(supabase, z.uuid().parse(productId), value);
    revalidatePath("/products");
    revalidatePath("/library");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

/** Called after the browser uploaded the file straight to Supabase Storage. */
export async function registerPhotoAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = registerPhotoSchema.parse(input);
    const photo = await registerPhoto(supabase, user.id, parsed);
    revalidatePath(`/products/${parsed.productId}`);
    return ok({ id: photo.id });
  } catch (error) {
    return fail(error);
  }
}

const updatePhotoSchema = z.object({
  photoId: z.uuid(),
  productId: z.uuid(),
  kind: z.enum(PHOTO_KINDS).optional(),
  label: z.string().trim().max(200).nullable().optional(),
});

export async function updatePhotoAction(input: unknown): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    const parsed = updatePhotoSchema.parse(input);
    await updatePhoto(supabase, parsed.photoId, {
      ...(parsed.kind ? { kind: parsed.kind } : {}),
      ...(parsed.label !== undefined ? { label: parsed.label || null } : {}),
    });
    revalidatePath(`/products/${parsed.productId}`);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function deletePhotoAction(photoId: string, productId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await deletePhoto(supabase, z.uuid().parse(photoId));
    revalidatePath(`/products/${productId}`);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}
