import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { serverEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient, type TypedSupabaseClient } from "@/lib/supabase/server";

export type OwnerContext = {
  supabase: TypedSupabaseClient;
  user: { id: string; email: string | null };
};

function isAllowedOwner(email: string | null | undefined): boolean {
  const owner = serverEnv().APP_OWNER_EMAIL?.toLowerCase();
  if (!owner) return true;
  return (email ?? "").toLowerCase() === owner;
}

/** Signed-in owner for this request (verified with Supabase Auth), or null. */
export const getOwner = cache(async (): Promise<OwnerContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isAllowedOwner(data.user.email)) return null;
  return { supabase, user: { id: data.user.id, email: data.user.email ?? null } };
});

/** For pages and layouts: redirect to /login when not signed in as the owner. */
export async function requireOwner(): Promise<OwnerContext> {
  const owner = await getOwner();
  if (!owner) redirect("/login");
  return owner;
}

/** For Server Actions and Route Handlers: throw an auth AppError instead. */
export async function requireOwnerForAction(): Promise<OwnerContext> {
  const owner = await getOwner();
  if (!owner) {
    throw new AppError("auth", "Your session has ended. Sign in again.");
  }
  return owner;
}

export { isAllowedOwner };
