import "server-only";

import { toGenerationView, type GenerationView } from "@/lib/domain/generation";
import { AppError } from "@/lib/errors";
import { signPaths } from "@/lib/storage/objects";
import type { GenerationRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** Latest owner-approved catalogue image of a view for a product, if any. */
export async function approvedCatalogueImage(
  supabase: TypedSupabaseClient,
  productId: string,
  purpose: "ghost_front" | "ghost_back",
): Promise<GenerationRow | null> {
  const { data } = await supabase
    .from("generations")
    .select("*")
    .eq("product_id", productId)
    .eq("purpose", purpose)
    .eq("review_status", "approved")
    .not("storage_path", "is", null)
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getGeneration(
  supabase: TypedSupabaseClient,
  id: string,
): Promise<GenerationRow> {
  const { data, error } = await supabase.from("generations").select("*").eq("id", id).maybeSingle();
  if (error)
    throw new AppError("unknown", "Could not load the generation.", { detail: error.message });
  if (!data) throw new AppError("not_found", "Generation not found.");
  return data;
}

/** Client-safe views with fresh signed URLs for finished files. */
export async function toViews(
  supabase: TypedSupabaseClient,
  rows: GenerationRow[],
): Promise<GenerationView[]> {
  const urls = await signPaths(
    supabase,
    rows.map((row) => row.storage_path),
  );
  return rows.map((row) =>
    toGenerationView(row, row.storage_path ? (urls.get(row.storage_path) ?? null) : null),
  );
}

/** Insert a failed generation row (e.g. missing reference) so the UI can show why. */
export async function recordFailedGeneration(
  supabase: TypedSupabaseClient,
  row: Pick<GenerationRow, "model_id" | "endpoint" | "kind" | "purpose" | "prompt" | "provider"> &
    Partial<
      Pick<
        GenerationRow,
        | "product_id"
        | "catalogue_job_id"
        | "slot"
        | "colorway_id"
        | "shot_id"
        | "ad_project_id"
        | "sheet_id"
        | "note"
        | "parent_id"
        | "params"
      >
    >,
  error: string,
): Promise<GenerationRow> {
  const { data, error: insertError } = await supabase
    .from("generations")
    .insert({ ...row, status: "failed", error, completed_at: new Date().toISOString() })
    .select("*")
    .single();
  if (insertError || !data) {
    throw new AppError("unknown", "Could not record the failed generation.", {
      detail: insertError?.message,
    });
  }
  return data;
}
