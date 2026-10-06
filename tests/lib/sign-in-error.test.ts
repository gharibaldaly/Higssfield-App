import { describe, expect, it } from "vitest";

import { signInErrorOf } from "@/lib/auth/sign-in-error";

describe("signInErrorOf", () => {
  it("names a rate limit, from the status or Supabase's code", () => {
    expect(signInErrorOf({ status: 429, message: "Request rate limit reached" })).toEqual({
      error: "rate_limit",
      detail: "Request rate limit reached",
    });
    expect(signInErrorOf({ code: "over_request_rate_limit", status: 429 }).error).toBe(
      "rate_limit",
    );
  });

  it("names the Supabase Auth settings that refuse a sign-in", () => {
    expect(signInErrorOf({ code: "email_not_confirmed", status: 400 }).error).toBe("unconfirmed");
    expect(signInErrorOf({ code: "captcha_failed", status: 400 }).error).toBe("captcha");
    expect(signInErrorOf({ code: "email_provider_disabled", status: 400 }).error).toBe("provider");
    expect(signInErrorOf({ status: 400, message: "Email logins are disabled" }).error).toBe(
      "provider",
    );
  });

  it("keeps wrong credentials as the plain message", () => {
    expect(
      signInErrorOf({
        code: "invalid_credentials",
        status: 400,
        message: "Invalid login credentials",
      }),
    ).toEqual({ error: "invalid", detail: "invalid_credentials" });
  });

  it("reports an outage and shows the code of anything else", () => {
    expect(signInErrorOf({ status: 503, message: "Service unavailable" }).error).toBe(
      "unavailable",
    );
    expect(signInErrorOf({ status: 401, message: "Invalid API key" })).toEqual({
      error: "unknown",
      detail: "Invalid API key",
    });
    expect(signInErrorOf({}).detail).toBe("HTTP 0");
  });
});
