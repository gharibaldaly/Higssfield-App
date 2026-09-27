import type { WaitReason } from "@/lib/domain/generation";
import { AppError } from "@/lib/errors";

/**
 * Waiting room for generations Higgsfield could not take yet.
 *
 * The docs list the answers that reject a submit without creating a request:
 * the account's concurrency limit (400 "Maximum number of concurrent
 * requests"), missing credits (403), a blocked or not-ready model (423 / 503)
 * and a server error (500). The same body can safely be sent again later, so
 * such a row stays "queued" with no request id and a `_waiting` note in its
 * params, and a later poll sends it once there is room.
 */

/** How long a waiting row rests between attempts, per reason. */
export const WAIT_RETRY_MS: Record<WaitReason, number> = {
  capacity: 5_000,
  credits: 60_000,
  model: 30_000,
  server: 30_000,
};

/** A row still waiting after this long fails, so nothing waits forever. */
export const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

/** Keys the app adds to a generation's params; the rest is the provider body. */
export const LOCAL_PARAM_KEYS: ReadonlySet<string> = new Set([
  "_applied",
  "_warnings",
  "_meta",
  "_finish",
  "_waiting",
  "_correlationId",
  "_estimate",
]);

/** The waiting reason for a rejected submit, or null when it must fail. */
export function waitReasonOf(error: unknown): WaitReason | null {
  if (!(error instanceof AppError)) return null;
  if (error.code === "provider_busy") return "capacity";
  if (error.code === "provider_credits") return "credits";
  if (error.status === 423 || error.status === 503) return "model";
  if (error.status === 500) return "server";
  return null;
}

const STORAGE_MARKER = "storage:";

/**
 * Rebuilds the provider body stored in a generation's params: drops the app's
 * own keys and turns `storage:<path>` markers back into fresh signed URLs.
 */
export function providerBodyFrom(
  params: unknown,
  signedUrl: (path: string) => string | undefined,
): Record<string, unknown> {
  const stored =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  const body = Object.fromEntries(
    Object.entries(stored).filter(([key]) => !LOCAL_PARAM_KEYS.has(key)),
  );
  const missing: string[] = [];
  const json = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== "string" || !value.startsWith(STORAGE_MARKER)) return value;
    const path = value.slice(STORAGE_MARKER.length);
    const url = signedUrl(path);
    if (!url) missing.push(path);
    return url ?? value;
  });
  if (missing.length > 0) {
    throw new AppError("not_found", "A reference image could not be read from storage.");
  }
  return JSON.parse(json) as Record<string, unknown>;
}

/** Polling cadence from the docs: start at 2 s and ease out to 10 s. */
export function pollIntervalMs(attempts: number): number {
  return Math.min(10_000, Math.round(2_000 * 1.5 ** Math.max(0, attempts)));
}
