import { ApiError } from "@google/genai";

/**
 * Reading Google's error bodies. The SDK's ApiError carries the whole JSON
 * body as its message: `{"error":{"code","message","status","details":[…]}}`.
 * A 429 lists the quota it hit (`google.rpc.QuotaFailure`) and how long to
 * wait (`google.rpc.RetryInfo`).
 */

type GoogleErrorBody = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  details?: unknown;
};

type QuotaViolation = {
  quotaMetric?: unknown;
  quotaId?: unknown;
  quotaDimensions?: { model?: unknown };
  quotaValue?: unknown;
};

export type GeminiQuota = {
  /** The window of the limit that was hit, when Google names it. */
  window: "minute" | "day" | null;
  /** What the limit counts. */
  unit: "requests" | "tokens" | null;
  limit: number | null;
  model: string | null;
  freeTier: boolean;
  /** Google's suggested wait before trying again. */
  retryAfterMs: number | null;
};

const QUOTA_FAILURE = "type.googleapis.com/google.rpc.QuotaFailure";
const RETRY_INFO = "type.googleapis.com/google.rpc.RetryInfo";

function errorBody(error: ApiError): GoogleErrorBody | null {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    return parsed && typeof parsed.error === "object" && parsed.error !== null
      ? (parsed.error as GoogleErrorBody)
      : null;
  } catch {
    return null;
  }
}

/** Google's own message, or the raw text when the body was not JSON. */
export function googleMessage(error: ApiError): string {
  const message = errorBody(error)?.message;
  return (typeof message === "string" && message.trim() ? message : error.message).trim();
}

/** "41s", "41.53s" or "548ms" in milliseconds. */
function durationMs(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(ms|s)\b/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return Math.round(match[2] === "ms" ? amount : amount * 1000);
}

/** The quota a 429 hit, from its details or, failing that, its message. */
export function geminiQuota(error: unknown): GeminiQuota | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const body = errorBody(error);
  const details = Array.isArray(body?.details) ? (body.details as Record<string, unknown>[]) : [];
  const violations = details
    .filter((detail) => detail?.["@type"] === QUOTA_FAILURE)
    .flatMap((detail) =>
      Array.isArray(detail.violations) ? (detail.violations as QuotaViolation[]) : [],
    );
  const text = typeof body?.message === "string" ? body.message : error.message;

  // A daily limit outlasts a per-minute one, so it decides when both are hit.
  const describe = (violation: QuotaViolation) =>
    `${String(violation.quotaId ?? "")} ${String(violation.quotaMetric ?? "")}`;
  const violation =
    violations.find((candidate) => /per\s*day/i.test(describe(candidate))) ?? violations[0];
  const label = violation ? describe(violation) : text;

  const window = /per\s*day/i.test(label) ? "day" : /per\s*minute/i.test(label) ? "minute" : null;
  const unit = /token/i.test(label) ? "tokens" : /request/i.test(label) ? "requests" : null;
  const limitValue = Number(violation?.quotaValue ?? /limit:\s*(\d+)/i.exec(text)?.[1] ?? NaN);
  const dimensionModel = violation?.quotaDimensions?.model;
  const model =
    typeof dimensionModel === "string"
      ? dimensionModel
      : (/model:\s*([\w.-]+)/i.exec(text)?.[1] ?? null);

  const retryInfo = details.find((detail) => detail?.["@type"] === RETRY_INFO);
  const retryDelay = typeof retryInfo?.retryDelay === "string" ? retryInfo.retryDelay : null;
  const retryText = /retry in\s*([\d.]+\s*m?s)/i.exec(text)?.[1] ?? null;

  return {
    window,
    unit,
    limit: Number.isFinite(limitValue) ? limitValue : null,
    model,
    freeTier: /free[\s_-]*tier/i.test(label),
    retryAfterMs: durationMs(retryDelay ?? retryText ?? ""),
  };
}

/** "gemini-3.8-flash: 20 requests a day (free tier)", or null when nothing is known. */
export function describeQuota(quota: GeminiQuota, fallbackModel?: string): string | null {
  const unit = quota.unit ?? "requests";
  const per = quota.window === "day" ? " a day" : quota.window === "minute" ? " a minute" : "";
  const amount = quota.limit !== null ? `${quota.limit} ${unit}${per}` : null;
  const parts = [amount, quota.freeTier ? "(free tier)" : null].filter(Boolean).join(" ");
  if (!parts) return null;
  const model = quota.model ?? fallbackModel;
  return model ? `${model}: ${parts}` : parts;
}

/** The next midnight in Los Angeles, when Google resets daily quotas. */
export function nextPacificMidnight(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const [year, month, day] = [part("year"), part("month"), part("day")];
  // Pacific time is UTC-7 in summer and UTC-8 in winter.
  for (const offsetHours of [7, 8]) {
    const candidate = new Date(Date.UTC(year, month - 1, day + 1, offsetHours));
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hourCycle: "h23",
    }).format(candidate);
    if (Number(hour) === 0) return candidate;
  }
  return new Date(Date.UTC(year, month - 1, day + 1, 8));
}

/** "10:00 Cairo time": the studio's owner works from Cairo. */
export function cairoTime(date: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${time} Cairo time`;
}
