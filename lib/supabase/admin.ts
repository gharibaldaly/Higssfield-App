import "server-only";

import { createClient } from "@supabase/supabase-js";

import { MissingEnvError, serverEnv, supabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Service-role client. Bypasses RLS — only for trusted server paths that have
 * no user session (the Higgsfield webhook). Always filter by owner_id.
 */
export function createSupabaseAdminClient(): TypedSupabaseClient {
  const { url } = supabaseEnv();
  const serviceRoleKey = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new MissingEnvError(["SUPABASE_SERVICE_ROLE_KEY"]);
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
