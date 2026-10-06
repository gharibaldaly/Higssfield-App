/**
 * Why Supabase Auth refused a sign-in, so the login page can say what to do
 * instead of "email or password is not correct" for every failure. The codes
 * are Supabase Auth's error codes (`AuthApiError.code`); the status is the
 * HTTP status of its answer.
 */
export type SignInError =
  | "invalid"
  | "not_owner"
  | "config"
  | "rate_limit"
  | "unconfirmed"
  | "captcha"
  | "provider"
  | "unavailable"
  | "unknown";

export type SignInDiagnosis = {
  error: SignInError;
  /** A short, non-secret detail (the code or the message) for the page and the logs. */
  detail: string;
};

export function signInErrorOf(error: {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}): SignInDiagnosis {
  const code = error.code ?? "";
  const status = error.status ?? 0;
  const message = (error.message ?? "").trim();
  const detail = (code || message || `HTTP ${status}`).slice(0, 120);
  if (status === 429 || code.startsWith("over_") || /rate limit/i.test(message)) {
    return { error: "rate_limit", detail };
  }
  if (code === "email_not_confirmed" || /not confirmed/i.test(message)) {
    return { error: "unconfirmed", detail };
  }
  if (code === "captcha_failed" || /captcha/i.test(message)) return { error: "captcha", detail };
  if (code === "email_provider_disabled" || /logins are disabled/i.test(message)) {
    return { error: "provider", detail };
  }
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return { error: "invalid", detail };
  }
  if (status >= 500 || code === "unexpected_failure") return { error: "unavailable", detail };
  return { error: "unknown", detail };
}
