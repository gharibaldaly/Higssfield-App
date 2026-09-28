import { describe, expect, it } from "vitest";

import {
  planNextStep,
  slotsOf,
  type BatchSnapshot,
  type SnapshotJob,
} from "@/lib/ghost-batches/plan";
import type { GhostBatchItemRow, GhostBatchRow } from "@/lib/supabase/database.types";

const NOW = Date.parse("2026-09-27T10:00:00Z");
const config = { inFlightCap: 8, now: NOW, leaseMs: 6 * 60 * 1000 };

const batch: GhostBatchRow = {
  id: "batch",
  owner_id: "owner",
  name: "September",
  status: "running",
  model_id: "mock-image",
  style: {},
  options: {},
  colours_requested_at: null,
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
};

function item(
  position: number,
  phase: GhostBatchItemRow["phase"],
  extra: Partial<GhostBatchItemRow> = {},
): GhostBatchItemRow {
  return {
    id: `item-${position}`,
    owner_id: "owner",
    batch_id: "batch",
    product_id: `product-${position}`,
    position,
    phase,
    error: null,
    claimed_at: null,
    meta: {},
    created_at: "2026-09-27T09:00:00Z",
    updated_at: "2026-09-27T09:00:00Z",
    ...extra,
  };
}

function job(
  id: string,
  position: number,
  jobType: SnapshotJob["job_type"],
  status: SnapshotJob["status"],
  options: SnapshotJob["options"] = {},
): SnapshotJob {
  return {
    id,
    product_id: `product-${position}`,
    job_type: jobType,
    status,
    options,
    started_at: null,
    created_at: `2026-09-27T09:0${position}:00Z`,
  };
}

function snapshot(partial: Partial<BatchSnapshot>): BatchSnapshot {
  return {
    batch,
    items: [],
    products: [],
    jobs: [],
    pending: [],
    fronts: [],
    colorways: [],
    unchecked: [],
    ...partial,
  };
}

describe("planNextStep", () => {
  it("runs queued jobs model by model, front & back before close-ups", () => {
    const plan = planNextStep(
      snapshot({
        items: [item(0, "generating"), item(1, "generating")],
        jobs: [
          job("m1", 1, "front_back", "queued"),
          job("c0", 0, "macro", "queued"),
          job("f0", 0, "front_back", "queued"),
        ],
      }),
      config,
    );
    expect(plan.step).toEqual({ kind: "run_job", jobId: "f0" });
  });

  it("waits for the provider when the batch is at its in-flight cap", () => {
    const plan = planNextStep(
      snapshot({
        items: [item(0, "generating"), item(1, "generating"), item(2, "generating")],
        jobs: [job("f2", 2, "front_back", "queued")],
        pending: Array.from({ length: 7 }, (_, index) => ({
          id: `g${index}`,
          catalogue_job_id: "x",
        })),
      }),
      config,
    );
    expect(plan.step).toEqual({ kind: "wait" });
  });

  it("analyses the next model while earlier ones generate, but only two models ahead", () => {
    const ahead = snapshot({
      items: [item(0, "generating"), item(1, "pending")],
      jobs: [job("f0", 0, "front_back", "generating")],
      pending: [{ id: "g", catalogue_job_id: "f0" }],
    });
    expect(planNextStep(ahead, config).step).toEqual({ kind: "analyze", itemId: "item-1" });

    const tooFar = snapshot({
      items: [item(0, "generating"), item(1, "generating"), item(2, "pending")],
      jobs: [job("f0", 0, "front_back", "queued"), job("f1", 1, "front_back", "queued")],
      pending: Array.from({ length: 8 }, (_, index) => ({
        id: `g${index}`,
        catalogue_job_id: "x",
      })),
    });
    expect(planNextStep(tooFar, config).step).toEqual({ kind: "wait" });
  });

  it("takes over an analysis whose lease ran out", () => {
    const stale = new Date(NOW - 7 * 60 * 1000).toISOString();
    const fresh = new Date(NOW - 60 * 1000).toISOString();
    expect(
      planNextStep(snapshot({ items: [item(0, "analyzing", { claimed_at: stale })] }), config).step,
    ).toEqual({ kind: "analyze", itemId: "item-0" });
    expect(
      planNextStep(snapshot({ items: [item(0, "analyzing", { claimed_at: fresh })] }), config).step,
    ).toEqual({ kind: "wait" });
    // After sorting the photos, the runner releases the claim (1970) for the DNA step.
    const released = new Date(0).toISOString();
    expect(
      planNextStep(snapshot({ items: [item(0, "analyzing", { claimed_at: released })] }), config)
        .step,
    ).toEqual({ kind: "analyze", itemId: "item-0" });
  });

  it("settles models whose front, back and close-ups are finished", () => {
    const plan = planNextStep(
      snapshot({
        items: [item(0, "generating"), item(1, "generating")],
        jobs: [
          job("f0", 0, "front_back", "review"),
          job("m0", 0, "macro", "failed"),
          job("f1", 1, "front_back", "review"),
          job("m1", 1, "macro", "generating"),
        ],
        pending: [{ id: "g", catalogue_job_id: "m1" }],
      }),
      config,
    );
    expect(plan.settledItems).toEqual(["item-0"]);
  });

  it("queues stage one once the owner approves a DNA held for review", () => {
    const plan = planNextStep(
      snapshot({
        items: [item(0, "dna_review")],
        products: [{ id: "product-0", name: "DS-1", approved_dna_id: "dna" }],
      }),
      config,
    );
    expect(plan.step).toEqual({ kind: "queue_stage_one", itemId: "item-0" });
  });

  it("queues stage one for a model left generating without jobs", () => {
    const plan = planNextStep(
      snapshot({
        items: [item(0, "generating")],
        products: [{ id: "product-0", name: "DS-1", approved_dna_id: "dna" }],
      }),
      config,
    );
    expect(plan.step).toEqual({ kind: "queue_stage_one", itemId: "item-0" });
  });

  it("renders colours only after they are requested, for approved fronts, three at a time", () => {
    const base = snapshot({
      items: [item(0, "review"), item(1, "review")],
      fronts: ["product-1"],
      colorways: ["a", "b", "c", "d"].map((id) => ({ id, product_id: "product-1" })),
      jobs: [
        job("f0", 0, "front_back", "review"),
        job("f1", 1, "front_back", "approved"),
        job("old", 1, "colorways", "review", { colorwayIds: ["a"] }),
      ],
    });
    expect(planNextStep(base, config).step).toEqual({ kind: "idle" });
    const requested = {
      ...base,
      batch: { ...batch, colours_requested_at: "2026-09-27T09:30:00Z" },
    };
    expect(planNextStep(requested, config).step).toEqual({
      kind: "queue_colours",
      productId: "product-1",
      colorwayIds: ["b", "c", "d"],
    });
  });

  it("checks the fidelity of finished images from this batch only", () => {
    const plan = planNextStep(
      snapshot({
        items: [item(0, "review")],
        jobs: [job("f0", 0, "front_back", "review")],
        unchecked: [
          { id: "other", catalogue_job_id: "elsewhere", created_at: "2026-09-27T09:00:00Z" },
          { id: "mine", catalogue_job_id: "f0", created_at: "2026-09-27T09:01:00Z" },
        ],
      }),
      config,
    );
    expect(plan.step).toEqual({ kind: "check", generationId: "mine" });
  });

  it("counts a colour job's images", () => {
    expect(slotsOf(job("c", 0, "colorways", "queued", { colorwayIds: ["a", "b", "c"] }))).toBe(3);
    expect(slotsOf(job("f", 0, "front_back", "queued"))).toBe(2);
  });
});
