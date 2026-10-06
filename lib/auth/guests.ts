import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** A guest as Settings shows it: the listed email and the account behind it, if created. */
export type GuestAccount = {
  email: string;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** The Supabase Auth user id once the account exists; its folder and rows hang off it. */
  userId: string | null;
  lastSignInAt: string | null;
};

export const guestEmailSchema = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

/** The guest list with each guest's account (owner only; a guest gets an empty list). */
export async function listGuests(supabase: TypedSupabaseClient): Promise<GuestAccount[]> {
  const { data, error } = await supabase.rpc("studio_guest_accounts");
  if (error) {
    // Before the guests migration ran there is no list; Settings then shows none.
    console.warn("studio_guest_accounts() failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    email: row.email,
    note: row.note,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    userId: row.user_id,
    lastSignInAt: row.last_sign_in_at,
  }));
}

/** Guests whose accounts exist, so the owner can open their histories. */
export function guestsWithAccounts(guests: GuestAccount[]): (GuestAccount & { userId: string })[] {
  return guests.filter((guest): guest is GuestAccount & { userId: string } =>
    Boolean(guest.userId),
  );
}

/** Lists an email as a guest, or lifts an earlier revocation of it. */
export async function addGuest(supabase: TypedSupabaseClient, email: string): Promise<void> {
  const { error } = await supabase
    .from("studio_guests")
    .upsert({ email, revoked_at: null }, { onConflict: "email" });
  if (error) {
    throw new AppError("unknown", "Could not add the guest.", { detail: error.message });
  }
}

/**
 * Revokes a guest's access. The row stays (with `revoked_at`), so their
 * history remains readable by the owner and they never count as the owner.
 */
export async function revokeGuest(supabase: TypedSupabaseClient, email: string): Promise<void> {
  const { error } = await supabase
    .from("studio_guests")
    .update({ revoked_at: new Date().toISOString() })
    .eq("email", email);
  if (error) {
    throw new AppError("unknown", "Could not revoke the guest.", { detail: error.message });
  }
}
