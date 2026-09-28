import { describe, expect, it } from "vitest";

import {
  countOutputs,
  coverPaths,
  currentOutputs,
  splitByBatch,
  type OutputRow,
} from "@/lib/library/grouping";

let clock = Date.parse("2026-09-28T10:00:00.000Z");
function row(patch: Partial<OutputRow> & { id: string }): OutputRow {
  clock += 60_000;
  return {
    product_id: "prod-1",
    catalogue_job_id: "job-1",
    slot: "front",
    purpose: "ghost_front",
    kind: "image",
    status: "completed",
    review_status: "pending",
    storage_path: `owner/generations/${patch.id}.png`,
    created_at: new Date(clock).toISOString(),
    ...patch,
  };
}

describe("currentOutputs", () => {
  it("keeps only the latest attempt of each view of a job, newest first", () => {
    const rows = [
      row({ id: "front-1", slot: "front", review_status: "rejected" }),
      row({ id: "back-1", slot: "back" }),
      row({ id: "front-2", slot: "front" }),
    ];
    expect(currentOutputs(rows).map((item) => item.id)).toEqual(["front-2", "back-1"]);
  });

  it("keeps views of different jobs apart and every generation without a job", () => {
    const rows = [
      row({ id: "a", catalogue_job_id: "job-1", slot: "front" }),
      row({ id: "b", catalogue_job_id: "job-2", slot: "front" }),
      row({ id: "sheet", catalogue_job_id: null, slot: null, purpose: "product_sheet" }),
      row({ id: "shot", catalogue_job_id: null, slot: null, purpose: "shot_video", kind: "video" }),
    ];
    expect(currentOutputs(rows).map((item) => item.id)).toEqual(["shot", "sheet", "b", "a"]);
  });
});

describe("countOutputs", () => {
  it("counts finished images that are not being regenerated, and the approved ones", () => {
    const rows = [
      row({ id: "1", review_status: "approved" }),
      row({ id: "2" }),
      row({ id: "3", review_status: "rejected" }),
      row({ id: "4", status: "in_progress" }),
      row({ id: "5", status: "failed" }),
    ];
    expect(countOutputs(rows)).toEqual({ images: 2, approved: 1 });
  });
});

describe("splitByBatch", () => {
  it("files a generation under its batch through its job, else under its product", () => {
    const rows = [
      row({ id: "in-batch", catalogue_job_id: "job-b" }),
      row({ id: "own-job", catalogue_job_id: "job-solo", product_id: "prod-2" }),
      row({ id: "no-job", catalogue_job_id: null, product_id: "prod-2" }),
      row({ id: "orphan", catalogue_job_id: null, product_id: null }),
    ];
    const { byBatch, byProduct } = splitByBatch(rows, new Map([["job-b", "batch-1"]]));
    expect([...byBatch.keys()]).toEqual(["batch-1"]);
    expect(byBatch.get("batch-1")?.map((item) => item.id)).toEqual(["in-batch"]);
    expect(byProduct.get("prod-2")?.map((item) => item.id)).toEqual(["own-job", "no-job"]);
    expect(byProduct.size).toBe(1);
  });
});

describe("coverPaths", () => {
  it("takes one cover per model in order: approved front, else a front, else any image", () => {
    const current = [
      row({ id: "m1-front", product_id: "m1", review_status: "pending" }),
      row({ id: "m1-front-ok", product_id: "m1", review_status: "approved" }),
      row({ id: "m2-back", product_id: "m2", slot: "back", purpose: "ghost_back" }),
      row({ id: "m2-front", product_id: "m2", review_status: "rejected" }),
      row({ id: "m3-video", product_id: "m3", kind: "video", purpose: "shot_video", slot: null }),
      row({ id: "m4-front", product_id: "m4", status: "in_progress" }),
    ];
    expect(coverPaths(["m1", "m2", "m3", "m4"], current)).toEqual([
      "owner/generations/m1-front-ok.png",
      "owner/generations/m2-back.png",
    ]);
  });

  it("stops at the limit", () => {
    const current = ["a", "b", "c"].map((id) => row({ id, product_id: id }));
    expect(coverPaths(["a", "b", "c"], current, 2)).toHaveLength(2);
  });
});
