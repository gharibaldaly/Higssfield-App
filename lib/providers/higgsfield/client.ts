import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import {
  failedBeforeSending,
  fetchWithTimeout,
  RETRYABLE_STATUS,
  withRetry,
} from "@/lib/http/retry";
import type {
  ImageVideoProvider,
  ProviderEstimate,
  ProviderState,
  ProviderStatus,
  StatusContext,
  SubmitContext,
  SubmitTarget,
} from "@/lib/providers/higgsfield/types";

/**
 * Higgsfield HTTP client, following the official API docs (docs.higgsfield.ai,
 * API 2.0.0: requests, polling, webhooks, file uploads, errors, rate limits):
 *   - base URL   https://api.higgsfield.ai
 *   - auth       Authorization: Key {api_key_id}:{api_key_secret}
 *   - submit     POST /{model endpoint}, body = the model's JSON parameters,
 *                optional ?hf_webhook=<https url>; answers
 *                { status, request_id, status_url, cancel_url }
 *   - status     GET the status_url from the submit (/requests/{id}/status)
 *   - cancel     POST /requests/{id}/cancel: 202, or 400 once processing started
 *   - estimate   POST /estimate/{model endpoint} with the same body → { credits, usd }
 *   - upload     POST /files/generate-upload-url {content_type}, then PUT with upload_headers
 *   - statuses   queued | in_progress | completed | failed | nsfw | canceled
 *   - results    images: [{url}] or video: {url}, kept for at least seven days
 *   - errors     FastAPI {detail}; every response carries X-Correlation-ID
 * Each model's endpoint and parameters come from that model's own docs page.
 */

export const DEFAULT_HIGGSFIELD_BASE_URL = "https://api.higgsfield.ai";

const requestStateSchema = z
  .object({
    status: z.string(),
    request_id: z.string(),
    status_url: z.string().nullish(),
    cancel_url: z.string().nullish(),
    images: z.array(z.object({ url: z.string() }).passthrough()).nullish(),
    video: z.object({ url: z.string() }).passthrough().nullish(),
  })
  .passthrough();

type RawRequestState = z.infer<typeof requestStateSchema>;

const STATUS_MAP: Record<string, ProviderStatus> = {
  queued: "queued",
  pending: "queued",
  in_progress: "in_progress",
  processing: "in_progress",
  running: "in_progress",
  completed: "completed",
  succeeded: "completed",
  failed: "failed",
  error: "failed",
  nsfw: "nsfw",
  canceled: "canceled",
  cancelled: "canceled",
};

export function normalizeStatus(value: string): ProviderStatus {
  return STATUS_MAP[value.toLowerCase()] ?? "in_progress";
}

const COST_KEYS: [string, "usd" | "credits"][] = [
  ["cost_usd", "usd"],
  ["price_usd", "usd"],
  ["cost", "usd"],
  ["price", "usd"],
  ["credits_used", "credits"],
  ["credits", "credits"],
];

/** The documented status response has no cost field; record one only if present. */
export function extractCost(raw: Record<string, unknown>): ProviderState["cost"] {
  for (const [key, unit] of COST_KEYS) {
    const value = raw[key];
    const amount =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(amount) && amount >= 0) return { amount, unit };
  }
  return null;
}

function extractError(raw: Record<string, unknown>): string | null {
  for (const key of ["error", "detail", "message", "failure_reason"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (
      value &&
      typeof value === "object" &&
      "message" in value &&
      typeof value.message === "string"
    ) {
      return value.message;
    }
  }
  return null;
}

export function toProviderState(raw: RawRequestState): ProviderState {
  const status = normalizeStatus(raw.status);
  const imageUrls = (raw.images ?? []).map((image) => image.url).filter(Boolean);
  const videoUrl = raw.video?.url ?? null;
  return {
    requestId: raw.request_id,
    status,
    statusUrl: raw.status_url ?? null,
    resultUrls: videoUrl ? [videoUrl] : imageUrls,
    resultKind: videoUrl ? "video" : imageUrls.length > 0 ? "image" : null,
    cost: extractCost(raw),
    error: status === "failed" || status === "nsfw" ? extractError(raw) : null,
  };
}

function decimal(value: unknown): number | null {
  const amount =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Reads an estimate response ({ credits: "1.500", usd: "0.094" }). */
export function parseEstimate(payload: unknown): ProviderEstimate | null {
  if (!payload || typeof payload !== "object") return null;
  const { usd, credits } = payload as Record<string, unknown>;
  const estimate = { usd: decimal(usd), credits: decimal(credits) };
  return estimate.usd === null && estimate.credits === null ? null : estimate;
}

/** FastAPI-style `detail` can be a string or a list of {loc, msg}. */
function detailMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const detail =
    (payload as Record<string, unknown>).detail ?? (payload as Record<string, unknown>).message;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const loc = Array.isArray((item as { loc?: unknown }).loc)
            ? (item as { loc: unknown[] }).loc.slice(1).join(".") || "input"
            : "input";
          return `${loc}: ${String((item as { msg: unknown }).msg)}`;
        }
        return String(item);
      })
      .join("; ");
  }
  return undefined;
}

/** The docs report the account's concurrency limit as a 400 with this message. */
const CONCURRENCY_LIMIT = /concurrent requests/i;

/** Maps an error response to a user-facing error, per the docs' error table. */
export async function higgsfieldError(response: Response): Promise<AppError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error body.
  }
  const detail = detailMessage(payload);
  const status = response.status;
  const reference = response.headers.get("x-correlation-id") ?? undefined;
  const base = { detail, status, reference };
  switch (status) {
    case 400:
      // Only the message tells the concurrency limit apart from invalid input.
      if (detail && CONCURRENCY_LIMIT.test(detail)) {
        return new AppError(
          "provider_busy",
          "Higgsfield is already running as many requests as this account allows.",
          { ...base, retryable: true },
        );
      }
      return new AppError("provider_bad_input", "Higgsfield rejected the request.", base);
    case 422:
      return new AppError(
        "provider_bad_input",
        "Higgsfield rejected the request parameters.",
        base,
      );
    case 401:
      return new AppError(
        "provider_auth",
        "Higgsfield rejected the API key. Check HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET.",
        { status, reference },
      );
    case 402:
    case 403:
      return new AppError(
        "provider_credits",
        "Not enough Higgsfield credits. Top up at console.higgsfield.ai.",
        base,
      );
    case 404:
      return new AppError(
        "not_found",
        "Higgsfield has no such model or request for this account.",
        base,
      );
    case 423:
      return new AppError("provider_unavailable", "This Higgsfield model is temporarily blocked.", {
        ...base,
        retryable: true,
      });
    case 429:
      return new AppError("provider_busy", "Higgsfield is rate limiting requests.", {
        ...base,
        retryable: true,
      });
    case 503:
      return new AppError(
        "provider_unavailable",
        "This Higgsfield model is disabled or not ready yet.",
        { ...base, retryable: true },
      );
    default:
      return new AppError("provider_unavailable", `Higgsfield is unavailable (HTTP ${status}).`, {
        ...base,
        retryable: RETRYABLE_STATUS.has(status),
      });
  }
}

/**
 * Submits are billable and take no idempotency key, so one is sent again only
 * when it certainly never started: a 500 (the docs' retryable server error) or
 * a failure before the request left. Never after a timeout or a dropped
 * connection, which Higgsfield may already have accepted.
 */
export function shouldResubmit(error: unknown): boolean {
  if (error instanceof AppError && error.status === 500) return true;
  return failedBeforeSending(error);
}

/** What Higgsfield said about the configured key; "unknown" when it could not be asked. */
export type CredentialCheck = "accepted" | "rejected" | "unknown";

export type HiggsfieldClientOptions = {
  keyId: string;
  keySecret: string;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
};

export class HiggsfieldClient implements ImageVideoProvider {
  readonly id = "higgsfield" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(private readonly options: HiggsfieldClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_HIGGSFIELD_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.retries = options.retries ?? 2;
  }

  /**
   * Whether Higgsfield accepts these credentials, without generating anything:
   * the status of a request id that does not exist answers 404 to a valid key
   * and 401 to an invalid one (docs, Authentication and Errors).
   */
  async checkCredentials(): Promise<CredentialCheck> {
    try {
      const response = await fetchWithTimeout(this.url(`requests/${randomUUID()}/status`), {
        method: "GET",
        headers: this.headers(),
        timeoutMs: 8000,
        cache: "no-store",
      });
      if (response.status === 401) return "rejected";
      return response.status < 500 ? "accepted" : "unknown";
    } catch {
      return "unknown";
    }
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Key ${this.options.keyId}:${this.options.keySecret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private url(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    retryOn: (error: unknown) => boolean,
    timeoutMs = this.timeoutMs,
  ): Promise<{ payload: unknown; correlationId: string | null }> {
    return withRetry(
      async () => {
        const response = await fetchWithTimeout(this.url(path), {
          method,
          headers: this.headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
          timeoutMs,
          cache: "no-store",
        });
        if (!response.ok) throw await higgsfieldError(response);
        const correlationId = response.headers.get("x-correlation-id");
        const text = await response.text();
        try {
          return { payload: text ? (JSON.parse(text) as unknown) : null, correlationId };
        } catch {
          throw new AppError("provider_unavailable", "Unexpected response from Higgsfield.", {
            reference: correlationId ?? undefined,
          });
        }
      },
      { retries: this.retries, baseDelayMs: 1000, maxDelayMs: 15_000, shouldRetry: retryOn },
    );
  }

  /** A URL Higgsfield returned, used only if it points at the API (the key goes with it). */
  private apiUrl(candidate: string | null | undefined): string | null {
    if (!candidate) return null;
    try {
      return new URL(candidate).origin === new URL(this.baseUrl).origin ? candidate : null;
    } catch {
      return null;
    }
  }

  async submit(
    target: SubmitTarget,
    body: Record<string, unknown>,
    context: SubmitContext,
  ): Promise<ProviderState> {
    let path = target.endpoint;
    if (context.webhookUrl) {
      path += `${path.includes("?") ? "&" : "?"}hf_webhook=${encodeURIComponent(context.webhookUrl)}`;
    }
    const { payload, correlationId } = await this.request("POST", path, body, shouldResubmit);
    return { ...this.parseState(payload), correlationId };
  }

  /**
   * The docs' estimate endpoint: the same body posted to /estimate/{endpoint}
   * returns { credits, usd } as decimal strings. Nothing is generated or charged.
   */
  async estimate(
    target: SubmitTarget,
    body: Record<string, unknown>,
  ): Promise<ProviderEstimate | null> {
    const { payload } = await this.request(
      "POST",
      `/estimate/${target.endpoint.replace(/^\/+/, "")}`,
      body,
      () => false,
      15_000,
    );
    return parseEstimate(payload);
  }

  async getStatus(
    requestId: string,
    context?: Pick<StatusContext, "statusUrl">,
  ): Promise<ProviderState> {
    const path =
      this.apiUrl(context?.statusUrl) ?? `/requests/${encodeURIComponent(requestId)}/status`;
    const { payload } = await this.request("GET", path, undefined, (error) =>
      error instanceof AppError ? error.retryable : true,
    );
    return this.parseState(payload);
  }

  async cancel(requestId: string): Promise<void> {
    try {
      await this.request(
        "POST",
        `/requests/${encodeURIComponent(requestId)}/cancel`,
        undefined,
        () => false,
      );
    } catch (error) {
      if (error instanceof AppError && error.status === 400) {
        throw new AppError(
          "conflict",
          "Higgsfield has already started this request, so it can no longer be canceled.",
          { status: 400, reference: error.reference },
        );
      }
      throw error;
    }
  }

  /** Presigned upload (docs: POST /files/generate-upload-url, then PUT with its headers). */
  async uploadFile(data: Uint8Array, contentType: string): Promise<string> {
    const { payload } = await this.request(
      "POST",
      "/files/generate-upload-url",
      { content_type: contentType },
      () => false,
    );
    const upload = payload as {
      public_url?: string;
      upload_url?: string;
      upload_headers?: Record<string, string>;
    } | null;
    if (!upload?.public_url || !upload.upload_url) {
      throw new AppError("provider_unavailable", "Higgsfield did not return an upload URL.");
    }
    // The presigned URL carries its own authorisation: never send the API key there.
    const response = await fetchWithTimeout(upload.upload_url, {
      method: "PUT",
      headers: upload.upload_headers ?? { "Content-Type": contentType },
      body: data as BodyInit,
      timeoutMs: this.timeoutMs * 2,
    });
    if (!response.ok) {
      throw new AppError(
        "provider_unavailable",
        `Uploading to Higgsfield storage failed (HTTP ${response.status}).`,
        { status: response.status },
      );
    }
    return upload.public_url;
  }

  private parseState(payload: unknown): ProviderState {
    const parsed = requestStateSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError("provider_unavailable", "Unexpected response from Higgsfield.", {
        detail: parsed.error.issues[0]?.message,
      });
    }
    return toProviderState(parsed.data);
  }
}
