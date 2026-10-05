import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { homeFor, parseDatabaseRole, resolveRole, type StudioRole } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient, type TypedSupabaseClient } from "@/lib/supabase/server";

/** A signed-in account: the owner, or a guest allowed into Generate only. */
export type MemberContext = {
  supabase: TypedSupabaseClient;
  user: { id: string; email: string | null };
  role: StudioRole;
};

/** The owner's context; every section but Generate requires it. */
export type OwnerContext = MemberContext & { role: "owner" };

function isAllowedOwner(email: string | null | undefined): boolean {
  const owner = serverEnv().APP_OWNER_EMAIL?.toLowerCase();
  if (!owner) return true;
  return (email ?? "").toLowerCase() === owner;
}

/**
 * Asks the database which role the signed-in account has (`studio_role()`),
 * then applies the `APP_OWNER_EMAIL` lock. Null when the account may not be
 * in the studio at all.
 */
export async function roleOf(
  supabase: TypedSupabaseClient,
  email: string | null | undefined,
): Promise<StudioRole | null> {
  const { data, error } = await supabase.rpc("studio_role");
  if (error) {
    // Before the guests migration ran, the function does not exist: the email
    // lock alone decides, as it did before guests existed.
    console.warn("studio_role() failed", error.message);
  }
  return resolveRole({
    databaseRole: error ? null : parseDatabaseRole(data),
    ownerAllowed: isAllowedOwner(email),
  });
}

/** Signed-in member for this request (verified with Supabase Auth), or null. */
export const getMember = cache(async (): Promise<MemberContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const role = await roleOf(supabase, data.user.email);
  if (!role) return null;
  return { supabase, user: { id: data.user.id, email: data.user.email ?? null }, role };
});

/** Signed-in owner for this request, or null (also null for a guest). */
export const getOwner = cache(async (): Promise<OwnerContext | null> => {
  const member = await getMember();
  return member?.role === "owner" ? { ...member, role: "owner" } : null;
});

/** For pages and layouts open to the owner and guests: redirect to /login when signed out. */
export async function requireMember(): Promise<MemberContext> {
  const member = await getMember();
  if (!member) redirect("/login");
  return member;
}

/**
 * For owner-only pages and layouts: redirect to /login when signed out, and
 * send a guest back to their own home.
 */
export async function requireOwner(): Promise<OwnerContext> {
  const member = await requireMember();
  if (member.role !== "owner") redirect(homeFor(member.role));
  return { ...member, role: "owner" };
}

const SESSION_ENDED = "Your session has ended. Sign in again.";

/** For Server Actions and Route Handlers open to guests: throw an auth AppError instead. */
export async function requireMemberForAction(): Promise<MemberContext> {
  const member = await getMember();
  if (!member) throw new AppError("auth", SESSION_ENDED);
  return member;
}

/** For owner-only Server Actions and Route Handlers: throw an auth AppError instead. */
export async function requireOwnerForAction(): Promise<OwnerContext> {
  const member = await requireMemberForAction();
  if (member.role !== "owner") {
    throw new AppError("auth", "This part of the studio is for its owner.");
  }
  return { ...member, role: "owner" };
}

export { isAllowedOwner };
