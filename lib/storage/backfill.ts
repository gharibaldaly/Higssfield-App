import "server-only";

import { AppError } from "@/lib/errors";
import {
  canDerive,
  derivedPath,
  ensureDerivatives,
  type DerivativeKind,
} from "@/lib/storage/derivatives";
import { signPaths } from "@/lib/storage/objects";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * The small copies for the files stored before copies existed (2026-10-06),
 * made one page at a time so each call fits a function run. The owner starts
 * it from Settings and the browser calls again with the cursor each answer
 * returns. Reading an original to make its copies is egress too, so a file
 * whose copies exist is only checked (one signing call per page), never read.
 */

export const BACKFILL_PHASES = ["photos", "results", "sheets", "crops"] as const;
export type BackfillPhase = (typeof BACKFILL_PHASES)[number];
export type BackfillCursor = { phase: BackfillPhase; offset: number };

export type BackfillStep = {
  /** Files looked at in this call. */
  processed: number;
  /** Files that got at least one new copy. */
  made: number;
  /** Files whose copies already existed. */
  skipped: number;
  /** Files whose original could not be read or whose copy could not be made. */
  failed: number;
  /** Where the next call continues, or null when every file has been seen. */
  next: BackfillCursor | null;
};

const PAGE_SIZE = 50;
/** Well inside the route's limit, so the answer with the cursor always arrives. */
const TIME_BUDGET_MS = 45_000;

/** Photos and results feed Higgsfield and the brain too; boards and crops only have tiles. */
const KINDS_BY_PHASE: Record<BackfillPhase, DerivativeKind[]> = {
  photos: ["thumb", "prep"],
  results: ["thumb", "prep"],
  sheets: ["thumb"],
  crops: ["thumb"],
};

type Page = { paths: (string | null)[]; rows: number };

/** One page of a phase's files, in a stable order (new rows only ever append). */
async function pageOf(
  supabase: TypedSupabaseClient,
  ownerId: string,
  phase: BackfillPhase,
  offset: number,
): Promise<Page> {
  const to = offset + PAGE_SIZE - 1;
  switch (phase) {
    case "photos": {
      const { data, error } = await supabase
        .from("source_photos")
        .select("storage_path")
        .eq("owner_id", ownerId)
        .order("created_at")
        .order("id")
        .range(offset, to);
      if (error)
        throw new AppError("unknown", "Could not list the photos.", { detail: error.message });
      const rows = data ?? [];
      return { paths: rows.map((row) => row.storage_path), rows: rows.length };
    }
    case "results": {
      const { data, error } = await supabase
        .from("generations")
        .select("storage_path, mime_type")
        .eq("owner_id", ownerId)
        .eq("kind", "image")
        .eq("status", "completed")
        .not("storage_path", "is", null)
        .order("created_at")
        .order("id")
        .range(offset, to);
      if (error)
        throw new AppError("unknown", "Could not list the results.", { detail: error.message });
      const rows = data ?? [];
      return {
        paths: rows.map((row) => (canDerive(row.mime_type) ? row.storage_path : null)),
        rows: rows.length,
      };
    }
    case "sheets": {
      const { data, error } = await supabase
        .from("product_sheets")
        .select("image_path")
        .eq("owner_id", ownerId)
        .not("image_path", "is", null)
        .order("created_at")
        .order("id")
        .range(offset, to);
      if (error)
        throw new AppError("unknown", "Could not list the sheets.", { detail: error.message });
      const rows = data ?? [];
      return { paths: rows.map((row) => row.image_path), rows: rows.length };
    }
    case "crops": {
      const { data, error } = await supabase
        .from("reference_crops")
        .select("storage_path")
        .eq("owner_id", ownerId)
        .order("created_at")
        .order("id")
        .range(offset, to);
      if (error)
        throw new AppError("unknown", "Could not list the crops.", { detail: error.message });
      const rows = data ?? [];
      return { paths: rows.map((row) => row.storage_path), rows: rows.length };
    }
  }
}

/** How many files the whole run looks at, for the progress line. */
export async function countBackfill(
  supabase: TypedSupabaseClient,
  ownerId: string,
): Promise<number> {
  const counts = await Promise.all([
    supabase
      .from("source_photos")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId),
    supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("kind", "image")
      .eq("status", "completed")
      .not("storage_path", "is", null),
    supabase
      .from("product_sheets")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .not("image_path", "is", null),
    supabase
      .from("reference_crops")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId),
  ]);
  return counts.reduce((sum, result) => sum + (result.count ?? 0), 0);
}

/** Makes the missing copies from the cursor on, until the time budget is spent or every file was seen. */
export async function backfillStep(
  supabase: TypedSupabaseClient,
  ownerId: string,
  cursor: BackfillCursor | null,
): Promise<BackfillStep> {
  const started = Date.now();
  const outOfTime = () => Date.now() - started > TIME_BUDGET_MS;
  let phase: BackfillPhase = cursor?.phase ?? "photos";
  let offset = cursor?.offset ?? 0;
  const step: BackfillStep = { processed: 0, made: 0, skipped: 0, failed: 0, next: null };

  for (;;) {
    const page = await pageOf(supabase, ownerId, phase, offset);
    const kinds = KINDS_BY_PHASE[phase];
    const targets = page.paths.map((path) =>
      path ? { path, derived: kinds.map((kind) => derivedPath(path, kind)) } : null,
    );
    // One signing call tells which files already have every copy.
    const existing = await signPaths(
      supabase,
      targets.flatMap((target) => target?.derived ?? []),
      { cache: false },
    );
    for (const [index, target] of targets.entries()) {
      if (outOfTime()) return { ...step, next: { phase, offset: offset + index } };
      if (!target) continue;
      step.processed += 1;
      if (target.derived.every((path) => existing.has(path))) {
        step.skipped += 1;
        continue;
      }
      const result = await ensureDerivatives(supabase, target.path, undefined, kinds);
      if (result.failed.length > 0) step.failed += 1;
      else if (result.made.length > 0) step.made += 1;
      else step.skipped += 1;
    }
    if (page.rows < PAGE_SIZE) {
      const nextPhase = BACKFILL_PHASES[BACKFILL_PHASES.indexOf(phase) + 1];
      if (!nextPhase) return { ...step, next: null };
      phase = nextPhase;
      offset = 0;
    } else {
      offset += PAGE_SIZE;
    }
    if (outOfTime()) return { ...step, next: { phase, offset } };
  }
}
