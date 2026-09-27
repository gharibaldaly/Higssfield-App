import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { backoffDelay, fetchWithTimeout, isRetryableError, withRetry } from "@/lib/http/retry";

const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("retries retryable failures and returns the first success", async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new AppError("provider_unavailable", "down", { retryable: true }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();
    await expect(
      withRetry(operation, {
        retries: 3,
        baseDelayMs: 10,
        maxDelayMs: 100,
        sleep: noSleep,
        onRetry,
      }),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("stops on non-retryable errors and after the retry budget", async () => {
    const fatal = vi.fn().mockRejectedValue(new AppError("provider_auth", "bad key"));
    await expect(
      withRetry(fatal, { retries: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }),
    ).rejects.toMatchObject({
      code: "provider_auth",
    });
    expect(fatal).toHaveBeenCalledTimes(1);

    const flaky = vi
      .fn()
      .mockRejectedValue(new AppError("provider_timeout", "slow", { retryable: true }));
    await expect(
      withRetry(flaky, { retries: 2, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }),
    ).rejects.toMatchObject({
      code: "provider_timeout",
    });
    expect(flaky).toHaveBeenCalledTimes(3);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially with jitter and respects the cap", () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const capped = Math.min(1000 * 2 ** (attempt - 1), 8000);
      const delay = backoffDelay(attempt, 1000, 8000);
      expect(delay).toBeGreaterThanOrEqual(capped / 2);
      expect(delay).toBeLessThanOrEqual(capped);
    }
  });
});

describe("isRetryableError", () => {
  it("classifies errors", () => {
    expect(isRetryableError(new AppError("provider_rate_limit", "x", { retryable: true }))).toBe(
      true,
    );
    expect(isRetryableError(new AppError("validation", "x"))).toBe(false);
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("boom"))).toBe(false);
  });
});

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns network failures into retryable provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(
      fetchWithTimeout("https://example.test", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });

  it("turns a timeout into a retryable timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "TimeoutError")),
            );
          }),
      ),
    );
    await expect(fetchWithTimeout("https://example.test", { timeoutMs: 20 })).rejects.toMatchObject(
      {
        code: "provider_timeout",
        retryable: true,
      },
    );
  });
});
