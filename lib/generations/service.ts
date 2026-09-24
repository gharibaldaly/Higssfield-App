import "server-only";

import {
  CATALOGUE_PURPOSES,
  isTerminalStatus,
  type GenerationPurpose,
} from "@/lib/domain/generation";
import { parseCatalogueStyle } from "@/lib/domain/catalogue-style";
import { AppError, toUserMessage } from "@/lib/errors";
import { webhookUrlFor } from "@/lib/generations/webhook";
import { settleLinkedRecords } from "@/lib/generations/side-effects";
import { fetchWithTimeout } from "@/lib/http/retry";
import { fitToCanvas, probeImage } from "@/lib/images/process";
import { activeProviderMode, getProvider } from "@/lib/providers/higgsfield";
import { buildProviderInput, redactBody } from "@/lib/providers/higgsfield/registry";
import type { GenerationMode, ModelSpec, ProviderState } from "@/lib/providers/higgsfield/types";
import { downloadObject, signPaths, uploadObject } from "@/lib/storage/objects";
import { PROVIDER_REFERENCE_TTL_S, storagePaths } from "@/lib/storage/paths";
import type { GenerationRow, Json } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

const POLL_THROTTLE_MS = 3000;
const STALE_SUBMIT_MS = 2 * 60 * 1000;
const MAX_PENDING_MS = 45 * 60 * 1000;
const MAX_RESULT_BYTES = 250 * 1024 * 1024;

export type GenerationLinks = {
  productId?: string | null;
  colorwayId?: string | null;
  catalogueJobId?: string | null;
  slot?: string | null;
  sheetId?: string | null;
  adProjectId?: string | null;
  shotId?: string | null;
  parentId?: string | null;
};

export type SubmitGenerationInput = {
  purpose: GenerationPurpose;
  model: ModelSpec;
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string | null;
  /** Storage paths of the isolated reference images (never whole sheets). */
  referencePaths: string[];
  aspectRatio?: string | null;
  resolution?: string | null;
  durationS?: number | null;
  links?: GenerationLinks;
  note?: string | null;
  /** Extra display metadata stored with the request (e.g. { slotLabel }). */
  meta?: Record<string, unknown>;
};

/**
 * Creates the generation row, then submits it to the provider. The row is
 * always returned — on provider errors it comes back with status "failed" and
 * a user-facing error, so the UI can show it next to its siblings.
 */
export async function submitGeneration(
  supabase: TypedSupabaseClient,
  input: SubmitGenerationInput,
): Promise<GenerationRow> {
  const providerMode = activeProviderMode();
  if (input.model.source === "mock" && providerMode !== "mock") {
    throw new AppError(
      "validation",
      "Mock models are only available while Higgsfield is not configured.",
    );
  }
  const signed = await signPaths(supabase, input.referencePaths, {
    expiresIn: PROVIDER_REFERENCE_TTL_S,
  });
  const referenceUrls = input.referencePaths
    .map((path) => signed.get(path))
    .filter((url): url is string => Boolean(url));
  if (referenceUrls.length !== input.referencePaths.length) {
    throw new AppError("not_found", "A reference image could not be read from storage.");
  }

  const built = buildProviderInput(input.model, {
    mode: input.mode,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    referenceUrls,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    durationS: input.durationS,
  });

  // Store the request with storage paths instead of short-lived signed URLs.
  const redactions = new Map(
    input.referencePaths.map((path) => [signed.get(path)!, `storage:${path}`] as const),
  );
  const params = {
    ...redactBody(built.body, redactions),
    _applied: built.applied,
    _warnings: built.warnings,
    ...(input.meta ? { _meta: input.meta } : {}),
  };

  const links = input.links ?? {};
  const { data: row, error } = await supabase
    .from("generations")
    .insert({
      provider: providerMode,
      model_id: input.model.id,
      endpoint: input.model.endpoint,
      kind: input.model.kind,
      purpose: input.purpose,
      status: "queued",
      prompt: input.prompt,
      params: params as Json,
      reference_paths: input.referencePaths,
      note: input.note ?? null,
      product_id: links.productId ?? null,
      colorway_id: links.colorwayId ?? null,
      catalogue_job_id: links.catalogueJobId ?? null,
      slot: links.slot ?? null,
      sheet_id: links.sheetId ?? null,
      ad_project_id: links.adProjectId ?? null,
      shot_id: links.shotId ?? null,
      parent_id: links.parentId ?? null,
      duration_s: built.applied.durationS,
    })
    .select("*")
    .single();
  if (error || !row) {
    throw new AppError("unknown", "Could not record the generation.", { detail: error?.message });
  }

  try {
    const provider = getProvider(providerMode);
    const state = await provider.submit(input.model, built.body, {
      generationId: row.id,
      webhookUrl: providerMode === "higgsfield" ? webhookUrlFor(row.id) : null,
    });
    return await updateRow(supabase, row.id, {
      provider_request_id: state.requestId,
      provider_status_url: state.statusUrl,
      status: state.status === "completed" ? "in_progress" : state.status,
      submitted_at: new Date().toISOString(),
      ...(state.cost ? { cost: state.cost.amount, cost_unit: state.cost.unit } : {}),
    });
  } catch (submitError) {
    const failed = await updateRow(supabase, row.id, {
      status: "failed",
      error: toUserMessage(submitError),
      completed_at: new Date().toISOString(),
    });
    await settleLinkedRecords(supabase, failed);
    return failed;
  }
}

async function updateRow(
  supabase: TypedSupabaseClient,
  id: string,
  patch: Partial<GenerationRow>,
): Promise<GenerationRow> {
  const { data, error } = await supabase
    .from("generations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError("unknown", "Could not update the generation.", { detail: error?.message });
  }
  return data;
}

function failureMessage(state: ProviderState): string {
  if (state.status === "nsfw") {
    return "The provider's content filter rejected this result (credits are refunded). Try neutral wording or a tighter reference crop.";
  }
  if (state.status === "canceled") return "The request was canceled.";
  return state.error
    ? `Generation failed: ${state.error}`
    : "Generation failed at the provider (credits are refunded). Try again.";
}

async function downloadResult(url: string): Promise<{ data: Buffer; mimeType: string | null }> {
  const response = await fetchWithTimeout(url, { timeoutMs: 180_000, cache: "no-store" });
  if (!response.ok) {
    throw new AppError(
      "provider_unavailable",
      `Could not download the result (HTTP ${response.status}).`,
      {
        retryable: true,
      },
    );
  }
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_RESULT_BYTES) {
    throw new AppError("provider_bad_input", "The result file is too large to store.");
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_RESULT_BYTES) {
    throw new AppError("provider_bad_input", "The result file is too large to store.");
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
  return { data, mimeType };
}

async function catalogueCanvasFor(
  supabase: TypedSupabaseClient,
  row: GenerationRow,
): Promise<{ aspectRatio: string; background: string } | null> {
  if (!CATALOGUE_PURPOSES.includes(row.purpose) || !row.catalogue_job_id) return null;
  const { data } = await supabase
    .from("catalogue_jobs")
    .select("style")
    .eq("id", row.catalogue_job_id)
    .maybeSingle();
  if (!data) return null;
  const style = parseCatalogueStyle(data.style);
  return { aspectRatio: style.aspectRatio, background: style.background };
}

/**
 * Copies a finished result into Supabase Storage right away (provider URLs
 * expire) and records metadata. Catalogue images are padded to the catalogue
 * aspect ratio with the catalogue background, without resampling the garment.
 */
async function finalizeCompleted(
  supabase: TypedSupabaseClient,
  row: GenerationRow,
  state: ProviderState,
): Promise<GenerationRow> {
  let data: Buffer;
  let mimeType: string | null;
  if (state.resultBuffer) {
    data = state.resultBuffer.data;
    mimeType = state.resultBuffer.mimeType;
  } else {
    const url = state.resultUrls[0];
    if (!url) {
      return updateRow(supabase, row.id, {
        status: "failed",
        error: "The provider reported success but returned no file.",
        completed_at: new Date().toISOString(),
      });
    }
    ({ data, mimeType } = await downloadResult(url));
  }

  let width: number | null = null;
  let height: number | null = null;
  const image = await probeImage(data);
  if (image) {
    mimeType = image.mimeType;
    width = image.width;
    height = image.height;
    const canvas = await catalogueCanvasFor(supabase, row);
    if (canvas) {
      const fitted = await fitToCanvas(data, canvas);
      if (fitted.changed) {
        data = fitted.data;
        mimeType = "image/png";
        width = fitted.width;
        height = fitted.height;
      }
    }
  } else if (!mimeType || !mimeType.startsWith("video/")) {
    mimeType = row.kind === "video" ? "video/mp4" : "application/octet-stream";
  }

  const path = storagePaths.generation(row.owner_id, row.id, mimeType);
  await uploadObject(supabase, path, data, mimeType);
  return updateRow(supabase, row.id, {
    status: "completed",
    storage_path: path,
    mime_type: mimeType,
    width,
    height,
    provider_result_url: state.resultUrls[0] ?? null,
    completed_at: new Date().toISOString(),
    error: null,
    ...(state.cost ? { cost: state.cost.amount, cost_unit: state.cost.unit } : {}),
  });
}

/**
 * Polls the provider for one generation and settles it when finished.
 * Safe to call from many places at once: a conditional update "claims" the
 * poll so only one caller talks to the provider per throttle window.
 */
export async function refreshGeneration(
  supabase: TypedSupabaseClient,
  row: GenerationRow,
  options: { force?: boolean } = {},
): Promise<GenerationRow> {
  if (isTerminalStatus(row.status)) return row;

  const now = Date.now();
  const createdAt = Date.parse(row.created_at);
  if (!row.provider_request_id) {
    if (now - createdAt > STALE_SUBMIT_MS) {
      const failed = await updateRow(supabase, row.id, {
        status: "failed",
        error: "The request never reached the provider. Regenerate to try again.",
        completed_at: new Date().toISOString(),
      });
      await settleLinkedRecords(supabase, failed);
      return failed;
    }
    return row;
  }

  if (
    !options.force &&
    row.last_polled_at &&
    now - Date.parse(row.last_polled_at) < POLL_THROTTLE_MS
  ) {
    return row;
  }
  const threshold = new Date(now - POLL_THROTTLE_MS).toISOString();
  const claimQuery = supabase
    .from("generations")
    .update({ last_polled_at: new Date(now).toISOString(), poll_attempts: row.poll_attempts + 1 })
    .eq("id", row.id)
    .in("status", ["queued", "in_progress"]);
  const { data: claimed } = await (
    options.force
      ? claimQuery
      : claimQuery.or(`last_polled_at.is.null,last_polled_at.lt.${threshold}`)
  )
    .select("*")
    .maybeSingle();
  if (!claimed) return row;

  try {
    const provider = getProvider(claimed.provider);
    const state = await provider.getStatus(claimed.provider_request_id!, {
      generationId: claimed.id,
      submittedAt: claimed.submitted_at,
      kind: claimed.kind,
      params: (claimed.params ?? {}) as Record<string, unknown>,
      loadReference: async () =>
        claimed.reference_paths[0] ? downloadObject(supabase, claimed.reference_paths[0]) : null,
    });

    let settled: GenerationRow;
    if (state.status === "completed") {
      settled = await finalizeCompleted(supabase, claimed, state);
    } else if (
      state.status === "failed" ||
      state.status === "nsfw" ||
      state.status === "canceled"
    ) {
      settled = await updateRow(supabase, claimed.id, {
        status: state.status,
        error: failureMessage(state),
        completed_at: new Date().toISOString(),
      });
    } else if (now - Date.parse(claimed.submitted_at ?? claimed.created_at) > MAX_PENDING_MS) {
      settled = await updateRow(supabase, claimed.id, {
        status: "failed",
        error: "The provider did not finish within 45 minutes. Regenerate to try again.",
        completed_at: new Date().toISOString(),
      });
    } else {
      return state.status === claimed.status
        ? claimed
        : updateRow(supabase, claimed.id, { status: state.status });
    }
    await settleLinkedRecords(supabase, settled);
    return settled;
  } catch (error) {
    // Transient polling problems keep the row pending; the next poll retries.
    if (error instanceof AppError && error.retryable) return claimed;
    if (
      error instanceof AppError &&
      (error.code === "not_found" || error.code === "provider_auth")
    ) {
      const failed = await updateRow(supabase, claimed.id, {
        status: "failed",
        error: toUserMessage(error),
        completed_at: new Date().toISOString(),
      });
      await settleLinkedRecords(supabase, failed);
      return failed;
    }
    console.error("Generation refresh failed", claimed.id, error);
    return claimed;
  }
}

/** Refresh several pending generations with bounded concurrency. */
export async function refreshGenerations(
  supabase: TypedSupabaseClient,
  rows: GenerationRow[],
  concurrency = 4,
): Promise<GenerationRow[]> {
  const results = [...rows];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await refreshGeneration(supabase, rows[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
}
