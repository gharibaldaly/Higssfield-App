import { AppError } from "@/lib/errors";

export type RetryOptions = {
  /** Attempts after the first one. */
  retries: number;
  /** First backoff delay in ms; doubles each attempt (with jitter). */
  baseDelayMs: number;
  maxDelayMs: number;
  /** Decide whether an error is worth another attempt. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  // Full jitter keeps parallel retries from synchronising.
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return true;
  }
  // Network-level failures surface as TypeError from fetch.
  return error instanceof TypeError;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? ((error: unknown) => isRetryableError(error));
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt > options.retries || !shouldRetry(error, attempt)) throw error;
      const delay = backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs);
      options.onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
}

/** Status codes that indicate a transient problem on the provider side. */
export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type FetchWithTimeoutInit = RequestInit & { timeoutMs: number };

/** fetch() with an abort timeout that is translated into a retryable AppError. */
export async function fetchWithTimeout(url: string, init: FetchWithTimeoutInit): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetch(url, { ...rest, signal: combined });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new AppError("provider_timeout", "The provider did not respond in time.", {
        retryable: true,
        cause: error,
      });
    }
    if (error instanceof TypeError) {
      throw new AppError("provider_unavailable", "Could not reach the provider.", {
        retryable: true,
        cause: error,
      });
    }
    throw error;
  }
}
