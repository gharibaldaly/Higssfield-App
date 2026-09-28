import { beforeEach, describe, expect, it } from "vitest";

import { claimRegeneration, REGENERATION_LEASE_MS } from "@/lib/catalogue/service";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createFakeSupabase } from "@/tests/stubs/fake-supabase";

const CREATED = "2026-09-28T09:00:00.000Z";
const OUTPUT = { id: "gen-1", jobId: "job-1", slot: "front", createdAt: CREATED };

let clock: number;
let fake: ReturnType<typeof createFakeSupabase>;
const supabase = () => fake.client as unknown as TypedSupabaseClient;
const claim = () => claimRegeneration(supabase(), OUTPUT, clock);
const output = () => fake.rows("generations").find((row) => row.id === OUTPUT.id);

function addGeneration(id: string, slot: string, createdAt: string) {
  fake.rows("generations").push({
    id,
    catalogue_job_id: OUTPUT.jobId,
    slot,
    review_status: "pending",
    created_at: createdAt,
    updated_at: createdAt,
  });
}

beforeEach(() => {
  clock = Date.parse("2026-09-28T10:00:00.000Z");
  // Postgres's set_updated_at trigger.
  fake = createFakeSupabase(
    {},
    {
      onUpdate: {
        generations: (row) => {
          row.updated_at = new Date(clock).toISOString();
        },
      },
    },
  );
  addGeneration(OUTPUT.id, OUTPUT.slot, CREATED);
});

describe("claimRegeneration", () => {
  it("lets the first request regenerate and marks the output rejected", async () => {
    await claim();
    expect(output()).toMatchObject({ review_status: "rejected" });
  });

  it("refuses a second request while the first is writing its prompt", async () => {
    await claim();
    clock += 60_000;
    await expect(claim()).rejects.toMatchObject({
      code: "conflict",
      message: "This image is already being regenerated.",
    });
  });

  it("refuses for good once the output has a newer image", async () => {
    await claim();
    addGeneration("gen-2", OUTPUT.slot, "2026-09-28T10:00:40.000Z");
    clock += REGENERATION_LEASE_MS * 3;
    await expect(claim()).rejects.toMatchObject({
      code: "conflict",
      message: "This image was already regenerated. Review the new one.",
    });
  });

  it("does not count newer images of other slots", async () => {
    await claim();
    addGeneration("gen-back", "back", "2026-09-28T10:00:40.000Z");
    clock += REGENERATION_LEASE_MS + 1_000;
    await expect(claim()).resolves.toBeUndefined();
  });

  it("takes over a regeneration cut off before it recorded anything, once", async () => {
    await claim();
    clock += REGENERATION_LEASE_MS + 1_000;
    await claim();
    expect(output()?.updated_at).toBe(new Date(clock).toISOString());
    // The takeover renews the lease.
    clock += 1_000;
    await expect(claim()).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets only one of two requests take over the same cut-off regeneration", async () => {
    await claim();
    clock += REGENERATION_LEASE_MS + 1_000;
    const results = await Promise.allSettled([claim(), claim()]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});
