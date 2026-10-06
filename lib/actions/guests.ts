"use server";

import { revalidatePath } from "next/cache";

import { addGuest, guestEmailSchema, revokeGuest } from "@/lib/auth/guests";
import { requireOwnerForAction } from "@/lib/auth/owner";
import { AppError, fail, ok, type ActionResult } from "@/lib/errors";

function parseEmail(input: unknown): string {
  const parsed = guestEmailSchema.safeParse(input);
  if (!parsed.success) throw new AppError("validation", "Enter a valid email address.");
  return parsed.data;
}

/** Lists an email as a guest (Generate only), or restores a revoked one. Owner only. */
export async function addGuestAction(email: unknown): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const address = parseEmail(email);
    if (address === (user.email ?? "").toLowerCase()) {
      throw new AppError("validation", "The owner's own email cannot be a guest.");
    }
    await addGuest(supabase, address);
    revalidatePath("/settings");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

/** Revokes a guest's access; their history stays. Owner only. */
export async function revokeGuestAction(email: unknown): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await revokeGuest(supabase, parseEmail(email));
    revalidatePath("/settings");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}
