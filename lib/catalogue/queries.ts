import "server-only";

import { DEFAULT_CATALOGUE_STYLE } from "@/lib/domain/catalogue-style";
import { garmentDnaSchema, sellingDetails } from "@/lib/domain/garment-dna";
import { slotLabelOf, type GenerationView } from "@/lib/domain/generation";
import { outerPositionOf } from "@/lib/ghost-batches/plan";
import { latestBySlot } from "@/lib/generations/side-effects";
import { toViews } from "@/lib/generations/queries";
import { signPaths } from "@/lib/storage/objects";
import type { CatalogueJobRow, GenerationRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export type GhostProduct = {
  id: string;
  name: string;
  productLine: string;
  hasDna: boolean;
  hasFront: boolean;
  colorways: { id: string; name: string; hex: string }[];
  details: string[];
  /** The product's pieces, so a set can name the one worn as an outer layer. */
  pieces: { position: number; name: string }[];
};

export type GhostOutput = {
  slot: string;
  slotLabel: string | null;
  generation: GenerationView;
  beforeUrl: string | null;
  attempts: number;
};

export type GhostJob = {
  id: string;
  batchId: string;
  productId: string;
  productName: string;
  jobType: CatalogueJobRow["job_type"];
  status: CatalogueJobRow["status"];
  error: string | null;
  createdAt: string;
  background: string;
  /** A robe set's job: it also renders the front without the robe. */
  innerFront: boolean;
  outputs: GhostOutput[];
};

const SLOT_ORDER = (slot: string) =>
  slot === "front"
    ? 0
    : slot === "front_inner"
      ? 1
      : slot === "back"
        ? 2
        : slot.startsWith("macro")
          ? 3
          : 4;

/** Latest output per slot of one job's generations, in catalogue order. */
export function outputsFor(
  jobGenerations: GenerationRow[],
  views: Map<string, GenerationView>,
  beforeUrls: Map<string, string>,
): GhostOutput[] {
  const latest = [...latestBySlot(jobGenerations).values()].sort(
    (a, b) =>
      SLOT_ORDER(a.slot ?? "") - SLOT_ORDER(b.slot ?? "") ||
      (a.slot ?? "").localeCompare(b.slot ?? ""),
  );
  return latest.map((row) => ({
    slot: row.slot ?? row.id,
    slotLabel: slotLabelOf(row.params),
    generation: views.get(row.id)!,
    beforeUrl: row.reference_paths[0] ? (beforeUrls.get(row.reference_paths[0]) ?? null) : null,
    attempts: jobGenerations.filter((candidate) => candidate.slot === row.slot).length,
  }));
}

export async function loadGhostStudio(supabase: TypedSupabaseClient): Promise<{
  products: GhostProduct[];
  jobs: GhostJob[];
}> {
  const [products, dnaRows, fronts, colorways, jobs, pieces] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, product_line, approved_dna_id")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("garment_dna").select("product_id, data").eq("status", "approved"),
    // The front with the robe on; a robe set's inner front never starts colours.
    supabase
      .from("generations")
      .select("product_id")
      .eq("purpose", "ghost_front")
      .eq("slot", "front")
      .eq("review_status", "approved"),
    supabase.from("colorways").select("id, product_id, name, hex").order("position"),
    supabase.from("catalogue_jobs").select("*").order("created_at", { ascending: false }).limit(40),
    supabase.from("product_pieces").select("product_id, position, name").order("position"),
  ]);

  const dnaByProduct = new Map<string, string[]>();
  for (const row of dnaRows.data ?? []) {
    const parsed = garmentDnaSchema.safeParse(row.data);
    if (parsed.success)
      dnaByProduct.set(
        row.product_id,
        sellingDetails(parsed.data).map((detail) => detail.label),
      );
  }
  const withFront = new Set((fronts.data ?? []).map((row) => row.product_id).filter(Boolean));
  const productNames = new Map((products.data ?? []).map((product) => [product.id, product.name]));

  const ghostProducts: GhostProduct[] = (products.data ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    productLine: product.product_line,
    hasDna: Boolean(product.approved_dna_id),
    hasFront: withFront.has(product.id),
    colorways: (colorways.data ?? [])
      .filter((colorway) => colorway.product_id === product.id)
      .map((colorway) => ({ id: colorway.id, name: colorway.name, hex: colorway.hex })),
    details: dnaByProduct.get(product.id) ?? [],
    pieces: (pieces.data ?? [])
      .filter((piece) => piece.product_id === product.id)
      .map((piece) => ({ position: piece.position, name: piece.name })),
  }));

  const jobRows = jobs.data ?? [];
  const jobIds = jobRows.map((job) => job.id);
  const { data: generations } = jobIds.length
    ? await supabase.from("generations").select("*").in("catalogue_job_id", jobIds)
    : { data: [] as GenerationRow[] };
  const rows = generations ?? [];
  const views = new Map((await toViews(supabase, rows)).map((view) => [view.id, view]));
  const beforeUrls = await signPaths(
    supabase,
    rows.map((row) => row.reference_paths[0] ?? null),
  );

  const ghostJobs: GhostJob[] = jobRows.map((job) => {
    const jobGenerations = rows.filter((row) => row.catalogue_job_id === job.id);
    const style = job.style as { background?: string } | null;
    return {
      id: job.id,
      batchId: job.batch_id,
      productId: job.product_id,
      productName: productNames.get(job.product_id) ?? "",
      jobType: job.job_type,
      status: job.status,
      error: job.error,
      createdAt: job.created_at,
      background:
        typeof style?.background === "string"
          ? style.background
          : DEFAULT_CATALOGUE_STYLE.background,
      innerFront: job.job_type === "front_back" && outerPositionOf(job.options) !== null,
      outputs: outputsFor(jobGenerations, views, beforeUrls),
    };
  });

  return { products: ghostProducts, jobs: ghostJobs };
}
