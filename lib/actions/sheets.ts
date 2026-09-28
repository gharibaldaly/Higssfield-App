"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { approveSheet, buildSheet, recropSheet, updateSheetSources } from "@/lib/sheet/service";

const buildSchema = z.object({
  productId: z.uuid(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export async function buildSheetAction(input: unknown): Promise<ActionResult<{ sheetId: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = buildSchema.parse(input);
    const sheet = await buildSheet(supabase, user.id, parsed.productId, {
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

const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const sourcesSchema = z.object({
  productId: z.uuid(),
  sheetId: z.uuid(),
  cards: z
    .array(
      z.object({
        cardId: z.string().min(1).max(40),
        path: z.string().min(1).max(500),
        box: rectSchema,
      }),
    )
    .min(1)
    .max(20),
});

/** The owner's photo and box for each card of a sheet built from photos. */
export async function updateSheetSourcesAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = sourcesSchema.parse(input);
    await updateSheetSources(supabase, user.id, parsed.sheetId, parsed.cards);
    revalidatePath(`/products/${parsed.productId}/sheet`);
    return ok(null);
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
        rect: rectSchema,
      }),
    )
    .min(1)
    .max(20),
});

/** New boxes on a sheet an image model drew (sheets from before photo-built sheets). */
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
