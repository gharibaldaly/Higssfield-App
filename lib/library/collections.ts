import "server-only";

import { outputsFor } from "@/lib/catalogue/queries";
import { isFinishedResult, type GenerationView } from "@/lib/domain/generation";
import type { ProductLine } from "@/lib/domain/product";
import { AppError } from "@/lib/errors";
import { toViews } from "@/lib/generations/queries";
import { outputFileName, uniqueFileNames } from "@/lib/library/file-names";
import {
  countOutputs,
  coverPaths,
  currentOutputs,
  newestFirst,
  splitByBatch,
  type OutputRow,
} from "@/lib/library/grouping";
import { thumbUrls } from "@/lib/storage/derivatives";
import { signPaths } from "@/lib/storage/objects";
import type { GenerationRow, GhostBatchRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export type CollectionKind = "batch" | "product";

/** A batch, or a product with results outside batches, as a card in the library. */
export type CollectionCard = {
  kind: CollectionKind;
  id: string;
  name: string;
  createdAt: string;
  productLine: ProductLine | null;
  status: GhostBatchRow["status"] | null;
  models: number;
  images: number;
  approved: number;
  coverUrls: string[];
};

export type CollectionOutput = {
  slot: string;
  slotLabel: string | null;
  /** Its path inside a downloaded archive. */
  fileName: string;
  view: GenerationView;
  downloadUrl: string | null;
};

export type CollectionModel = {
  id: string;
  name: string;
  productLine: ProductLine;
  outputs: CollectionOutput[];
};

export type LibraryCollection = {
  kind: CollectionKind;
  id: string;
  name: string;
  createdAt: string;
  status: GhostBatchRow["status"] | null;
  models: CollectionModel[];
  /** Where the collection is worked on. */
  studioHref: string;
};

const OUTPUT_COLUMNS =
  "id, product_id, catalogue_job_id, slot, purpose, kind, status, review_status, storage_path, created_at";
/** PostgREST answers at most this many rows per request. */
const PAGE = 1000;
/** Product ids per query, so the request line stays short. */
const ID_CHUNK = 40;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Every row of a query, a page at a time. */
async function allRows<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) {
      throw new AppError("unknown", "Could not load the library.", { detail: error.message });
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

/** The catalogue generations of these products, newest first. */
async function catalogueRowsOf(
  supabase: TypedSupabaseClient,
  productIds: string[],
): Promise<GenerationRow[]> {
  const pages = await Promise.all(
    chunks(productIds, ID_CHUNK).map((ids) =>
      allRows<GenerationRow>((from, to) =>
        supabase
          .from("generations")
          .select("*")
          .in("product_id", ids)
          .not("catalogue_job_id", "is", null)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
    ),
  );
  return newestFirst(pages.flat());
}

export async function listLibraryCollections(
  supabase: TypedSupabaseClient,
): Promise<{ batches: CollectionCard[]; products: CollectionCard[] }> {
  const [batches, items, jobs, products, rows] = await Promise.all([
    supabase
      .from("ghost_batches")
      .select("id, name, status, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("ghost_batch_items").select("batch_id, product_id, position").order("position"),
    allRows((from, to) =>
      supabase
        .from("catalogue_jobs")
        .select("id, batch_id")
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    supabase.from("products").select("id, name, product_line"),
    allRows<OutputRow>((from, to) =>
      supabase
        .from("generations")
        .select(OUTPUT_COLUMNS)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);

  const batchRows = batches.data ?? [];
  const batchIds = new Set(batchRows.map((batch) => batch.id));
  const batchOfJob = new Map(
    jobs.filter((job) => batchIds.has(job.batch_id)).map((job) => [job.id, job.batch_id] as const),
  );
  const { byBatch, byProduct } = splitByBatch(rows, batchOfJob);
  const productById = new Map((products.data ?? []).map((product) => [product.id, product]));
  const modelsOf = new Map<string, string[]>();
  for (const item of items.data ?? []) {
    const list = modelsOf.get(item.batch_id);
    if (list) list.push(item.product_id);
    else modelsOf.set(item.batch_id, [item.product_id]);
  }

  const batchCards = batchRows.map((batch) => {
    const current = currentOutputs(byBatch.get(batch.id) ?? []);
    const models = modelsOf.get(batch.id) ?? [];
    return {
      kind: "batch" as const,
      id: batch.id,
      name: batch.name,
      createdAt: batch.created_at,
      productLine: null,
      status: batch.status,
      models: models.length,
      ...countOutputs(current),
      covers: coverPaths(models, current),
    };
  });
  const productCards = [...byProduct.entries()]
    .flatMap(([productId, productRows]) => {
      const product = productById.get(productId);
      if (!product) return [];
      const current = currentOutputs(productRows);
      return [
        {
          kind: "product" as const,
          id: product.id,
          name: product.name,
          createdAt: current[0]?.created_at ?? "",
          productLine: product.product_line,
          status: null,
          models: 1,
          ...countOutputs(current),
          covers: coverPaths([productId], current, 1),
        },
      ];
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const signed = await thumbUrls(supabase, [
    ...batchCards.flatMap((card) => card.covers),
    ...productCards.flatMap((card) => card.covers),
  ]);
  const withUrls = <T extends { covers: string[] }>({ covers, ...card }: T) => ({
    ...card,
    coverUrls: covers.flatMap((path) => signed.get(path) ?? []),
  });
  return { batches: batchCards.map(withUrls), products: productCards.map(withUrls) };
}

/**
 * A model's outputs for the library: per job, the latest attempt of each
 * view in catalogue order. Jobs come in the order given (a batch model's
 * front and back, then close-ups, then colours).
 */
function modelOutputs(
  rows: GenerationRow[],
  views: Map<string, GenerationView>,
  jobOrder: "oldest" | "newest",
): { slot: string; slotLabel: string | null; view: GenerationView }[] {
  const byJob = new Map<string, GenerationRow[]>();
  const single: GenerationRow[] = [];
  for (const row of rows) {
    if (!row.catalogue_job_id) {
      single.push(row);
      continue;
    }
    const list = byJob.get(row.catalogue_job_id);
    if (list) list.push(row);
    else byJob.set(row.catalogue_job_id, [row]);
  }
  const started = (jobRows: GenerationRow[]) =>
    Math.min(...jobRows.map((row) => Date.parse(row.created_at)));
  const jobs = [...byJob.values()].sort((a, b) =>
    jobOrder === "oldest" ? started(a) - started(b) : started(b) - started(a),
  );
  return [
    ...jobs.flatMap((jobRows) =>
      outputsFor(jobRows, views, new Map()).map((output) => ({
        slot: output.slot,
        slotLabel: output.slotLabel,
        view: output.generation,
      })),
    ),
    ...newestFirst(single).map((row) => ({
      slot: row.purpose,
      slotLabel: null,
      view: views.get(row.id)!,
    })),
  ];
}

/** Names every file of the collection and signs the single-image downloads. */
async function finishModels(
  supabase: TypedSupabaseClient,
  models: { id: string; name: string; productLine: ProductLine; rows: GenerationRow[] }[],
  jobOrder: "oldest" | "newest",
): Promise<CollectionModel[]> {
  const rows = models.flatMap((model) => model.rows);
  const [viewList, downloads] = await Promise.all([
    toViews(supabase, rows),
    signPaths(
      supabase,
      rows.map((row) => row.storage_path),
      { download: true },
    ),
  ]);
  const views = new Map(viewList.map((view) => [view.id, view]));
  const drafts = models.map((model) => ({
    ...model,
    outputs: modelOutputs(model.rows, views, jobOrder),
  }));
  const names = uniqueFileNames(
    drafts.flatMap((model) =>
      model.outputs.map((output) =>
        outputFileName({
          model: model.name,
          slot: output.slot,
          slotLabel: output.slotLabel,
          purpose: output.view.purpose,
          mimeType: output.view.mimeType,
        }),
      ),
    ),
  );
  let index = 0;
  return drafts
    .map((model) => ({
      id: model.id,
      name: model.name,
      productLine: model.productLine,
      outputs: model.outputs.map((output) => {
        const path = rows.find((row) => row.id === output.view.id)?.storage_path;
        return {
          ...output,
          fileName: names[index++]!,
          downloadUrl: path ? (downloads.get(path) ?? null) : null,
        };
      }),
    }))
    .filter((model) => model.outputs.length > 0);
}

export async function loadBatchCollection(
  supabase: TypedSupabaseClient,
  batchId: string,
): Promise<LibraryCollection | null> {
  const { data: batch } = await supabase
    .from("ghost_batches")
    .select("id, name, status, created_at")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return null;
  const base = {
    kind: "batch" as const,
    id: batch.id,
    name: batch.name,
    createdAt: batch.created_at,
    status: batch.status,
    studioHref: `/ghost?batch=${batch.id}`,
  };
  const [items, jobs] = await Promise.all([
    supabase
      .from("ghost_batch_items")
      .select("product_id")
      .eq("batch_id", batchId)
      .order("position"),
    supabase.from("catalogue_jobs").select("id").eq("batch_id", batchId),
  ]);
  const productIds = (items.data ?? []).map((item) => item.product_id);
  if (productIds.length === 0) return { ...base, models: [] };
  const jobIds = new Set((jobs.data ?? []).map((job) => job.id));
  const [products, rows] = await Promise.all([
    supabase.from("products").select("id, name, product_line").in("id", productIds),
    catalogueRowsOf(supabase, productIds),
  ]);
  const productById = new Map((products.data ?? []).map((product) => [product.id, product]));
  const batchRows = rows.filter((row) => row.catalogue_job_id && jobIds.has(row.catalogue_job_id));
  const models = productIds.flatMap((productId) => {
    const product = productById.get(productId);
    if (!product) return [];
    return [
      {
        id: product.id,
        name: product.name,
        productLine: product.product_line,
        rows: batchRows.filter((row) => row.product_id === productId),
      },
    ];
  });
  return { ...base, models: await finishModels(supabase, models, "oldest") };
}

/** A product's results outside ghost batches: its own catalogue runs, sheets and ad shots. */
export async function loadProductCollection(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<LibraryCollection | null> {
  const { data: product } = await supabase
    .from("products")
    .select("id, name, product_line, created_at")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return null;
  const [batchItems, jobs, rows] = await Promise.all([
    supabase.from("ghost_batch_items").select("batch_id").eq("product_id", productId),
    supabase.from("catalogue_jobs").select("id, batch_id").eq("product_id", productId),
    allRows<GenerationRow>((from, to) =>
      supabase
        .from("generations")
        .select("*")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);
  const batchIds = new Set((batchItems.data ?? []).map((item) => item.batch_id));
  const batchJobIds = new Set(
    (jobs.data ?? []).filter((job) => batchIds.has(job.batch_id)).map((job) => job.id),
  );
  const outside = rows.filter(
    (row) => !row.catalogue_job_id || !batchJobIds.has(row.catalogue_job_id),
  );
  const models = await finishModels(
    supabase,
    [{ id: product.id, name: product.name, productLine: product.product_line, rows: outside }],
    "newest",
  );
  return {
    kind: "product",
    id: product.id,
    name: product.name,
    createdAt: outside[0]?.created_at ?? product.created_at,
    status: null,
    studioHref: `/products/${product.id}`,
    models,
  };
}

export type CollectionFiles = { name: string; files: { path: string; url: string }[] };

/** The finished images of a collection, named for the archive, with fresh signed links. */
export async function collectionFiles(
  supabase: TypedSupabaseClient,
  ref: { kind: CollectionKind; id: string },
  scope: "all" | "approved",
): Promise<CollectionFiles | null> {
  const collection =
    ref.kind === "batch"
      ? await loadBatchCollection(supabase, ref.id)
      : await loadProductCollection(supabase, ref.id);
  if (!collection) return null;
  return {
    name: collection.name,
    files: collection.models.flatMap((model) =>
      model.outputs.flatMap((output) =>
        isFinishedResult(output.view) &&
        (scope === "all" || output.view.reviewStatus === "approved") &&
        output.view.url
          ? [{ path: output.fileName, url: output.view.url }]
          : [],
      ),
    ),
  };
}
