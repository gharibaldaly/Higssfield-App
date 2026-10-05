import type {
  CatalogueJobRow,
  GenerationRow,
  GhostBatchItemRow,
  GhostBatchRow,
} from "@/lib/supabase/database.types";

/**
 * The batch runner's decision, kept pure so the order of work is testable:
 * 1. run the next queued job (model order; front & back, then close-ups, then colours)
 *    while the provider has room;
 * 2. queue stage one for models whose DNA the owner has just approved;
 * 3. analyse the next model, at most two models ahead of the generations;
 * 4. once colours are requested, queue the colours of every model whose front is approved;
 * 5. check the fidelity of finished images;
 * then wait for the provider, or stop.
 */

export type SnapshotJob = Pick<
  CatalogueJobRow,
  "id" | "product_id" | "job_type" | "status" | "options" | "started_at" | "created_at"
>;

export type BatchSnapshot = {
  batch: GhostBatchRow;
  items: GhostBatchItemRow[];
  products: { id: string; name: string; approved_dna_id: string | null }[];
  jobs: SnapshotJob[];
  /** Generations of the batch's models still at the provider. */
  pending: Pick<GenerationRow, "id" | "catalogue_job_id">[];
  /** Products whose front image is approved. */
  fronts: string[];
  colorways: { id: string; product_id: string }[];
  /** Finished images that have not been fidelity-checked yet, oldest first. */
  unchecked: { id: string; catalogue_job_id: string | null; created_at: string }[];
};

export type NextStep =
  | { kind: "run_job"; jobId: string }
  | { kind: "queue_stage_one"; itemId: string }
  | { kind: "analyze"; itemId: string }
  | { kind: "queue_colours"; productId: string; colorwayIds: string[] }
  | { kind: "check"; generationId: string }
  | { kind: "wait" }
  | { kind: "idle" };

const STAGE_ONE: readonly CatalogueJobRow["job_type"][] = ["front_back", "macro"];
const JOB_ORDER: Record<CatalogueJobRow["job_type"], number> = {
  front_back: 0,
  macro: 1,
  colorways: 2,
};
const SETTLED: readonly CatalogueJobRow["status"][] = ["review", "approved", "failed", "canceled"];
/** Models analysed ahead of the ones waiting for the provider. */
const LOOKAHEAD_MODELS = 2;
/** Colours per job, so writing their prompts fits in one function run. */
export const COLOURS_PER_JOB = 3;

export function colorwayIdsOf(options: unknown): string[] {
  if (!options || typeof options !== "object" || Array.isArray(options)) return [];
  const ids = (options as { colorwayIds?: unknown }).colorwayIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** The outer-layer piece a front & back job renders a second front without (a robe set). */
export function outerPositionOf(options: unknown): number | null {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const position = (options as { outerPosition?: unknown }).outerPosition;
  return typeof position === "number" && Number.isInteger(position) && position > 0
    ? position
    : null;
}

/** The bottoms piece a front & back job composes from its flat photo (a pyjama set). */
export function bottomsPositionOf(options: unknown): number | null {
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  const position = (options as { bottomsPosition?: unknown }).bottomsPosition;
  return typeof position === "number" && Number.isInteger(position) && position > 0
    ? position
    : null;
}

/** Images a job sends to the provider. */
export function slotsOf(job: SnapshotJob): number {
  if (job.job_type === "colorways") return Math.max(1, colorwayIdsOf(job.options).length);
  // A robe set's front & back job adds the front without the robe.
  if (job.job_type === "front_back" && outerPositionOf(job.options)) return 3;
  return 2;
}

export function planNextStep(
  snapshot: BatchSnapshot,
  config: { inFlightCap: number; now: number; leaseMs: number },
): { settledItems: string[]; step: NextStep } {
  const { batch, items, jobs } = snapshot;
  const position = new Map(items.map((item) => [item.product_id, item.position]));
  const jobsOf = (productId: string) => jobs.filter((job) => job.product_id === productId);

  const settledItems = items
    .filter((item) => item.phase === "generating")
    .filter((item) => {
      const stage = jobsOf(item.product_id).filter((job) => STAGE_ONE.includes(job.job_type));
      return stage.length > 0 && stage.every((job) => SETTLED.includes(job.status));
    })
    .map((item) => item.id);

  const inFlight = snapshot.pending.length;
  const queued = jobs
    .filter((job) => job.status === "queued" && position.has(job.product_id))
    .sort(
      (a, b) =>
        position.get(a.product_id)! - position.get(b.product_id)! ||
        JOB_ORDER[a.job_type] - JOB_ORDER[b.job_type] ||
        Date.parse(a.created_at) - Date.parse(b.created_at),
    );
  const next = queued[0];
  if (next && (inFlight === 0 || inFlight + slotsOf(next) <= config.inFlightCap)) {
    return { settledItems, step: { kind: "run_job", jobId: next.id } };
  }

  const approved = new Set(
    snapshot.products.filter((product) => product.approved_dna_id).map((product) => product.id),
  );
  // A DNA the owner just approved, or a model whose jobs never got queued (a retry, a cut-off run).
  const unqueued = items.find(
    (item) =>
      approved.has(item.product_id) &&
      (item.phase === "dna_review" ||
        (item.phase === "generating" &&
          !jobsOf(item.product_id).some((job) => STAGE_ONE.includes(job.job_type)))),
  );
  if (unqueued) return { settledItems, step: { kind: "queue_stage_one", itemId: unqueued.id } };

  const modelsAhead = new Set(queued.map((job) => job.product_id)).size;
  if (modelsAhead < LOOKAHEAD_MODELS) {
    const candidate = items.find(
      (item) =>
        item.phase === "pending" ||
        (item.phase === "analyzing" &&
          (!item.claimed_at || config.now - Date.parse(item.claimed_at) > config.leaseMs)),
    );
    if (candidate) return { settledItems, step: { kind: "analyze", itemId: candidate.id } };
  }

  if (batch.colours_requested_at) {
    const fronts = new Set(snapshot.fronts);
    for (const item of items) {
      if (!fronts.has(item.product_id)) continue;
      const colours = snapshot.colorways
        .filter((colorway) => colorway.product_id === item.product_id)
        .map((colorway) => colorway.id);
      if (colours.length === 0) continue;
      const covered = new Set(
        jobsOf(item.product_id)
          .filter((job) => job.job_type === "colorways" && job.status !== "canceled")
          .flatMap((job) => colorwayIdsOf(job.options)),
      );
      const missing = colours.filter((id) => !covered.has(id));
      if (missing.length > 0) {
        return {
          settledItems,
          step: {
            kind: "queue_colours",
            productId: item.product_id,
            colorwayIds: missing.slice(0, COLOURS_PER_JOB),
          },
        };
      }
    }
  }

  const batchJobs = new Set(jobs.map((job) => job.id));
  const unchecked = snapshot.unchecked.find(
    (generation) => generation.catalogue_job_id && batchJobs.has(generation.catalogue_job_id),
  );
  if (unchecked) return { settledItems, step: { kind: "check", generationId: unchecked.id } };

  const busy =
    inFlight > 0 ||
    queued.length > 0 ||
    jobs.some((job) => job.status === "preparing") ||
    items.some((item) => item.phase === "analyzing");
  return { settledItems, step: busy ? { kind: "wait" } : { kind: "idle" } };
}
