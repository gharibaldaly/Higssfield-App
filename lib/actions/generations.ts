"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import type { FidelityReview } from "@/lib/domain/fidelity";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { reviewGenerationFidelity } from "@/lib/generations/fidelity";

const idSchema = z.uuid();

export async function checkFidelity(generationId: string): Promise<ActionResult<FidelityReview>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    return ok(await reviewGenerationFidelity(supabase, user.id, idSchema.parse(generationId)));
  } catch (error) {
    return fail(error);
  }
}

export async function setGenerationFavorite(
  generationId: string,
  isFavorite: boolean,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    const { error } = await supabase
      .from("generations")
      .update({ is_favorite: isFavorite })
      .eq("id", idSchema.parse(generationId));
    if (error) throw error;
    revalidatePath("/library");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}
