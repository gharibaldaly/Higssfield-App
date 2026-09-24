import "server-only";

import { z } from "zod";

import { detailReferences, viewReferences, type PhotoRef } from "@/lib/catalogue/references";
import { describeCatalogueStyle, parseCatalogueStyle } from "@/lib/domain/catalogue-style";
import { sellingDetails, type GarmentDna } from "@/lib/domain/garment-dna";
import type { GenerationPurpose } from "@/lib/domain/generation";
import { approvedDna } from "@/lib/dna/service";
import { AppError, toUserMessage } from "@/lib/errors";
import {
  ownerRegistry,
  promptBudget,
  referenceBudget,
  resolveModel,
} from "@/lib/generations/models";
import {
  approvedCatalogueImage,
  getGeneration,
  recordFailedGeneration,
} from "@/lib/generations/queries";
import { latestBySlot } from "@/lib/generations/side-effects";
import { submitGeneration } from "@/lib/generations/service";
import { activeProviderMode } from "@/lib/providers/higgsfield";
import { highestResolution } from "@/lib/providers/higgsfield/registry";
import type { GenerationMode, ModelSpec } from "@/lib/providers/higgsfield/types";
import { getDirectorBrain, type DirectorBrain } from "@/lib/providers/llm";
import type { GhostView, ProductBrief } from "@/lib/providers/llm/types";
import { getPhotos, getPieces, getProduct } from "@/lib/products/service";
import { getOwnerSettings } from "@/lib/settings/service";
import type {
  CatalogueJobRow,
  ColorwayRow,
  GenerationRow,
  Json,
} from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export const CATALOGUE_JOB_TYPES = ["front_back", "macro", "colorways"] as const;
export type CatalogueJobType = (typeof CATALOGUE_JOB_TYPES)[number];

export const queueJobsSchema = z.object({
  jobTypes: z.array(z.enum(CATALOGUE_JOB_TYPES)).min(1),
  productIds: z.array(z.uuid()).min(1).max(40),
  modelId: z.string().max(200).nullable(),
  /** productId → detail labels to feature (macro override). */
  macroDetails: z.record(z.string(), z.array(z.string().trim().min(1).max(200)).max(2)).optional(),
  /** productId → colourway ids (default: all colourways). */
  colorwayIds: z.record(z.string(), z.array(z.uuid())).optional(),
});

export type QueueJobsInput = z.infer<typeof queueJobsSchema>;

const jobOptionsSchema = z.object({
  macroDetails: z.array(z.string()).optional(),
  colorwayIds: z.array(z.string()).optional(),
});

type SlotPlan = {
  slot: string;
  purpose: GenerationPurpose;
  view: GhostView;
  detail: { label: string; description: string; pieceName: string } | null;
  colorway: ColorwayRow | null;
  references: { path: string; caption: string }[];
  missingReason: string | null;
};

type JobContext = {
  job: CatalogueJobRow;
  product: ProductBrief;
  dna: GarmentDna;
  photos: PhotoRef[];
  photoCaptions: Map<string, string>;
  colorways: ColorwayRow[];
  approvedFront: GenerationRow | null;
  model: ModelSpec;
  mode: GenerationMode;
  brain: DirectorBrain;
};

/** Queue jobs for one or many products. Products that are not ready are skipped with a reason. */
export async function queueCatalogueJobs(
  supabase: TypedSupabaseClient,
  ownerId: string,
  input: QueueJobsInput,
): Promise<{
  jobs: CatalogueJobRow[];
  skipped: { productId: string; jobType: CatalogueJobType; reason: string }[];
}> {
  const settings = await getOwnerSettings(supabase, ownerId);
  const registry = await ownerRegistry(settings);
  const { model } = resolveModel(registry, {
    kind: "image",
    preferredModes: ["image-to-image", "text-to-image"],
    requestedId: input.modelId,
    defaultId: settings.defaultImageModel,
  });
  const batchId = crypto.randomUUID();
  const rows: {
    batch_id: string;
    product_id: string;
    job_type: CatalogueJobType;
    model_id: string;
    options: Json;
    style: Json;
  }[] = [];
  const skipped: { productId: string; jobType: CatalogueJobType; reason: string }[] = [];

  for (const productId of input.productIds) {
    const [dna, front, colorways] = await Promise.all([
      approvedDna(supabase, productId),
      approvedCatalogueImage(supabase, productId, "ghost_front"),
      supabase.from("colorways").select("id").eq("product_id", productId),
    ]);
    for (const jobType of input.jobTypes) {
      if (!dna) {
        skipped.push({ productId, jobType, reason: "Approve the Garment DNA first." });
        continue;
      }
      const options: z.infer<typeof jobOptionsSchema> = {};
      if (jobType === "macro" && input.macroDetails?.[productId]?.length) {
        options.macroDetails = input.macroDetails[productId];
      }
      if (jobType === "colorways") {
        const available = (colorways.data ?? []).map((row) => row.id);
        const chosen =
          input.colorwayIds?.[productId]?.filter((id) => available.includes(id)) ?? available;
        if (!front) {
          skipped.push({
            productId,
            jobType,
            reason: "Approve a front image before rendering colourways.",
          });
          continue;
        }
        if (chosen.length === 0) {
          skipped.push({ productId, jobType, reason: "Add at least one colourway." });
          continue;
        }
        options.colorwayIds = chosen;
      }
      rows.push({
        batch_id: batchId,
        product_id: productId,
        job_type: jobType,
        model_id: model.id,
        options: options as Json,
        style: settings.catalogueStyle as unknown as Json,
      });
    }
  }

  if (rows.length === 0) return { jobs: [], skipped };
  const { data, error } = await supabase.from("catalogue_jobs").insert(rows).select("*");
  if (error) throw new AppError("unknown", "Could not queue the jobs.", { detail: error.message });
  return { jobs: data ?? [], skipped };
}

async function loadJobContext(
  supabase: TypedSupabaseClient,
  ownerId: string,
  job: CatalogueJobRow,
): Promise<JobContext> {
  const [product, pieces, photos, settings, dna, colorwaysResult, approvedFront] =
    await Promise.all([
      getProduct(supabase, job.product_id),
      getPieces(supabase, job.product_id),
      getPhotos(supabase, job.product_id),
      getOwnerSettings(supabase, ownerId),
      approvedDna(supabase, job.product_id),
      supabase.from("colorways").select("*").eq("product_id", job.product_id).order("position"),
      approvedCatalogueImage(supabase, job.product_id, "ghost_front"),
    ]);
  if (!dna) throw new AppError("validation", "Approve the Garment DNA first.");
  const registry = await ownerRegistry(settings);
  const { model, mode } = resolveModel(registry, {
    kind: "image",
    preferredModes: ["image-to-image", "text-to-image"],
    requestedId: job.model_id,
  });
  const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
  const photoRefs: PhotoRef[] = photos.map((photo) => ({
    id: photo.id,
    pieceId: photo.piece_id,
    piecePosition: pieceById.get(photo.piece_id)?.position ?? 1,
    kind: photo.kind,
    label: photo.label,
    storagePath: photo.storage_path,
  }));
  const photoCaptions = new Map(
    photos.map((photo) => {
      const piece = pieceById.get(photo.piece_id);
      return [
        photo.storage_path,
        `${piece ? `"${piece.name}"` : "product"} ${photo.kind}${photo.label ? ` (${photo.label})` : ""} photo`,
      ];
    }),
  );
  return {
    job,
    product: {
      name: product.name,
      productLine: product.product_line,
      notes: product.notes,
      pieces: pieces.map((piece) => ({ position: piece.position, name: piece.name })),
    },
    dna: dna.dna,
    photos: photoRefs,
    photoCaptions,
    colorways: colorwaysResult.data ?? [],
    approvedFront,
    model,
    mode,
    brain: getDirectorBrain({
      provider: settings.llmProvider,
      claudeModel: settings.claudeModel,
      geminiModel: settings.geminiModel,
    }),
  };
}

function refs(context: JobContext, photos: PhotoRef[]) {
  return photos.map((photo) => ({
    path: photo.storagePath,
    caption: context.photoCaptions.get(photo.storagePath) ?? `${photo.kind} photo`,
  }));
}

function macroDetails(context: JobContext): SlotPlan["detail"][] {
  const options = jobOptionsSchema.parse(context.job.options ?? {});
  const all = sellingDetails(context.dna);
  const labels = options.macroDetails?.length
    ? options.macroDetails
    : all.slice(0, 2).map((detail) => detail.label);
  const chosen = labels.slice(0, 2).map((label) => {
    const match = all.find((detail) => detail.label.toLowerCase() === label.toLowerCase());
    return {
      label,
      description: match?.description ?? label,
      pieceName: match?.pieceName ?? context.product.pieces[0]?.name ?? "",
    };
  });
  while (chosen.length < 2) {
    const fallback = all[chosen.length] ?? all[0];
    chosen.push({
      label: fallback?.label ?? `Detail ${chosen.length + 1}`,
      description: fallback?.description ?? "The most characteristic construction detail",
      pieceName: fallback?.pieceName ?? context.product.pieces[0]?.name ?? "",
    });
  }
  return chosen;
}

/** Which outputs a job produces, with the isolated references for each. */
export function planSlots(context: JobContext): SlotPlan[] {
  const budget = Math.max(1, referenceBudget(context.model, context.mode));
  switch (context.job.job_type) {
    case "front_back": {
      const front = viewReferences(context.photos, "front", budget);
      const back = viewReferences(context.photos, "back", budget);
      return [
        {
          slot: "front",
          purpose: "ghost_front",
          view: "front",
          detail: null,
          colorway: null,
          references: refs(context, front),
          missingReason: front.length === 0 ? "Upload a front photo, then regenerate." : null,
        },
        {
          slot: "back",
          purpose: "ghost_back",
          view: "back",
          detail: null,
          colorway: null,
          references: refs(context, back),
          missingReason: back.length === 0 ? "Upload a back photo, then regenerate." : null,
        },
      ];
    }
    case "macro":
      return macroDetails(context).map((detail, index) => {
        const piece = context.product.pieces.find(
          (candidate) => candidate.name === detail?.pieceName,
        );
        const photos = detailReferences(
          context.photos,
          {
            label: detail!.label,
            description: detail!.description,
            piecePosition: piece?.position ?? null,
          },
          budget,
        );
        return {
          slot: `macro_${index + 1}`,
          purpose: "macro" as const,
          view: "macro" as const,
          detail,
          colorway: null,
          references: refs(context, photos),
          missingReason:
            photos.length === 0 ? "Upload a detail or front photo, then regenerate." : null,
        };
      });
    case "colorways": {
      const options = jobOptionsSchema.parse(context.job.options ?? {});
      const ids = options.colorwayIds ?? context.colorways.map((colorway) => colorway.id);
      const front = context.approvedFront?.storage_path ?? null;
      return context.colorways
        .filter((colorway) => ids.includes(colorway.id))
        .map((colorway) => {
          const references = front
            ? [{ path: front, caption: "Approved catalogue front image" }]
            : [];
          if (front && colorway.swatch_path && budget >= 2) {
            references.push({
              path: colorway.swatch_path,
              caption: `Fabric swatch for ${colorway.name}`,
            });
          }
          return {
            slot: `colorway:${colorway.id}`,
            purpose: "colorway" as const,
            view: "colorway" as const,
            detail: null,
            colorway,
            references,
            missingReason: front ? null : "Approve a front image first.",
          };
        });
    }
  }
}

async function generateSlot(
  supabase: TypedSupabaseClient,
  context: JobContext,
  plan: SlotPlan,
  options: { note?: string | null; parentId?: string | null } = {},
): Promise<GenerationRow> {
  const slotLabel = plan.detail?.label ?? plan.colorway?.name ?? null;
  const base = {
    provider: activeProviderMode(),
    model_id: context.model.id,
    endpoint: context.model.endpoint,
    kind: "image" as const,
    purpose: plan.purpose,
    product_id: context.job.product_id,
    catalogue_job_id: context.job.id,
    slot: plan.slot,
    colorway_id: plan.colorway?.id ?? null,
    note: options.note ?? null,
    parent_id: options.parentId ?? null,
    params: (slotLabel ? { _meta: { slotLabel } } : {}) as Json,
  };
  const wantsReferences = context.mode === "image-to-image";
  if (plan.missingReason && (wantsReferences || plan.purpose === "colorway")) {
    return recordFailedGeneration(supabase, { ...base, prompt: "" }, plan.missingReason);
  }
  const style = parseCatalogueStyle(context.job.style);
  try {
    const built = await context.brain.buildGhostPrompt({
      product: context.product,
      dna: context.dna,
      view: plan.view,
      styleDescription: describeCatalogueStyle(style),
      detail: plan.detail,
      colorway: plan.colorway ? { name: plan.colorway.name, hex: plan.colorway.hex } : null,
      referenceCaptions: wantsReferences
        ? plan.references.map((reference) => reference.caption)
        : [],
      note: options.note ?? null,
      promptBudget: promptBudget(context.model),
    });
    return await submitGeneration(supabase, {
      purpose: plan.purpose,
      model: context.model,
      mode: context.mode,
      prompt: built.prompt,
      negativePrompt: built.negativePrompt,
      referencePaths: wantsReferences ? plan.references.map((reference) => reference.path) : [],
      aspectRatio: style.aspectRatio,
      resolution: highestResolution(context.model),
      links: {
        productId: context.job.product_id,
        catalogueJobId: context.job.id,
        slot: plan.slot,
        colorwayId: plan.colorway?.id ?? null,
        parentId: options.parentId ?? null,
      },
      note: options.note ?? null,
      meta: slotLabel ? { slotLabel } : undefined,
    });
  } catch (error) {
    return recordFailedGeneration(supabase, { ...base, prompt: "" }, toUserMessage(error));
  }
}

/**
 * Runs one queued job: builds prompts with the director brain and submits
 * every output. Claimed atomically, so two tabs cannot run the same job.
 */
export async function runCatalogueJob(
  supabase: TypedSupabaseClient,
  ownerId: string,
  jobId: string,
): Promise<CatalogueJobRow> {
  const { data: claimed } = await supabase
    .from("catalogue_jobs")
    .update({ status: "preparing", started_at: new Date().toISOString(), error: null })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) {
    const { data: current } = await supabase
      .from("catalogue_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (!current) throw new AppError("not_found", "Job not found.");
    return current;
  }

  try {
    const context = await loadJobContext(supabase, ownerId, claimed);
    const plans = planSlots(context);
    if (plans.length === 0) throw new AppError("validation", "Nothing to generate for this job.");
    await supabase.from("catalogue_jobs").update({ status: "generating" }).eq("id", jobId);
    const results: GenerationRow[] = [];
    for (const plan of plans) {
      results.push(await generateSlot(supabase, context, plan));
    }
    const allFailed = results.every((row) => row.status === "failed");
    const { data } = await supabase
      .from("catalogue_jobs")
      .update(
        allFailed
          ? {
              status: "failed",
              error: results[0]?.error ?? "Every output failed.",
              finished_at: new Date().toISOString(),
            }
          : { status: "generating" },
      )
      .eq("id", jobId)
      .select("*")
      .single();
    return data ?? claimed;
  } catch (error) {
    const { data } = await supabase
      .from("catalogue_jobs")
      .update({
        status: "failed",
        error: toUserMessage(error),
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select("*")
      .single();
    return data ?? claimed;
  }
}

/** Regenerate a single output (optionally with the owner's note). */
export async function regenerateCatalogueOutput(
  supabase: TypedSupabaseClient,
  ownerId: string,
  generationId: string,
  note: string | null,
): Promise<GenerationRow> {
  const previous = await getGeneration(supabase, generationId);
  if (!previous.catalogue_job_id || !previous.slot) {
    throw new AppError("validation", "This output does not belong to a catalogue job.");
  }
  const { data: job } = await supabase
    .from("catalogue_jobs")
    .select("*")
    .eq("id", previous.catalogue_job_id)
    .maybeSingle();
  if (!job) throw new AppError("not_found", "Job not found.");
  const context = await loadJobContext(supabase, ownerId, job);
  const plan = planSlots(context).find((candidate) => candidate.slot === previous.slot);
  if (!plan) throw new AppError("validation", "This output can no longer be regenerated.");

  await supabase.from("generations").update({ review_status: "rejected" }).eq("id", previous.id);
  await supabase
    .from("catalogue_jobs")
    .update({ status: "generating", finished_at: null })
    .eq("id", job.id);
  return generateSlot(supabase, context, plan, {
    note: note?.trim() || null,
    parentId: previous.id,
  });
}

/** Approve an output; the job is approved once every slot's latest output is. */
export async function approveCatalogueOutput(
  supabase: TypedSupabaseClient,
  generationId: string,
): Promise<void> {
  const generation = await getGeneration(supabase, generationId);
  if (generation.status !== "completed")
    throw new AppError("validation", "Only finished images can be approved.");
  await supabase
    .from("generations")
    .update({ review_status: "approved", approved_at: new Date().toISOString() })
    .eq("id", generationId);
  if (!generation.catalogue_job_id) return;
  const { data: siblings } = await supabase
    .from("generations")
    .select("id, slot, created_at, review_status")
    .eq("catalogue_job_id", generation.catalogue_job_id);
  const latest = [...latestBySlot(siblings ?? []).values()];
  if (
    latest.length > 0 &&
    latest.every((row) => row.id === generationId || row.review_status === "approved")
  ) {
    await supabase
      .from("catalogue_jobs")
      .update({ status: "approved", finished_at: new Date().toISOString() })
      .eq("id", generation.catalogue_job_id);
  }
}

export async function cancelCatalogueJob(
  supabase: TypedSupabaseClient,
  jobId: string,
): Promise<void> {
  const { error } = await supabase
    .from("catalogue_jobs")
    .update({ status: "canceled", finished_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["queued", "failed"]);
  if (error) throw new AppError("unknown", "Could not cancel the job.", { detail: error.message });
}

export async function retryCatalogueJob(
  supabase: TypedSupabaseClient,
  jobId: string,
): Promise<void> {
  const { error } = await supabase
    .from("catalogue_jobs")
    .update({ status: "queued", error: null, finished_at: null })
    .eq("id", jobId)
    .in("status", ["failed", "canceled"]);
  if (error) throw new AppError("unknown", "Could not requeue the job.", { detail: error.message });
}
