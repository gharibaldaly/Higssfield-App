import type { GenerationRow } from "@/lib/supabase/database.types";

/** The columns the library needs to group and count generations. */
export type OutputRow = Pick<
  GenerationRow,
  | "id"
  | "product_id"
  | "catalogue_job_id"
  | "slot"
  | "purpose"
  | "kind"
  | "status"
  | "review_status"
  | "storage_path"
  | "created_at"
>;

export function newestFirst<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * What a collection holds now: for catalogue jobs the latest attempt of each
 * view (a regeneration replaces its output), and every other generation as
 * it is. Newest first.
 */
export function currentOutputs<T extends OutputRow>(rows: T[]): T[] {
  const byJob = new Map<string, T[]>();
  const current: T[] = [];
  for (const row of rows) {
    if (!row.catalogue_job_id) {
      current.push(row);
      continue;
    }
    const list = byJob.get(row.catalogue_job_id);
    if (list) list.push(row);
    else byJob.set(row.catalogue_job_id, [row]);
  }
  for (const jobRows of byJob.values()) {
    const latest = new Map<string, T>();
    for (const row of newestFirst(jobRows)) {
      const key = row.slot ?? row.id;
      if (!latest.has(key)) latest.set(key, row);
    }
    current.push(...latest.values());
  }
  return newestFirst(current);
}

/** A finished image that is not being regenerated. */
export function isDone(row: Pick<OutputRow, "status" | "review_status">): boolean {
  return row.status === "completed" && row.review_status !== "rejected";
}

export function countOutputs(rows: Pick<OutputRow, "status" | "review_status">[]): {
  images: number;
  approved: number;
} {
  const done = rows.filter(isDone);
  return {
    images: done.length,
    approved: done.filter((row) => row.review_status === "approved").length,
  };
}

/**
 * Sorts generations into their ghost batch (through their catalogue job) or,
 * outside batches, under their product.
 */
export function splitByBatch<T extends OutputRow>(
  rows: T[],
  batchOfJob: ReadonlyMap<string, string>,
): { byBatch: Map<string, T[]>; byProduct: Map<string, T[]> } {
  const byBatch = new Map<string, T[]>();
  const byProduct = new Map<string, T[]>();
  for (const row of rows) {
    const batchId = row.catalogue_job_id ? batchOfJob.get(row.catalogue_job_id) : undefined;
    const target = batchId ? byBatch : byProduct;
    const key = batchId ?? row.product_id;
    if (!key) continue;
    const list = target.get(key);
    if (list) list.push(row);
    else target.set(key, [row]);
  }
  return { byBatch, byProduct };
}

/**
 * Up to `limit` cover images for a card, one per model in the models' own
 * order: its approved front, else its latest finished front, else its latest
 * finished image.
 */
export function coverPaths<T extends OutputRow>(
  models: readonly string[],
  current: T[],
  limit = 4,
): string[] {
  const covers: string[] = [];
  for (const productId of models) {
    if (covers.length >= limit) break;
    const done = current.filter(
      (row) =>
        row.product_id === productId && row.kind === "image" && isDone(row) && row.storage_path,
    );
    const front = done.filter((row) => row.slot === "front");
    const pick = front.find((row) => row.review_status === "approved") ?? front[0] ?? done[0];
    if (pick?.storage_path) covers.push(pick.storage_path);
  }
  return covers;
}
