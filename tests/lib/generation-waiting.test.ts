import { describe, expect, it } from "vitest";

import { toGenerationView, waitingNoteOf } from "@/lib/domain/generation";
import { AppError } from "@/lib/errors";
import { pollIntervalMs, providerBodyFrom, waitReasonOf } from "@/lib/generations/waiting";
import { webhookEnvelopeSchema } from "@/lib/generations/webhook";
import { failedBeforeSending } from "@/lib/http/retry";
import type { GenerationRow } from "@/lib/supabase/database.types";

describe("waitReasonOf", () => {
  it("waits on the rejections that leave no request behind", () => {
    expect(waitReasonOf(new AppError("provider_busy", "full", { status: 400 }))).toBe("capacity");
    expect(waitReasonOf(new AppError("provider_credits", "empty", { status: 403 }))).toBe(
      "credits",
    );
    expect(waitReasonOf(new AppError("provider_unavailable", "x", { status: 423 }))).toBe("model");
    expect(waitReasonOf(new AppError("provider_unavailable", "x", { status: 503 }))).toBe("model");
    expect(waitReasonOf(new AppError("provider_unavailable", "x", { status: 500 }))).toBe("server");
  });

  it("fails everything else, including answers that may hide an accepted request", () => {
    expect(waitReasonOf(new AppError("provider_bad_input", "x", { status: 422 }))).toBeNull();
    expect(waitReasonOf(new AppError("provider_unavailable", "x", { status: 504 }))).toBeNull();
    expect(waitReasonOf(new AppError("provider_timeout", "slow", { retryable: true }))).toBeNull();
    expect(waitReasonOf(new Error("boom"))).toBeNull();
  });
});

describe("providerBodyFrom", () => {
  it("drops the app's own keys and signs the stored references again", () => {
    const body = providerBodyFrom(
      {
        prompt: "front view",
        image_urls: ["storage:owner/a.jpg", "storage:owner/b.jpg"],
        image_reference: { type: "image_url", image_url: "storage:owner/a.jpg" },
        _applied: { aspectRatio: "4:5" },
        _meta: { slotLabel: "Lace" },
        _waiting: { reason: "capacity", since: "2026-09-27T10:00:00Z", message: null },
      },
      (path) => `https://signed.test/${path}?token=1`,
    );
    expect(body).toEqual({
      prompt: "front view",
      image_urls: [
        "https://signed.test/owner/a.jpg?token=1",
        "https://signed.test/owner/b.jpg?token=1",
      ],
      image_reference: { type: "image_url", image_url: "https://signed.test/owner/a.jpg?token=1" },
    });
  });

  it("refuses to send a body whose reference is gone", () => {
    expect(() =>
      providerBodyFrom({ image_urls: ["storage:owner/a.jpg"] }, () => undefined),
    ).toThrow(AppError);
  });
});

describe("pollIntervalMs", () => {
  it("starts at two seconds and eases out to ten", () => {
    expect(pollIntervalMs(0)).toBe(2_000);
    expect(pollIntervalMs(1)).toBe(3_000);
    expect(pollIntervalMs(2)).toBe(4_500);
    expect(pollIntervalMs(10)).toBe(10_000);
  });
});

describe("waiting rows", () => {
  const row = {
    id: "g",
    status: "queued",
    provider_request_id: null,
    params: { _waiting: { reason: "credits", since: "2026-09-27T10:00:00Z", message: "empty" } },
  } as unknown as GenerationRow;

  it("reads the waiting note and shows its reason", () => {
    expect(waitingNoteOf(row.params)).toEqual({
      reason: "credits",
      since: "2026-09-27T10:00:00Z",
      message: "empty",
    });
    expect(toGenerationView(row, null).waitingReason).toBe("credits");
    expect(waitingNoteOf({ _waiting: { reason: "later" } })).toBeNull();
  });

  it("stops showing the reason once Higgsfield has the request", () => {
    expect(
      toGenerationView({ ...row, provider_request_id: "req", status: "in_progress" }, null)
        .waitingReason,
    ).toBeNull();
  });
});

describe("failedBeforeSending", () => {
  const withCode = (code: string) =>
    new AppError("provider_unavailable", "down", {
      cause: new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) }),
    });

  it("only trusts failures that happen before the request leaves", () => {
    expect(failedBeforeSending(withCode("ENOTFOUND"))).toBe(true);
    expect(failedBeforeSending(withCode("ECONNREFUSED"))).toBe(true);
    expect(failedBeforeSending(withCode("ECONNRESET"))).toBe(false);
    expect(failedBeforeSending(new AppError("provider_timeout", "slow"))).toBe(false);
  });
});

describe("webhookEnvelopeSchema", () => {
  it("accepts the documented deliveries", () => {
    for (const body of [
      {
        request_id: "9417a243-e457-4075-895b-b68f3cda5303",
        status: "completed",
        error: null,
        payload: { images: [{ url: "https://cdn.test/a.jpg", content_type: "image/jpeg" }] },
      },
      { request_id: "r", status: "failed", error: "Generation failed", payload: null },
      { request_id: "r", status: "nsfw", error: null, payload: null },
    ]) {
      expect(webhookEnvelopeSchema.safeParse(body).success).toBe(true);
    }
  });

  it("rejects bodies that do not match the envelope", () => {
    expect(webhookEnvelopeSchema.safeParse({ status: "completed" }).success).toBe(false);
    expect(webhookEnvelopeSchema.safeParse({ request_id: "r", status: "queued" }).success).toBe(
      false,
    );
    expect(webhookEnvelopeSchema.safeParse(null).success).toBe(false);
  });
});
