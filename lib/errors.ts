/**
 * Errors that are safe to show to the owner. Provider adapters translate
 * low-level failures (HTTP codes, SDK exceptions, validation issues) into an
 * AppError with a short, actionable message; anything else is reported as a
 * generic failure so secrets or stack traces never reach the UI.
 */
export type AppErrorCode =
  | "auth"
  | "not_found"
  | "validation"
  | "provider_auth"
  | "provider_credits"
  | "provider_bad_input"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_refusal"
  | "content_filter"
  | "llm_output"
  | "config"
  | "conflict"
  | "unknown";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(
    code: AppErrorCode,
    message: string,
    options: { retryable?: boolean; detail?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Message suitable for toasts and error rows. */
export function toUserMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.detail ? `${error.message} (${error.detail})` : error.message;
  }
  return "Something went wrong. Please try again.";
}

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; code?: AppErrorCode };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: unknown): { ok: false; error: string; code?: AppErrorCode } {
  if (isAppError(error)) {
    return { ok: false, error: toUserMessage(error), code: error.code };
  }
  console.error(error);
  return { ok: false, error: toUserMessage(error), code: "unknown" };
}
