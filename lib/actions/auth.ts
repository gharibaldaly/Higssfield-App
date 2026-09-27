"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getOwner, isAllowedOwner } from "@/lib/auth/owner";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(128);

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "same" | "weak" | "reauth" | "session" | "unknown" };

/** Lets the owner replace the temporary password created during setup. */
export async function changePasswordAction(password: unknown): Promise<ChangePasswordResult> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const owner = await getOwner();
  if (!owner) return { ok: false, reason: "session" };
  const { error } = await owner.supabase.auth.updateUser({ password: parsed.data });
  if (!error) return { ok: true };
  if (error.code === "same_password") return { ok: false, reason: "same" };
  if (error.code === "weak_password") return { ok: false, reason: "weak" };
  if (error.code === "reauthentication_needed") return { ok: false, reason: "reauth" };
  console.error("Password change failed", error.code, error.message);
  return { ok: false, reason: "unknown" };
}

export type SignInState = { error: "invalid" | "not_owner" | "config" | null };

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { error: "config" };
  }
  if (!isAllowedOwner(parsed.data.email)) return { error: "not_owner" };
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "invalid" };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
