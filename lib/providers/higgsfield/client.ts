import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors";
import { fetchWithTimeout, RETRYABLE_STATUS, withRetry } from "@/lib/http/retry";
import type {
  ImageVideoProvider,
  ModelSpec,
  ProviderState,
  ProviderStatus,
  SubmitContext,
} from "@/lib/providers/higgsfield/types";

/**
 * Higgsfield HTTP client.
 *
 * Transport details come from Higgsfield's official SDKs (@higgsfield/client
 * 0.2.6 v2 client and higgsfield-client 0.2.0 for Python):
 *   - base URL        https://api.higgsfield.ai
 *   - auth header     Authorization: Key KEY_ID:KEY_SECRET
 *   - submit          POST /{model endpoint}   body = model arguments
 *                     optional ?hf_webhook=<url>
 *   - status          GET  /requests/{request_id}/status
 *   - cancel          POST /requests/{request_id}/cancel
 *   - upload URL      POST /files/generate-upload-url {content_type}
 *   - statuses        queued | in_progress | completed | failed | nsfw | canceled
 *   - results         images: [{url}] and/or video: {url}
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

/** The SDK types do not document a cost field; record one only if present. */
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

export async function higgsfieldError(response: Response): Promise<AppError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error body.
  }
  const detail = detailMessage(payload);
  switch (response.status) {
    case 400:
    case 422:
      return new AppError("provider_bad_input", "Higgsfield rejected the request parameters.", {
        detail,
      });
    case 401:
      return new AppError(
        "provider_auth",
        "Higgsfield rejected the API key. Check HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET.",
      );
    case 402:
    case 403:
      return new AppError(
        "provider_credits",
        "Not enough Higgsfield credits (or no access to this model).",
        { detail },
      );
    case 404:
      return new AppError("not_found", "Higgsfield does not know this endpoint or request.", {
        detail,
      });
    case 429:
      return new AppError(
        "provider_rate_limit",
        "Higgsfield is rate limiting requests. Try again shortly.",
        {
          retryable: true,
        },
      );
    default:
      return new AppError(
        "provider_unavailable",
        `Higgsfield is unavailable (HTTP ${response.status}).`,
        {
          retryable: RETRYABLE_STATUS.has(response.status),
          detail,
        },
      );
  }
}

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
  ): Promise<unknown> {
    return withRetry(
      async () => {
        const response = await fetchWithTimeout(this.url(path), {
          method,
          headers: this.headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
          timeoutMs: this.timeoutMs,
          cache: "no-store",
        });
        if (!response.ok) throw await higgsfieldError(response);
        const text = await response.text();
        return text ? (JSON.parse(text) as unknown) : null;
      },
      { retries: this.retries, baseDelayMs: 1000, maxDelayMs: 15_000, shouldRetry: retryOn },
    );
  }

  async submit(
    spec: ModelSpec,
    body: Record<string, unknown>,
    context: SubmitContext,
  ): Promise<ProviderState> {
    let path = spec.endpoint;
    if (context.webhookUrl) {
      path += `${path.includes("?") ? "&" : "?"}hf_webhook=${encodeURIComponent(context.webhookUrl)}`;
    }
    // Submits are billable: retry only when the request clearly never landed
    // (rate limit, gateway errors, connection failures) — not after a timeout.
    const payload = await this.request("POST", path, body, (error) => {
      if (error instanceof AppError) {
        return (
          error.code === "provider_rate_limit" ||
          (error.code === "provider_unavailable" && error.retryable)
        );
      }
      return error instanceof TypeError;
    });
    return this.parseState(payload);
  }

  async getStatus(requestId: string): Promise<ProviderState> {
    const payload = await this.request(
      "GET",
      `/requests/${encodeURIComponent(requestId)}/status`,
      undefined,
      (error) => (error instanceof AppError ? error.retryable : true),
    );
    return this.parseState(payload);
  }

  async cancel(requestId: string): Promise<void> {
    await this.request(
      "POST",
      `/requests/${encodeURIComponent(requestId)}/cancel`,
      undefined,
      () => false,
    );
  }

  /** Pre-signed upload (official SDK: POST /files/generate-upload-url then PUT). */
  async uploadFile(data: Uint8Array, contentType: string): Promise<string> {
    const payload = (await this.request(
      "POST",
      "/files/generate-upload-url",
      { content_type: contentType },
      () => false,
    )) as {
      public_url?: string;
      upload_url?: string;
      upload_headers?: Record<string, string>;
    } | null;
    if (!payload?.public_url || !payload.upload_url) {
      throw new AppError("provider_unavailable", "Higgsfield did not return an upload URL.");
    }
    const response = await fetchWithTimeout(payload.upload_url, {
      method: "PUT",
      headers: payload.upload_headers ?? { "Content-Type": contentType },
      body: data as BodyInit,
      timeoutMs: this.timeoutMs * 2,
    });
    if (!response.ok) throw await higgsfieldError(response);
    return payload.public_url;
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
