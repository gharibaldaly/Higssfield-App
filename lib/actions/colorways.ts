"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import {
  addColorway,
  colorwayInputSchema,
  deleteColorway,
  renameColorway,
} from "@/lib/colorways/service";
import { fail, ok, type ActionResult } from "@/lib/errors";

export async function addColorwayAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = colorwayInputSchema.parse(input);
    const row = await addColorway(supabase, user.id, parsed);
    revalidatePath(`/products/${parsed.productId}/colorways`);
    return ok({ id: row.id });
  } catch (error) {
    return fail(error);
  }
}

const updateSchema = z.object({
  colorwayId: z.uuid(),
  productId: z.uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  hex: z.string().optional(),
});

export async function updateColorwayAction(input: unknown): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    const parsed = updateSchema.parse(input);
    await renameColorway(supabase, parsed.colorwayId, { name: parsed.name, hex: parsed.hex });
    revalidatePath(`/products/${parsed.productId}/colorways`);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function deleteColorwayAction(
  colorwayId: string,
  productId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await deleteColorway(supabase, z.uuid().parse(colorwayId));
    revalidatePath(`/products/${productId}/colorways`);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}
