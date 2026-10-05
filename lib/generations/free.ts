import "server-only";

import { toGenerationView, type GenerationView } from "@/lib/domain/generation";
import { AppError } from "@/lib/errors";
import {
  appliedOf,
  freeMetaOf,
  planFreeRequest,
  type FreeKind,
  type FreeRequest,
} from "@/lib/generations/free-plan";
import { ownerRegistry } from "@/lib/generations/models";
import { submitGeneration } from "@/lib/generations/service";
import { toLlmImage } from "@/lib/images/process";
import { requireHiggsfieldKey } from "@/lib/providers/higgsfield";
import type { ModelSpec } from "@/lib/providers/higgsfield/types";
import { getDirectorBrain } from "@/lib/providers/llm";
import type { PolishedPrompt } from "@/lib/providers/llm/types";
import type { OwnerSettings } from "@/lib/settings/service";
import { storageImageHost } from "@/lib/storage/brain-links";
import { downloadObject, signPaths } from "@/lib/storage/objects";
import { isOwnedPath } from "@/lib/storage/paths";
import type { GenerationRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** How many past free generations the page opens with. */
export const FREE_HISTORY_LIMIT = 48;

/** A free generation as the page shows it: the result and what was asked for. */
export type FreeItem = {
  view: GenerationView;
  prompt: string;
  negativePrompt: string | null;
  modelLabel: string;
  aspectRatio: string | null;
  resolution: string | null;
  durationS: number | null;
  /** Signed links to the references that were sent, for the thumbnails. */
  referenceUrls: string[];
  referencePaths: string[];
  /** Shared by the outputs of one click. */
  batch: string | null;
  downloadUrl: string | null;
};

function requireOwnedPaths(paths: string[], ownerId: string): void {
  if (paths.some((path) => !isOwnedPath(path, ownerId))) {
    throw new AppError("validation", "A reference image could not be read from storage.");
  }
}

/**
 * Submits the owner's prompt as it is, `count` times, each as its own
 * generation. The rows carry the studio's meta so the page can list them;
 * they belong to no product, job or project.
 */
export async function submitFreeRequest(
  supabase: TypedSupabaseClient,
  ownerId: string,
  settings: OwnerSettings,
  request: FreeRequest,
): Promise<{ items: FreeItem[]; warnings: string[] }> {
  requireOwnedPaths(request.referencePaths, ownerId);
  const registry = await ownerRegistry(settings);
  const model = registry.find((spec) => spec.id === request.modelId);
  if (!model) throw new AppError("validation", `Model "${request.modelId}" is not available.`);
  const plan = planFreeRequest(model, request);
  await requireHiggsfieldKey();

  const batch = crypto.randomUUID();
  const negativePrompt = request.negativePrompt?.trim() || null;
  const rows: GenerationRow[] = [];
  for (let index = 0; index < plan.count; index += 1) {
    rows.push(
      await submitGeneration(supabase, {
        purpose: "other",
        model,
        mode: plan.mode,
        prompt: request.prompt.trim(),
        negativePrompt,
        referencePaths: plan.referencePaths,
        aspectRatio: plan.aspectRatio,
        resolution: plan.resolution,
        durationS: plan.durationS,
        meta: { studio: "free", batch, index, count: plan.count, negativePrompt },
      }),
    );
  }
  return { items: await toFreeItems(supabase, rows, registry), warnings: plan.warnings };
}

/** The owner's free generations, newest first. */
export async function listFreeGenerations(
  supabase: TypedSupabaseClient,
  settings: OwnerSettings,
  kind?: FreeKind,
): Promise<FreeItem[]> {
  let query = supabase
    .from("generations")
    .select("*")
    .eq("purpose", "other")
    .is("product_id", null)
    .is("ad_project_id", null)
    .order("created_at", { ascending: false })
    .limit(FREE_HISTORY_LIMIT);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  if (error) {
    throw new AppError("unknown", "Could not load the free generations.", {
      detail: error.message,
    });
  }
  const rows = (data ?? []).filter((row) => freeMetaOf(row.params) !== null);
  return toFreeItems(supabase, rows, await ownerRegistry(settings));
}

export async function toFreeItems(
  supabase: TypedSupabaseClient,
  rows: GenerationRow[],
  registry: ModelSpec[],
): Promise<FreeItem[]> {
  const referencePaths = rows.flatMap((row) => row.reference_paths);
  const resultPaths = rows.map((row) => row.storage_path);
  const [references, results, downloads] = await Promise.all([
    signPaths(supabase, referencePaths),
    signPaths(supabase, resultPaths),
    signPaths(supabase, resultPaths, { download: true }),
  ]);
  const labels = new Map(registry.map((spec) => [spec.id, spec.label]));
  return rows.map((row) => {
    const meta = freeMetaOf(row.params);
    const applied = appliedOf(row.params);
    const url = row.storage_path ? (results.get(row.storage_path) ?? null) : null;
    return {
      view: toGenerationView(row, url),
      prompt: row.prompt,
      negativePrompt: meta?.negativePrompt ?? null,
      modelLabel: labels.get(row.model_id) ?? row.model_id,
      aspectRatio: applied.aspectRatio,
      resolution: applied.resolution,
      durationS: applied.durationS ?? row.duration_s,
      referenceUrls: row.reference_paths
        .map((path) => references.get(path))
        .filter((link): link is string => Boolean(link)),
      referencePaths: row.reference_paths,
      batch: meta?.batch ?? null,
      downloadUrl: row.storage_path ? (downloads.get(row.storage_path) ?? null) : null,
    };
  });
}

/** References the brain looks at while polishing; more would only slow it down. */
const POLISH_REFERENCE_LIMIT = 4;

/**
 * Asks the director brain to polish the owner's prompt. The brain sees the
 * first references so it can name them; the answer is a suggestion the
 * owner reviews in the prompt box before generating.
 */
export async function polishFreePrompt(
  supabase: TypedSupabaseClient,
  ownerId: string,
  settings: OwnerSettings,
  input: {
    kind: FreeKind;
    prompt: string;
    modelLabel: string;
    referencePaths: string[];
    locale: "ar" | "en";
  },
): Promise<PolishedPrompt & { provider: string; model: string }> {
  requireOwnedPaths(input.referencePaths, ownerId);
  const references = await Promise.all(
    input.referencePaths.slice(0, POLISH_REFERENCE_LIMIT).map(async (path, index) =>
      toLlmImage(await downloadObject(supabase, path), `Reference ${index + 1}`, {
        longEdge: 1024,
      }),
    ),
  );
  const brain = getDirectorBrain(settings, { imageHost: storageImageHost(supabase, ownerId) });
  const polished = await brain.polishPrompt({
    kind: input.kind,
    prompt: input.prompt,
    modelLabel: input.modelLabel,
    references,
    locale: input.locale,
  });
  return { ...polished, provider: brain.provider, model: brain.model };
}
