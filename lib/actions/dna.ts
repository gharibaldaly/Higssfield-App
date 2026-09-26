"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { analyzeProduct, approveDnaVersion, createManualDna, saveDna } from "@/lib/dna/service";
import { fail, ok, type ActionResult } from "@/lib/errors";

const productId = z.uuid();

function revalidateProduct(id: string) {
  revalidatePath(`/products/${id}`);
  revalidatePath(`/products/${id}/dna`);
}

export async function analyzeGarmentAction(
  id: string,
): Promise<ActionResult<{ dnaId: string; provider: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const row = await analyzeProduct(supabase, user.id, productId.parse(id));
    revalidateProduct(id);
    return ok({ dnaId: row.id, provider: row.llm_provider ?? "" });
  } catch (error) {
    return fail(error);
  }
}

export async function createManualDnaAction(id: string): Promise<ActionResult<{ dnaId: string }>> {
  try {
    const { supabase } = await requireOwnerForAction();
    const row = await createManualDna(supabase, productId.parse(id));
    revalidateProduct(id);
    return ok({ dnaId: row.id });
  } catch (error) {
    return fail(error);
  }
}

export async function saveDnaAction(
  id: string,
  dnaId: string,
  value: unknown,
): Promise<ActionResult<{ dnaId: string; version: number }>> {
  try {
    const { supabase } = await requireOwnerForAction();
    const row = await saveDna(supabase, productId.parse(id), z.uuid().parse(dnaId), value);
    revalidateProduct(id);
    return ok({ dnaId: row.id, version: row.version });
  } catch (error) {
    return fail(error);
  }
}

export async function approveDnaAction(id: string, dnaId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await approveDnaVersion(supabase, productId.parse(id), z.uuid().parse(dnaId));
    revalidateProduct(id);
    revalidatePath("/products");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}
