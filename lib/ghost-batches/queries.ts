import "server-only";

import { outputsFor, type GhostOutput } from "@/lib/catalogue/queries";
import { parseCatalogueStyle, type CatalogueStyle } from "@/lib/domain/catalogue-style";
import type { ProductLine } from "@/lib/domain/product";
import { toViews } from "@/lib/generations/queries";
import { parseBatchOptions, parseItemMeta, type BatchOptions } from "@/lib/ghost-batches/schemas";
import { signPaths } from "@/lib/storage/objects";
import type {
  CatalogueJobRow,
  GenerationRow,
  GhostBatchItemRow,
  GhostBatchRow,
} from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export type BatchPhase = GhostBatchItemRow["phase"];

export type GhostBatchSummary = {
  id: string;
  name: string;
  status: GhostBatchRow["status"];
  createdAt: string;
  total: number;
  /** Models whose front, back and close-ups are finished. */
  finished: number;
  failed: number;
};

export type BatchJobView = {
  id: string;
  type: CatalogueJobRow["job_type"];
  status: CatalogueJobRow["status"];
  error: string | null;
};

export type BatchItemView = {
  id: string;
  productId: string;
  name: string;
  productLine: ProductLine;
  phase: BatchPhase;
  error: string | null;
  dnaApproved: boolean;
  dnaIssues: string[];
  failedUploads: number;
  photoCount: number;
  thumbUrl: string | null;
  /** A robe set: the position of the robe's piece; its stage adds a front without the robe. */
  outerPosition: number | null;
  /** Front, back and the two close-ups (latest attempt per slot). */
  outputs: GhostOutput[];
  jobs: BatchJobView[];
  colours: { id: string; name: string; hex: string }[];
  colourOutputs: GhostOutput[];
  colourJobs: BatchJobView[];
  frontApproved: boolean;
};

export type GhostBatchDetail = {
  id: string;
  name: string;
  status: GhostBatchRow["status"];
  modelId: string;
  style: CatalogueStyle;
  options: BatchOptions;
  coloursRequested: boolean;
  createdAt: string;
  items: BatchItemView[];
};

const FINISHED: readonly BatchPhase[] = ["review"];

export async function loadGhostBatches(
  supabase: TypedSupabaseClient,
  selectedId: string | null,
): Promise<{ batches: GhostBatchSummary[]; detail: GhostBatchDetail | null }> {
  const { data: batchRows } = await supabase
    .from("ghost_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);
  const batches = batchRows ?? [];
  if (batches.length === 0) return { batches: [], detail: null };

  const { data: phaseRows } = await supabase
    .from("ghost_batch_items")
    .select("batch_id, phase")
    .in(
      "batch_id",
      batches.map((batch) => batch.id),
    );
  const summaries: GhostBatchSummary[] = batches.map((batch) => {
    const phases = (phaseRows ?? []).filter((row) => row.batch_id === batch.id);
    return {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      createdAt: batch.created_at,
      total: phases.length,
      finished: phases.filter((row) => FINISHED.includes(row.phase)).length,
      failed: phases.filter((row) => row.phase === "failed").length,
    };
  });

  const selected = batches.find((batch) => batch.id === selectedId) ?? batches[0]!;
  return { batches: summaries, detail: await loadBatchDetail(supabase, selected) };
}

async function loadBatchDetail(
  supabase: TypedSupabaseClient,
  batch: GhostBatchRow,
): Promise<GhostBatchDetail> {
  const { data: itemRows } = await supabase
    .from("ghost_batch_items")
    .select("*")
    .eq("batch_id", batch.id)
    .order("position");
  const items = itemRows ?? [];
  const productIds = items.map((item) => item.product_id);
  const base = {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    modelId: batch.model_id,
    style: parseCatalogueStyle(batch.style),
    options: parseBatchOptions(batch.options),
    coloursRequested: Boolean(batch.colours_requested_at),
    createdAt: batch.created_at,
  };
  if (productIds.length === 0) return { ...base, items: [] };

  const [products, photos, colorways, jobs, generations] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, product_line, approved_dna_id")
      .in("id", productIds),
    supabase
      .from("source_photos")
      .select("product_id, kind, storage_path, position")
      .in("product_id", productIds)
      .order("position"),
    supabase
      .from("colorways")
      .select("id, product_id, name, hex, position")
      .in("product_id", productIds)
      .order("position"),
    supabase.from("catalogue_jobs").select("*").eq("batch_id", batch.id).order("created_at"),
    supabase
      .from("generations")
      .select("*")
      .in("product_id", productIds)
      .not("catalogue_job_id", "is", null),
  ]);

  const jobRows = jobs.data ?? [];
  const jobIds = new Set(jobRows.map((job) => job.id));
  const rows = (generations.data ?? []).filter(
    (row) => row.catalogue_job_id && jobIds.has(row.catalogue_job_id),
  );
  const views = new Map((await toViews(supabase, rows)).map((view) => [view.id, view]));
  const photoRows = photos.data ?? [];
  // Each model's thumbnail: its first front photo, else its first photo.
  const thumbPath = new Map<string, string>();
  for (const photo of photoRows) {
    if (photo.kind === "front" && !thumbPath.has(photo.product_id)) {
      thumbPath.set(photo.product_id, photo.storage_path);
    }
  }
  for (const photo of photoRows) {
    if (!thumbPath.has(photo.product_id)) thumbPath.set(photo.product_id, photo.storage_path);
  }
  const urls = await signPaths(supabase, [
    ...thumbPath.values(),
    ...rows.map((row) => row.reference_paths[0] ?? null),
  ]);

  const productById = new Map((products.data ?? []).map((product) => [product.id, product]));
  const toJobView = (job: CatalogueJobRow): BatchJobView => ({
    id: job.id,
    type: job.job_type,
    status: job.status,
    error: job.error,
  });

  return {
    ...base,
    items: items.map((item) => {
      const product = productById.get(item.product_id);
      const meta = parseItemMeta(item.meta);
      const itemJobs = jobRows.filter((job) => job.product_id === item.product_id);
      const stageJobs = itemJobs.filter((job) => job.job_type !== "colorways");
      const colourJobs = itemJobs.filter((job) => job.job_type === "colorways");
      const rowsOf = (list: CatalogueJobRow[]): GenerationRow[] => {
        const ids = new Set(list.map((job) => job.id));
        return rows.filter((row) => row.catalogue_job_id && ids.has(row.catalogue_job_id));
      };
      const stageRows = rowsOf(stageJobs);
      const outputs = outputsFor(stageRows, views, urls);
      const thumb = thumbPath.get(item.product_id);
      return {
        id: item.id,
        productId: item.product_id,
        name: product?.name ?? "",
        productLine: product?.product_line ?? "SECRET",
        phase: item.phase,
        error: item.error,
        dnaApproved: Boolean(product?.approved_dna_id),
        dnaIssues: meta.dnaIssues,
        failedUploads: meta.failedUploads,
        photoCount: photoRows.filter((photo) => photo.product_id === item.product_id).length,
        thumbUrl: thumb ? (urls.get(thumb) ?? null) : null,
        outerPosition: meta.outerPosition,
        outputs,
        jobs: stageJobs.map(toJobView),
        colours: (colorways.data ?? [])
          .filter((colorway) => colorway.product_id === item.product_id)
          .map((colorway) => ({ id: colorway.id, name: colorway.name, hex: colorway.hex })),
        colourOutputs: outputsFor(rowsOf(colourJobs), views, urls),
        colourJobs: colourJobs.map(toJobView),
        // The front with the robe on: a robe set's inner front never starts colours.
        frontApproved: stageRows.some(
          (row) =>
            row.purpose === "ghost_front" &&
            row.slot === "front" &&
            row.review_status === "approved",
        ),
      };
    }),
  };
}
