"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { approveSheet, generateSheet, recropSheet } from "@/lib/sheet/service";

const generateSchema = z.object({
  productId: z.uuid(),
  modelId: z.string().max(200).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export async function generateSheetAction(
  input: unknown,
): Promise<ActionResult<{ sheetId: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = generateSchema.parse(input);
    const sheet = await generateSheet(supabase, user.id, parsed.productId, {
      modelId: parsed.modelId,
      note: parsed.note || null,
    });
    revalidatePath(`/products/${parsed.productId}/sheet`);
    return ok({ sheetId: sheet.id });
  } catch (error) {
    return fail(error);
  }
}

export async function approveSheetAction(
  productId: string,
  sheetId: string,
): Promise<ActionResult<{ crops: number }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const crops = await approveSheet(supabase, user.id, z.uuid().parse(sheetId));
    revalidatePath(`/products/${productId}/sheet`);
    revalidatePath(`/products/${productId}`);
    return ok({ crops: crops.length });
  } catch (error) {
    return fail(error);
  }
}

const recropSchema = z.object({
  productId: z.uuid(),
  sheetId: z.uuid(),
  boxes: z
    .array(
      z.object({
        cardId: z.string().min(1).max(40),
        rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
      }),
    )
    .min(1)
    .max(20),
});

export async function recropSheetAction(input: unknown): Promise<ActionResult<{ crops: number }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = recropSchema.parse(input);
    const crops = await recropSheet(supabase, user.id, parsed.sheetId, parsed.boxes);
    revalidatePath(`/products/${parsed.productId}/sheet`);
    return ok({ crops: crops.length });
  } catch (error) {
    return fail(error);
  }
}
