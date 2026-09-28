import "server-only";

import {
  CATALOGUE_PURPOSES,
  isPendingStatus,
  isTerminalStatus,
  waitingNoteOf,
  type GenerationPurpose,
  type WaitingNote,
  type WaitReason,
} from "@/lib/domain/generation";
import { parseCatalogueStyle } from "@/lib/domain/catalogue-style";
import { higgsfieldMaxConcurrent } from "@/lib/env";
import { AppError, toUserMessage } from "@/lib/errors";
import {
  MAX_WAIT_MS,
  pollIntervalMs,
  providerBodyFrom,
  WAIT_RETRY_MS,
  waitReasonOf,
} from "@/lib/generations/waiting";
import { webhookUrlFor } from "@/lib/generations/webhook";
import { settleLinkedRecords } from "@/lib/generations/side-effects";
import { fetchWithTimeout } from "@/lib/http/retry";
import { finishCatalogueImage, probeImage, type CatalogueCanvas } from "@/lib/images/process";
import { activeProviderMode, getProvider } from "@/lib/providers/higgsfield";
import { buildProviderInput, redactBody } from "@/lib/providers/higgsfield/registry";
import type {
  GenerationMode,
  ModelSpec,
  ProviderState,
  SubmitTarget,
} from "@/lib/providers/higgsfield/types";
import { downloadObject, signPaths, uploadObject } from "@/lib/storage/objects";
import { PROVIDER_REFERENCE_TTL_S, storagePaths } from "@/lib/storage/paths";
import type { GenerationRow, Json } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

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
 * a user-facing error, so the UI can show it next to its siblings. When
 * Higgsfield has no room (the account's concurrency limit) or turns the request
 * away for a while, the row waits in the queue and a later poll sends it.
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
  const now = new Date().toISOString();
  const waitForRoom = providerMode === "higgsfield" && !(await hasProviderRoom(supabase));
  const waiting: WaitingNote | null = waitForRoom
    ? { reason: "capacity", since: now, message: null }
    : null;
  const params = {
    ...redactBody(built.body, redactions),
    _applied: built.applied,
    _warnings: built.warnings,
    ...(input.meta ? { _meta: input.meta } : {}),
    ...(waiting ? { _waiting: waiting } : {}),
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
      // A row being sent counts against the account's limit straight away.
      submitted_at: waiting ? null : now,
      last_polled_at: waiting ? now : null,
    })
    .select("*")
    .single();
  if (error || !row) {
    throw new AppError("unknown", "Could not record the generation.", { detail: error?.message });
  }
  if (waiting) return row;
  return sendToProvider(supabase, row, input.model, built.body);
}

/**
 * Sends a recorded generation to its provider. A rejection that leaves no
 * request behind (see waitReasonOf) puts the row in the waiting room; any
 * other error fails it.
 */
async function sendToProvider(
  supabase: TypedSupabaseClient,
  row: GenerationRow,
  target: SubmitTarget,
  body: Record<string, unknown>,
): Promise<GenerationRow> {
  const provider = getProvider(row.provider);
  // The price estimate takes the same body and never blocks the submit.
  const estimating = provider.estimate
    ? provider.estimate(target, body).catch((error: unknown) => {
        console.warn("Higgsfield estimate failed", row.id, toUserMessage(error));
        return null;
      })
    : Promise.resolve(null);
  try {
    const state = await provider.submit(target, body, {
      generationId: row.id,
      webhookUrl: row.provider === "higgsfield" ? webhookUrlFor(row.id) : null,
    });
    const estimate = await estimating;
    const cost = state.cost
      ? { cost: state.cost.amount, cost_unit: state.cost.unit }
      : estimate?.usd != null
        ? { cost: estimate.usd, cost_unit: "usd" as const }
        : estimate?.credits != null
          ? { cost: estimate.credits, cost_unit: "credits" as const }
          : {};
    return await updateRow(supabase, row.id, {
      provider_request_id: state.requestId,
      provider_status_url: state.statusUrl,
      status: state.status === "completed" ? "in_progress" : state.status,
      submitted_at: new Date().toISOString(),
      poll_attempts: 0,
      params: patchParams(row.params, {
        _waiting: undefined,
        _correlationId: state.correlationId ?? undefined,
        _estimate: estimate ?? undefined,
      }),
      ...cost,
    });
  } catch (submitError) {
    const reason = row.provider === "higgsfield" ? waitReasonOf(submitError) : null;
    if (reason) return markWaiting(supabase, row, reason, submitError);
    const failed = await updateRow(supabase, row.id, {
      status: "failed",
      error: toUserMessage(submitError),
      completed_at: new Date().toISOString(),
    });
    await settleLinkedRecords(supabase, failed);
    return failed;
  }
}

/** Puts a row back in the waiting room, keeping the time it first started waiting. */
async function markWaiting(
  supabase: TypedSupabaseClient,
  row: GenerationRow,
  reason: WaitReason,
  cause: unknown,
): Promise<GenerationRow> {
  const now = new Date().toISOString();
  const note: WaitingNote = {
    reason,
    since: waitingNoteOf(row.params)?.since ?? now,
    message: toUserMessage(cause),
  };
  return updateRow(supabase, row.id, {
    status: "queued",
    submitted_at: null,
    last_polled_at: now,
    params: patchParams(row.params, { _waiting: note }),
  });
}

/**
 * Requests open at Higgsfield: accepted and not settled yet, or being sent
 * right now (claimed, no request id yet). Oldest first.
 */
async function openProviderRequests(
  supabase: TypedSupabaseClient,
  limit: number,
): Promise<GenerationRow[]> {
  const { data } = await supabase
    .from("generations")
    .select("*")
    .eq("provider", "higgsfield")
    .in("status", ["queued", "in_progress"])
    .or("provider_request_id.not.is.null,submitted_at.not.is.null")
    .order("submitted_at", { ascending: true })
    .limit(limit);
  return data ?? [];
}

/**
 * True while fewer requests are open than the account allows. With `settle`,
 * the oldest open requests are polled first, so one that finished (or was cut
 * off mid-submit) while nobody had its page open does not hold a slot.
 */
async function hasProviderRoom(
  supabase: TypedSupabaseClient,
  options: { settle?: boolean } = {},
): Promise<boolean> {
  const limit = higgsfieldMaxConcurrent();
  const open = await openProviderRequests(supabase, limit + 8);
  if (open.length < limit) return true;
  if (!options.settle) return false;
  const polled = await refreshGenerations(supabase, open.slice(0, 8), 4);
  const freed = polled.filter((row) => !isPendingStatus(row.status)).length;
  return open.length - freed < limit;
}

/**
 * Sends a waiting row when its rest is over and the account has room. The
 * row is claimed first (submitted_at), so two polls never send it twice.
 */
async function submitWaiting(
  supabase: TypedSupabaseClient,
  row: GenerationRow,
  waiting: WaitingNote,
): Promise<GenerationRow> {
  const now = Date.now();
  if (now - Date.parse(waiting.since) > MAX_WAIT_MS) {
    const failed = await updateRow(supabase, row.id, {
      status: "failed",
      error: `Higgsfield did not take this request within 6 hours. ${waiting.message ?? ""}`.trim(),
      completed_at: new Date(now).toISOString(),
      params: patchParams(row.params, { _waiting: undefined }),
    });
    await settleLinkedRecords(supabase, failed);
    return failed;
  }
  if (row.last_polled_at && now - Date.parse(row.last_polled_at) < WAIT_RETRY_MS[waiting.reason]) {
    return row;
  }
  // Keys removed or mock mode forced: keep waiting until Higgsfield is back.
  if (activeProviderMode() !== "higgsfield") return row;
  if (!(await hasProviderRoom(supabase, { settle: true }))) {
    await supabase
      .from("generations")
      .update({ last_polled_at: new Date(now).toISOString() })
      .eq("id", row.id);
    return row;
  }

  const { data: claimed } = await supabase
    .from("generations")
    .update({
      submitted_at: new Date(now).toISOString(),
      last_polled_at: new Date(now).toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "queued")
    .is("provider_request_id", null)
    .is("submitted_at", null)
    .select("*")
    .maybeSingle();
  if (!claimed) return row;

  let body: Record<string, unknown>;
  try {
    const signed = await signPaths(supabase, claimed.reference_paths, {
      expiresIn: PROVIDER_REFERENCE_TTL_S,
    });
    body = providerBodyFrom(claimed.params, (path) => signed.get(path));
  } catch (error) {
    const failed = await updateRow(supabase, claimed.id, {
      status: "failed",
      error: toUserMessage(error),
      completed_at: new Date().toISOString(),
    });
    await settleLinkedRecords(supabase, failed);
    return failed;
  }
  return sendToProvider(
    supabase,
    claimed,
    { endpoint: claimed.endpoint, kind: claimed.kind },
    body,
  );
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

/** The docs' generic failure text, which adds nothing to the status itself. */
const GENERIC_FAILURE = /^generation failed\.?$/i;

export function failureMessage(state: ProviderState): string {
  if (state.status === "nsfw") {
    return "The provider's content filter rejected this result (credits are refunded). Try neutral wording or a tighter reference crop.";
  }
  if (state.status === "canceled") return "The request was canceled.";
  // The request id lets Higgsfield support find the request.
  const request = state.requestId ? ` [request ${state.requestId}]` : "";
  const reason = state.error && !GENERIC_FAILURE.test(state.error.trim()) ? state.error : null;
  return reason
    ? `Generation failed: ${reason}${request}`
    : `Higgsfield could not make this and gave no reason (nothing is charged). Try again, or choose another model.${request}`;
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
): Promise<CatalogueCanvas | null> {
  if (!CATALOGUE_PURPOSES.includes(row.purpose) || !row.catalogue_job_id) return null;
  const { data } = await supabase
    .from("catalogue_jobs")
    .select("style")
    .eq("id", row.catalogue_job_id)
    .maybeSingle();
  if (!data) return null;
  const style = parseCatalogueStyle(data.style);
  return {
    aspectRatio: style.aspectRatio,
    background: style.background,
    paddingPercent: style.paddingPercent,
    // Close-ups fill the frame on purpose; only whole-garment views are reframed.
    reframe: row.purpose !== "macro",
  };
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
  let finish: Record<string, Json> | null = null;
  const image = await probeImage(data);
  if (image) {
    mimeType = image.mimeType;
    width = image.width;
    height = image.height;
    const canvas = await catalogueCanvasFor(supabase, row);
    if (canvas) {
      const finished = await finishCatalogueImage(data, canvas);
      finish = {
        reframed: finished.reframed,
        edgeColour: finished.edgeColour,
        backgroundOk: finished.backgroundOk,
      };
      if (finished.changed) {
        data = finished.data;
        mimeType = "image/png";
        width = finished.width;
        height = finished.height;
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
    ...(finish ? { params: { ...paramsObject(row.params), _finish: finish } } : {}),
    ...(state.cost ? { cost: state.cost.amount, cost_unit: state.cost.unit } : {}),
  });
}

function paramsObject(params: Json): Record<string, Json | undefined> {
  return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}

/** Sets (or, with undefined, removes) the app's own keys in a generation's params. */
function patchParams(params: Json, patch: Record<string, Json | undefined>): Json {
  const next = { ...paramsObject(params) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
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
  if (!row.provider_request_id) {
    const waiting = waitingNoteOf(row.params);
    if (waiting && !row.submitted_at && row.provider === "higgsfield") {
      return submitWaiting(supabase, row, waiting);
    }
    // Sent (or being sent) but never confirmed: the run was cut off mid-submit.
    if (now - Date.parse(row.submitted_at ?? row.created_at) > STALE_SUBMIT_MS) {
      const failed = await updateRow(supabase, row.id, {
        status: "failed",
        error: "The request was cut off before the provider confirmed it. Regenerate to try again.",
        completed_at: new Date().toISOString(),
      });
      await settleLinkedRecords(supabase, failed);
      return failed;
    }
    return row;
  }

  // The docs' polling cadence: 2 s at first, easing out to 10 s.
  const interval = pollIntervalMs(row.poll_attempts);
  if (!options.force && row.last_polled_at && now - Date.parse(row.last_polled_at) < interval) {
    return row;
  }
  const threshold = new Date(now - interval).toISOString();
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
      statusUrl: claimed.provider_status_url,
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
        // Failed, filtered and canceled requests are not charged (docs: Billing and retention).
        ...(claimed.cost !== null ? { cost: 0 } : {}),
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
