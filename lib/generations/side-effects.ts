import "server-only";

import { isPendingStatus } from "@/lib/domain/generation";
import type { CatalogueJobRow, GenerationRow, ShotRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** Latest generation per slot (regenerations supersede earlier attempts). */
export function latestBySlot<T extends Pick<GenerationRow, "id" | "slot" | "created_at">>(
  rows: T[],
): Map<string, T> {
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = new Map<string, T>();
  for (const row of sorted) {
    const key = row.slot ?? row.id;
    if (!latest.has(key)) latest.set(key, row);
  }
  return latest;
}

export function catalogueJobStatusFor(
  statuses: GenerationRow["status"][],
): Extract<CatalogueJobRow["status"], "generating" | "review" | "failed"> {
  if (statuses.some(isPendingStatus)) return "generating";
  if (statuses.length > 0 && statuses.every((status) => status !== "completed")) return "failed";
  return "review";
}

async function settleCatalogueJob(supabase: TypedSupabaseClient, jobId: string): Promise<void> {
  const { data: job } = await supabase
    .from("catalogue_jobs")
    .select("id, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.status === "approved" || job.status === "canceled") return;
  const { data: generations } = await supabase
    .from("generations")
    .select("id, slot, status, created_at")
    .eq("catalogue_job_id", jobId);
  const latest = [...latestBySlot(generations ?? []).values()];
  const next = catalogueJobStatusFor(latest.map((generation) => generation.status));
  await supabase
    .from("catalogue_jobs")
    .update({
      status: next,
      finished_at: next === "generating" ? null : new Date().toISOString(),
      error: next === "failed" ? "Every output failed — open the job to see why." : null,
    })
    .eq("id", jobId);
}

async function settleSheet(supabase: TypedSupabaseClient, row: GenerationRow): Promise<void> {
  if (!row.sheet_id) return;
  const { data: sheet } = await supabase
    .from("product_sheets")
    .select("id, generation_id, status")
    .eq("id", row.sheet_id)
    .maybeSingle();
  if (!sheet || sheet.generation_id !== row.id || sheet.status === "approved") return;
  await supabase
    .from("product_sheets")
    .update({ status: row.status === "completed" ? "review" : "failed" })
    .eq("id", sheet.id);
}

export function adProjectStatusFor(
  shots: Pick<ShotRow, "status">[],
): "planned" | "generating" | "review" {
  if (shots.some((shot) => shot.status === "generating" || shot.status === "preview_generating")) {
    return "generating";
  }
  if (
    shots.length > 0 &&
    shots.every((shot) => shot.status === "ready" || shot.status === "approved")
  ) {
    return "review";
  }
  return "planned";
}

async function settleShot(supabase: TypedSupabaseClient, row: GenerationRow): Promise<void> {
  if (!row.shot_id) return;
  const { data: shot } = await supabase
    .from("shots")
    .select("id, ad_project_id, preview_generation_id, video_generation_id")
    .eq("id", row.shot_id)
    .maybeSingle();
  if (!shot) return;
  const completed = row.status === "completed";
  if (row.purpose === "shot_preview" && shot.preview_generation_id === row.id) {
    await supabase
      .from("shots")
      .update({ status: completed ? "preview_ready" : "failed" })
      .eq("id", shot.id);
  } else if (row.purpose === "shot_video" && shot.video_generation_id === row.id) {
    await supabase
      .from("shots")
      .update({ status: completed ? "ready" : "failed" })
      .eq("id", shot.id);
  } else {
    return;
  }
  const { data: shots } = await supabase
    .from("shots")
    .select("status")
    .eq("ad_project_id", shot.ad_project_id);
  const { data: project } = await supabase
    .from("ad_projects")
    .select("status")
    .eq("id", shot.ad_project_id)
    .maybeSingle();
  if (project && project.status !== "done") {
    await supabase
      .from("ad_projects")
      .update({ status: adProjectStatusFor(shots ?? []) })
      .eq("id", shot.ad_project_id);
  }
}

/** Updates the job / sheet / shot that a settled generation belongs to. */
export async function settleLinkedRecords(
  supabase: TypedSupabaseClient,
  row: GenerationRow,
): Promise<void> {
  try {
    if (row.catalogue_job_id) await settleCatalogueJob(supabase, row.catalogue_job_id);
    if (row.purpose === "product_sheet") await settleSheet(supabase, row);
    if (row.shot_id) await settleShot(supabase, row);
  } catch (error) {
    console.error("Settling linked records failed", row.id, error);
  }
}
