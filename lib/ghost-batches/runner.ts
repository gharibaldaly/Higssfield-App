import "server-only";

import { queueCatalogueJobs, runCatalogueJob } from "@/lib/catalogue/service";
import { parseCatalogueStyle } from "@/lib/domain/catalogue-style";
import { isPendingStatus } from "@/lib/domain/generation";
import type { PhotoView } from "@/lib/domain/photo-classification";
import { analyzeProduct, approveDnaVersion } from "@/lib/dna/service";
import { dnaCompletenessIssues, garmentDnaSchema } from "@/lib/domain/garment-dna";
import { higgsfieldMaxConcurrent } from "@/lib/env";
import { toUserMessage } from "@/lib/errors";
import { reviewGenerationFidelity } from "@/lib/generations/fidelity";
import { refreshGenerations } from "@/lib/generations/service";
import { settleCatalogueJob } from "@/lib/generations/side-effects";
import { planNextStep, type BatchSnapshot } from "@/lib/ghost-batches/plan";
import {
  parseBatchOptions,
  parseItemMeta,
  type GhostWorkReport,
  type ItemMeta,
} from "@/lib/ghost-batches/schemas";
import { toLlmImage } from "@/lib/images/process";
import { getDirectorBrain } from "@/lib/providers/llm";
import type { LlmImage } from "@/lib/providers/llm/types";
import { getOwnerSettings } from "@/lib/settings/service";
import { downloadObject } from "@/lib/storage/objects";
import type {
  GhostBatchItemRow,
  GhostBatchRow,
  GenerationRow,
  Json,
} from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/**
 * Open generations one batch may have: the account's Higgsfield limit plus as
 * many again whose prompts are written and wait for a free slot (at least two
 * models' front & back). The generation service holds the extra ones back.
 */
export function batchInFlightCap(): number {
  return Math.max(4, 2 * higgsfieldMaxConcurrent());
}
/** An analysis still "running" after this long was cut off and is taken over. */
const ANALYSIS_LEASE_MS = 6 * 60 * 1000;
/** Longer than a function may run (300 s): a job still "working" after this was cut off. */
const STALE_JOB_MS = 6 * 60 * 1000;
const MAX_ANALYSIS_ATTEMPTS = 2;
/** Pending generations polled per step (the rest wait for the next step). */
const REFRESH_PER_STEP = 8;

const WAIT_MS = 8_000;

const STAGE_ONE = ["front_back", "macro"] as const;

async function loadSnapshot(
  supabase: TypedSupabaseClient,
  batch: GhostBatchRow,
): Promise<BatchSnapshot> {
  const { data: items } = await supabase
    .from("ghost_batch_items")
    .select("*")
    .eq("batch_id", batch.id)
    .order("position");
  const productIds = (items ?? []).map((item) => item.product_id);
  if (productIds.length === 0) {
    return {
      batch,
      items: [],
      products: [],
      jobs: [],
      pending: [],
      fronts: [],
      colorways: [],
      unchecked: [],
    };
  }
  const options = parseBatchOptions(batch.options);
  const [products, jobs, pending, fronts, colorways, unchecked] = await Promise.all([
    supabase.from("products").select("id, name, approved_dna_id").in("id", productIds),
    supabase
      .from("catalogue_jobs")
      .select("id, product_id, job_type, status, options, started_at, created_at")
      .eq("batch_id", batch.id),
    supabase
      .from("generations")
      .select("*")
      .in("product_id", productIds)
      .not("catalogue_job_id", "is", null)
      .in("status", ["queued", "in_progress"])
      .order("created_at")
      .limit(60),
    supabase
      .from("generations")
      .select("product_id")
      .in("product_id", productIds)
      .eq("purpose", "ghost_front")
      .eq("review_status", "approved"),
    batch.colours_requested_at
      ? supabase.from("colorways").select("id, product_id").in("product_id", productIds)
      : Promise.resolve({ data: [] as { id: string; product_id: string }[] }),
    options.fidelityCheck
      ? supabase
          .from("generations")
          .select("id, catalogue_job_id, created_at")
          .in("product_id", productIds)
          .not("catalogue_job_id", "is", null)
          .eq("status", "completed")
          .eq("review_status", "pending")
          .is("review", null)
          .order("created_at")
          .limit(40)
      : Promise.resolve({
          data: [] as { id: string; catalogue_job_id: string | null; created_at: string }[],
        }),
  ]);
  return {
    batch,
    items: items ?? [],
    products: products.data ?? [],
    jobs: jobs.data ?? [],
    pending: pending.data ?? [],
    fronts: [
      ...new Set((fronts.data ?? []).map((row) => row.product_id).filter(Boolean)),
    ] as string[],
    colorways: colorways.data ?? [],
    unchecked: unchecked.data ?? [],
  };
}

function report(
  snapshot: BatchSnapshot,
  step: GhostWorkReport["step"],
  extra: Partial<GhostWorkReport> = {},
): GhostWorkReport {
  return {
    step,
    batchId: snapshot.batch.id,
    batchName: snapshot.batch.name,
    modelName: null,
    done: snapshot.items.filter((item) => item.phase === "review").length,
    total: snapshot.items.length,
    retryInMs: step === "waiting" ? WAIT_MS : 0,
    error: null,
    ...extra,
  };
}

async function updateItem(
  supabase: TypedSupabaseClient,
  itemId: string,
  patch: Partial<Pick<GhostBatchItemRow, "phase" | "error" | "claimed_at">> & { meta?: ItemMeta },
): Promise<void> {
  const { meta, ...rest } = patch;
  await supabase
    .from("ghost_batch_items")
    .update({ ...rest, ...(meta ? { meta: meta as unknown as Json } : {}) })
    .eq("id", itemId);
}

const VIEW_KIND: Record<PhotoView, "front" | "back" | "detail"> = {
  front: "front",
  back: "back",
  detail: "detail",
  other: "detail",
};

const KIND_ORDER = { front: 0, back: 1, detail: 2 } as const;

/**
 * Lets the director brain sort photos whose view only came from their order,
 * labels every photo, and puts the clearest photo of each view first (it is
 * the one sent as the reference).
 */
async function classifyItemPhotos(
  supabase: TypedSupabaseClient,
  ownerId: string,
  item: GhostBatchItemRow,
  meta: ItemMeta,
): Promise<void> {
  const [{ data: photos }, { data: product }, settings] = await Promise.all([
    supabase
      .from("source_photos")
      .select("id, kind, label, storage_path, position")
      .eq("product_id", item.product_id)
      .order("position"),
    supabase.from("products").select("name, product_line").eq("id", item.product_id).single(),
    getOwnerSettings(supabase, ownerId),
  ]);
  const list = (photos ?? []).slice(0, 16);
  if (list.length === 0 || !product) return;
  const auto = new Set(meta.autoTagged);
  const images: LlmImage[] = await Promise.all(
    list.map(async (photo, index) =>
      toLlmImage(
        await downloadObject(supabase, photo.storage_path),
        `Photo ${index + 1}${auto.has(photo.id) ? "" : ` (the owner tagged it "${photo.kind}")`}`,
        { longEdge: 1024 },
      ),
    ),
  );
  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  const result = await brain.classifyPhotos({
    product: {
      name: product.name,
      productLine: product.product_line,
      notes: null,
      pieces: [{ position: 1, name: product.name }],
    },
    photos: images,
  });
  const byIndex = new Map(result.photos.map((entry) => [entry.index, entry]));
  const updated = list.map((photo, index) => {
    const entry = byIndex.get(index + 1);
    const kind = entry && auto.has(photo.id) ? VIEW_KIND[entry.view] : photo.kind;
    const label =
      photo.label ??
      (entry ? (entry.view === "other" ? `other: ${entry.label}` : entry.label) : null);
    return { ...photo, kind, label, clarity: entry?.clarity ?? 3, index };
  });
  updated.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.clarity - a.clarity || a.index - b.index,
  );
  await Promise.all(
    updated.map((photo, position) =>
      supabase
        .from("source_photos")
        .update({ kind: photo.kind, label: photo.label?.slice(0, 200) ?? null, position })
        .eq("id", photo.id),
    ),
  );
}

/** Queues a model's front & back and close-up jobs with the batch's model and style. */
async function queueStageOne(
  supabase: TypedSupabaseClient,
  ownerId: string,
  batch: GhostBatchRow,
  item: GhostBatchItemRow,
): Promise<string | null> {
  const { jobs, skipped } = await queueCatalogueJobs(
    supabase,
    ownerId,
    { jobTypes: [...STAGE_ONE], productIds: [item.product_id], modelId: batch.model_id },
    { batchId: batch.id, style: parseCatalogueStyle(batch.style) },
  );
  if (jobs.length === 0) return skipped[0]?.reason ?? "Nothing could be queued for this model.";
  return null;
}

/** Classify → Garment DNA → approval (automatic when complete) → stage one. */
async function analyzeItem(
  supabase: TypedSupabaseClient,
  ownerId: string,
  snapshot: BatchSnapshot,
  item: GhostBatchItemRow,
): Promise<GhostWorkReport> {
  const threshold = new Date(Date.now() - ANALYSIS_LEASE_MS).toISOString();
  const { data: claimed } = await supabase
    .from("ghost_batch_items")
    .update({ phase: "analyzing", claimed_at: new Date().toISOString(), error: null })
    .eq("id", item.id)
    .or(`phase.eq.pending,and(phase.eq.analyzing,claimed_at.lt.${threshold})`)
    .select("*")
    .maybeSingle();
  const productName = snapshot.products.find((product) => product.id === item.product_id)?.name;
  if (!claimed) return report(snapshot, "waiting", { modelName: productName ?? null });

  const meta = parseItemMeta(claimed.meta);
  meta.attempts += 1;
  if (meta.attempts > MAX_ANALYSIS_ATTEMPTS) {
    await updateItem(supabase, item.id, {
      phase: "failed",
      claimed_at: null,
      error: "The garment analysis did not finish. Retry this model.",
      meta,
    });
    return report(snapshot, "analyzing", { modelName: productName ?? null });
  }
  await updateItem(supabase, item.id, { meta });

  try {
    if (!meta.classified) {
      try {
        await classifyItemPhotos(supabase, ownerId, claimed, meta);
      } catch (error) {
        // Sorting is a convenience: the photo order still gives usable views.
        console.error("Photo sorting failed", item.id, error);
      }
      meta.classified = true;
      await updateItem(supabase, item.id, { meta });
    }

    const dnaRow = await analyzeProduct(supabase, ownerId, item.product_id);
    const options = parseBatchOptions(snapshot.batch.options);
    const parsed = garmentDnaSchema.safeParse(dnaRow.data);
    const issues = parsed.success ? dnaCompletenessIssues(parsed.data) : [];
    if (options.dnaCheck === "auto" && parsed.success && issues.length === 0) {
      await approveDnaVersion(supabase, item.product_id, dnaRow.id);
      const problem = await queueStageOne(supabase, ownerId, snapshot.batch, claimed);
      await updateItem(supabase, item.id, {
        phase: problem ? "failed" : "generating",
        error: problem,
        claimed_at: null,
        meta: { ...meta, dnaIssues: [] },
      });
    } else {
      await updateItem(supabase, item.id, {
        phase: "dna_review",
        claimed_at: null,
        meta: {
          ...meta,
          dnaIssues: issues.map((issue) => issue.field),
        },
      });
    }
  } catch (error) {
    await updateItem(supabase, item.id, {
      phase: "failed",
      claimed_at: null,
      error: toUserMessage(error),
      meta,
    });
    return report(snapshot, "analyzing", {
      modelName: productName ?? null,
      error: toUserMessage(error),
    });
  }
  return report(snapshot, "analyzing", { modelName: productName ?? null });
}

async function checkFidelity(
  supabase: TypedSupabaseClient,
  ownerId: string,
  snapshot: BatchSnapshot,
  generationId: string,
): Promise<GhostWorkReport> {
  const started = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("generations")
    .update({ review: { checking: true, at: started } })
    .eq("id", generationId)
    .is("review", null)
    .select("id, product_id")
    .maybeSingle();
  if (!claimed) return report(snapshot, "checking");
  const modelName =
    snapshot.products.find((product) => product.id === claimed.product_id)?.name ?? null;
  try {
    await reviewGenerationFidelity(supabase, ownerId, generationId);
  } catch (error) {
    await supabase
      .from("generations")
      .update({ review: { error: toUserMessage(error), at: new Date().toISOString() } })
      .eq("id", generationId);
  }
  return report(snapshot, "checking", { modelName });
}

/** One unit of work for one batch; null when the batch has nothing to do. */
async function advanceBatch(
  supabase: TypedSupabaseClient,
  ownerId: string,
  batch: GhostBatchRow,
): Promise<GhostWorkReport | null> {
  let snapshot = await loadSnapshot(supabase, batch);
  if (snapshot.items.length === 0) return null;

  // Settle finished generations first (copies results into Storage and moves jobs on).
  if (snapshot.pending.length > 0) {
    const refreshed = await refreshGenerations(
      supabase,
      snapshot.pending.slice(0, REFRESH_PER_STEP) as GenerationRow[],
      4,
    );
    if (refreshed.some((row) => !isPendingStatus(row.status))) {
      snapshot = await loadSnapshot(supabase, batch);
    }
  }

  // Jobs cut off mid-run (function timeout) settle from what they submitted, or fail.
  const staleBefore = Date.now() - STALE_JOB_MS;
  const busyJobs = new Set(snapshot.pending.map((generation) => generation.catalogue_job_id));
  const stale = snapshot.jobs.filter(
    (job) =>
      (job.status === "preparing" || job.status === "generating") &&
      job.started_at &&
      Date.parse(job.started_at) < staleBefore &&
      !busyJobs.has(job.id),
  );
  for (const job of stale) {
    const { count } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("catalogue_job_id", job.id);
    if (count) {
      await settleCatalogueJob(supabase, job.id);
    } else {
      await supabase
        .from("catalogue_jobs")
        .update({
          status: "failed",
          error: "Timed out while writing the prompts. Retry this job.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .in("status", ["preparing", "generating"]);
    }
  }
  if (stale.length > 0) snapshot = await loadSnapshot(supabase, batch);

  const plan = planNextStep(snapshot, {
    inFlightCap: batchInFlightCap(),
    now: Date.now(),
    leaseMs: ANALYSIS_LEASE_MS,
  });

  for (const itemId of plan.settledItems) {
    await updateItem(supabase, itemId, { phase: "review", error: null });
  }
  if (plan.settledItems.length > 0) snapshot = await loadSnapshot(supabase, batch);

  const nameOf = (productId: string) =>
    snapshot.products.find((product) => product.id === productId)?.name ?? null;

  const step = plan.step;
  switch (step.kind) {
    case "run_job": {
      const job = snapshot.jobs.find((candidate) => candidate.id === step.jobId);
      await runCatalogueJob(supabase, ownerId, step.jobId);
      return report(snapshot, job?.job_type === "colorways" ? "colours" : "generating", {
        modelName: job ? nameOf(job.product_id) : null,
      });
    }
    case "queue_stage_one": {
      const item = snapshot.items.find((candidate) => candidate.id === step.itemId);
      if (!item) return report(snapshot, "waiting");
      const problem = await queueStageOne(supabase, ownerId, batch, item);
      await updateItem(supabase, item.id, {
        phase: problem ? "failed" : "generating",
        error: problem,
      });
      return report(snapshot, "generating", { modelName: nameOf(item.product_id) });
    }
    case "analyze": {
      const item = snapshot.items.find((candidate) => candidate.id === step.itemId);
      if (!item) return report(snapshot, "waiting");
      return analyzeItem(supabase, ownerId, snapshot, item);
    }
    case "queue_colours": {
      await queueCatalogueJobs(
        supabase,
        ownerId,
        {
          jobTypes: ["colorways"],
          productIds: [step.productId],
          modelId: batch.model_id,
          colorwayIds: { [step.productId]: step.colorwayIds },
        },
        { batchId: batch.id, style: parseCatalogueStyle(batch.style) },
      );
      return report(snapshot, "colours", { modelName: nameOf(step.productId) });
    }
    case "check":
      return checkFidelity(supabase, ownerId, snapshot, step.generationId);
    case "wait":
      return report(snapshot, "waiting");
    case "idle":
      return null;
  }
}

/**
 * Advances the owner's running ghost batches by one unit of work: settle
 * finished images, run the next queued job, analyse the next model, queue
 * colours for approved fronts, or check a finished image's fidelity. The
 * studio calls this in a loop while a tab is open (see GhostBatchRunner).
 */
export async function advanceGhostWork(
  supabase: TypedSupabaseClient,
  ownerId: string,
): Promise<GhostWorkReport> {
  const { data: batches } = await supabase
    .from("ghost_batches")
    .select("*")
    .eq("status", "running")
    .order("created_at");
  let waiting: GhostWorkReport | null = null;
  for (const batch of batches ?? []) {
    const result = await advanceBatch(supabase, ownerId, batch);
    if (!result) continue;
    if (result.step !== "waiting") return result;
    waiting ??= result;
  }
  return (
    waiting ?? {
      step: "idle",
      batchId: null,
      batchName: null,
      modelName: null,
      done: 0,
      total: 0,
      retryInMs: 0,
      error: null,
    }
  );
}

export async function hasRunningGhostBatch(supabase: TypedSupabaseClient): Promise<boolean> {
  const { count } = await supabase
    .from("ghost_batches")
    .select("id", { count: "exact", head: true })
    .eq("status", "running");
  return (count ?? 0) > 0;
}
