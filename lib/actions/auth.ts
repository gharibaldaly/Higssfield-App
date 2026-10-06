"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getMember, roleOf } from "@/lib/auth/owner";
import { homeFor } from "@/lib/auth/roles";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { signInErrorOf, type SignInError } from "@/lib/auth/sign-in-error";
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
  const member = await getMember();
  if (!member) return { ok: false, reason: "session" };
  const { error } = await member.supabase.auth.updateUser({ password: parsed.data });
  if (!error) return { ok: true };
  if (error.code === "same_password") return { ok: false, reason: "same" };
  if (error.code === "weak_password") return { ok: false, reason: "weak" };
  if (error.code === "reauthentication_needed") return { ok: false, reason: "reauth" };
  console.error("Password change failed", error.code, error.message);
  return { ok: false, reason: "unknown" };
}

export type SignInState = {
  error: SignInError | null;
  /** Supabase Auth's own code or message for a refusal the page cannot name. */
  detail?: string | null;
};

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
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Supabase Auth's reason (a rate limit, a CAPTCHA, a disabled provider…),
    // for the page and for the Vercel logs. Never the password.
    const diagnosis = signInErrorOf(error);
    console.error("Sign-in refused", {
      reason: diagnosis.error,
      code: error.code ?? null,
      status: error.status ?? null,
      message: error.message,
    });
    return { error: diagnosis.error, detail: diagnosis.detail };
  }
  // The role comes from the guest list and the APP_OWNER_EMAIL lock, so the
  // account has to be signed in first; one that fits neither is signed out.
  const role = await roleOf(supabase, data.user?.email ?? parsed.data.email);
  if (!role) {
    await supabase.auth.signOut();
    return { error: "not_owner" };
  }
  redirect(homeFor(role));
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
