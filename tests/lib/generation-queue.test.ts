import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Env from "@/lib/env";
import { AppError } from "@/lib/errors";
import { failureMessage, refreshGeneration, submitGeneration } from "@/lib/generations/service";
import type { ProviderState, SubmitContext } from "@/lib/providers/higgsfield/types";
import { modelSpecSchema } from "@/lib/providers/higgsfield/types";
import type { GenerationRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createFakeSupabase } from "@/tests/stubs/fake-supabase";

/** A Higgsfield stand-in that enforces its own concurrency limit, like the real API. */
class FakeHiggsfield {
  readonly id = "higgsfield" as const;
  limit = 2;
  /** Generation ids of every accepted submit. */
  accepted: string[] = [];
  /** Generation ids of every submit call, accepted or not. */
  attempts: string[] = [];
  rejectNext: AppError | null = null;
  /** Generation ids whose request ends as failed at Higgsfield. */
  failing = new Set<string>();
  estimates = 0;
  private readonly open = new Set<string>();
  private readonly done = new Set<string>();

  async estimate() {
    this.estimates += 1;
    return { usd: 0.04, credits: 0.64 };
  }

  async submit(_target: unknown, _body: unknown, context: SubmitContext): Promise<ProviderState> {
    this.attempts.push(context.generationId);
    if (this.rejectNext) {
      const error = this.rejectNext;
      this.rejectNext = null;
      throw error;
    }
    if (this.open.size >= this.limit) {
      throw new AppError("provider_busy", "Higgsfield is full.", { status: 400, retryable: true });
    }
    const requestId = `req-${context.generationId}`;
    this.open.add(requestId);
    this.accepted.push(context.generationId);
    return { ...state(requestId, "queued"), correlationId: "corr-1" };
  }

  /** The request finishes at Higgsfield (and stops counting against the limit). */
  finish(generationId: string) {
    this.open.delete(`req-${generationId}`);
    this.done.add(`req-${generationId}`);
  }

  async getStatus(requestId: string): Promise<ProviderState> {
    if (!this.done.has(requestId)) return state(requestId, "in_progress");
    if (this.failing.has(requestId.slice("req-".length))) {
      return { ...state(requestId, "failed"), error: "Generation failed" };
    }
    return {
      ...state(requestId, "completed"),
      resultKind: "image",
      resultBuffer: { data: png, mimeType: "image/png" },
    };
  }

  async cancel() {}
}

function state(requestId: string, status: ProviderState["status"]): ProviderState {
  return {
    requestId,
    status,
    statusUrl: null,
    resultUrls: [],
    resultKind: null,
    cost: null,
    error: null,
  };
}

const hoisted = vi.hoisted(() => ({
  provider: null as unknown,
  accountLimit: 2,
}));

vi.mock("@/lib/providers/higgsfield", () => ({
  activeProviderMode: () => "higgsfield",
  getProvider: () => hoisted.provider,
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof Env>()),
  higgsfieldMaxConcurrent: () => hoisted.accountLimit,
}));
vi.mock("@/lib/storage/objects", () => ({
  signPaths: async (_supabase: unknown, paths: string[]) =>
    new Map(paths.map((path) => [path, `https://signed.test/${path}?t=${Date.now()}`])),
  downloadObject: async () => Buffer.alloc(0),
  uploadObject: async () => undefined,
}));
vi.mock("@/lib/generations/side-effects", () => ({ settleLinkedRecords: async () => undefined }));
vi.mock("@/lib/generations/webhook", () => ({ webhookUrlFor: () => null }));

let png: Buffer;
let provider: FakeHiggsfield;
let db: ReturnType<typeof createFakeSupabase>;
let supabase: TypedSupabaseClient;

const model = modelSpecSchema.parse({
  id: "test-edit",
  label: "Test edit",
  endpoint: "test/edit",
  kind: "image",
  modes: ["image-to-image"],
  params: {
    prompt: { field: "prompt" },
    image: { field: "image_urls", format: "url_array", max: 4, required: true },
  },
  source: "custom",
});

function submit(prompt: string) {
  return submitGeneration(supabase, {
    purpose: "other",
    model,
    mode: "image-to-image",
    prompt,
    referencePaths: ["owner/photos/front.jpg"],
  });
}

const rowById = (id: string) =>
  db.rows("generations").find((row) => row.id === id) as GenerationRow;
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** Polls every unsettled row once, like the studio's poller. */
async function pollAll() {
  for (const row of db.rows("generations") as GenerationRow[]) {
    await refreshGeneration(supabase, rowById(row.id));
  }
}

beforeAll(async () => {
  png = await sharp({ create: { width: 8, height: 10, channels: 3, background: "#FFFFFF" } })
    .png()
    .toBuffer();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
  provider = new FakeHiggsfield();
  hoisted.provider = provider;
  hoisted.accountLimit = 2;
  db = createFakeSupabase({
    generations: () => ({
      id: randomUUID(),
      owner_id: "owner",
      created_at: new Date().toISOString(),
      provider_request_id: null,
      provider_status_url: null,
      submitted_at: null,
      last_polled_at: null,
      completed_at: null,
      poll_attempts: 0,
      error: null,
      review_status: "pending",
    }),
  });
  supabase = db.client as unknown as TypedSupabaseClient;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the Higgsfield waiting room", () => {
  it("holds requests back at the account's limit and sends each one exactly once", async () => {
    const rows = [];
    for (const prompt of ["a", "b", "c", "d"]) rows.push(await submit(prompt));

    expect(rows.map((row) => row.status)).toEqual(["queued", "queued", "queued", "queued"]);
    expect(provider.accepted).toEqual([rows[0]!.id, rows[1]!.id]);
    expect(provider.attempts).toHaveLength(2);
    expect(rowById(rows[2]!.id).params).toMatchObject({ _waiting: { reason: "capacity" } });

    // Nothing has finished: the waiting rows stay put and Higgsfield is not asked.
    advance(6_000);
    await pollAll();
    expect(provider.attempts).toHaveLength(2);

    // One finishes: its result is stored and the oldest waiting row takes the slot.
    provider.finish(rows[0]!.id);
    advance(6_000);
    await pollAll();
    expect(rowById(rows[0]!.id).status).toBe("completed");
    expect(provider.accepted).toEqual([rows[0]!.id, rows[1]!.id, rows[2]!.id]);
    expect(rowById(rows[2]!.id).params).not.toHaveProperty("_waiting");
    expect(rowById(rows[2]!.id).params).toMatchObject({
      _correlationId: "corr-1",
      image_urls: [expect.stringMatching(/^storage:owner\/derived\/refs\/[0-9a-f]{24}-2560\.jpg$/)],
    });

    for (const row of rows) provider.finish(row.id);
    for (let round = 0; round < 4; round += 1) {
      advance(11_000);
      await pollAll();
      for (const row of rows) provider.finish(row.id);
    }
    expect(rows.map((row) => rowById(row.id).status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect([...provider.accepted].sort()).toEqual(rows.map((row) => row.id).sort());
    expect(new Set(provider.accepted).size).toBe(4);
  });

  it("puts a request Higgsfield turns away for being full back in the queue", async () => {
    hoisted.accountLimit = 4; // The app thinks there is room; Higgsfield allows two.
    const rows = [];
    for (const prompt of ["a", "b", "c"]) rows.push(await submit(prompt));

    expect(provider.attempts).toHaveLength(3);
    expect(provider.accepted).toHaveLength(2);
    const waiting = rowById(rows[2]!.id);
    expect(waiting.status).toBe("queued");
    expect(waiting.provider_request_id).toBeNull();
    expect(waiting.params).toMatchObject({ _waiting: { reason: "capacity" } });

    provider.finish(rows[0]!.id);
    advance(6_000);
    await refreshGeneration(supabase, rowById(rows[2]!.id));
    expect(rowById(rows[2]!.id).provider_request_id).toBe(`req-${rows[2]!.id}`);
  });

  it("never sends a waiting request twice when two polls race", async () => {
    hoisted.accountLimit = 1;
    const first = await submit("a");
    const second = await submit("b");
    provider.finish(first.id);
    advance(6_000);
    await refreshGeneration(supabase, rowById(first.id));

    const stale = rowById(second.id);
    await Promise.all([refreshGeneration(supabase, stale), refreshGeneration(supabase, stale)]);
    expect(provider.accepted.filter((id) => id === second.id)).toHaveLength(1);
  });

  it("waits for a top-up when credits run out, then carries on", async () => {
    provider.rejectNext = new AppError("provider_credits", "Not enough Higgsfield credits.", {
      status: 403,
    });
    const row = await submit("a");
    expect(rowById(row.id).params).toMatchObject({
      _waiting: { reason: "credits", message: "Not enough Higgsfield credits." },
    });

    advance(30_000);
    await refreshGeneration(supabase, rowById(row.id));
    expect(provider.attempts).toHaveLength(1); // Rests a minute between tries.

    advance(31_000);
    await refreshGeneration(supabase, rowById(row.id));
    expect(provider.accepted).toEqual([row.id]);
  });

  it("records Higgsfield's estimate as the cost, and nothing for a failed request", async () => {
    const good = await submit("a");
    const bad = await submit("b");
    expect(provider.estimates).toBe(2);
    expect(rowById(good.id)).toMatchObject({ cost: 0.04, cost_unit: "usd" });
    expect(rowById(good.id).params).toMatchObject({ _estimate: { usd: 0.04, credits: 0.64 } });

    provider.failing.add(bad.id);
    provider.finish(good.id);
    provider.finish(bad.id);
    advance(6_000);
    await pollAll();
    expect(rowById(good.id)).toMatchObject({ status: "completed", cost: 0.04 });
    expect(rowById(bad.id)).toMatchObject({ status: "failed", cost: 0 });
    // Higgsfield's bare "Generation failed" is not echoed; the request id is kept for support.
    expect(rowById(bad.id).error).toMatch(/^Higgsfield could not make this and gave no reason/);
    expect(rowById(bad.id).error).toContain(`[request ${rowById(bad.id).provider_request_id}]`);
  });

  it("passes on a failure reason Higgsfield does give", () => {
    const state: ProviderState = {
      requestId: "req-1",
      status: "failed",
      statusUrl: null,
      resultUrls: [],
      resultKind: null,
      cost: null,
      error: "Input image could not be read",
    };
    expect(failureMessage(state)).toBe(
      "Generation failed: Input image could not be read [request req-1]",
    );
  });

  it("fails a request Higgsfield rejected for good", async () => {
    provider.rejectNext = new AppError("provider_bad_input", "Higgsfield rejected the request.", {
      status: 422,
      detail: "image_urls: too many",
    });
    const row = await submit("a");
    expect(row.status).toBe("failed");
    expect(row.error).toContain("image_urls: too many");
  });
});
