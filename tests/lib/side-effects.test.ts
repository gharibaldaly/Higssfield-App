import { describe, expect, it } from "vitest";

import {
  adProjectStatusFor,
  catalogueJobStatusFor,
  latestBySlot,
} from "@/lib/generations/side-effects";

describe("latestBySlot", () => {
  it("keeps the newest generation per slot and treats unslotted rows individually", () => {
    const rows = [
      { id: "a", slot: "front", created_at: "2026-09-01T10:00:00Z" },
      { id: "b", slot: "front", created_at: "2026-09-01T11:00:00Z" },
      { id: "c", slot: "back", created_at: "2026-09-01T09:00:00Z" },
      { id: "d", slot: null, created_at: "2026-09-01T08:00:00Z" },
      { id: "e", slot: null, created_at: "2026-09-01T08:30:00Z" },
    ];
    const latest = latestBySlot(rows);
    expect(latest.get("front")?.id).toBe("b");
    expect(latest.get("back")?.id).toBe("c");
    expect(latest.get("d")?.id).toBe("d");
    expect(latest.get("e")?.id).toBe("e");
    expect(latest.size).toBe(4);
  });
});

describe("catalogueJobStatusFor", () => {
  it("stays generating while anything is pending", () => {
    expect(catalogueJobStatusFor(["queued", "completed"])).toBe("generating");
    expect(catalogueJobStatusFor(["in_progress", "failed"])).toBe("generating");
  });

  it("fails only when nothing completed", () => {
    expect(catalogueJobStatusFor(["failed", "nsfw", "canceled"])).toBe("failed");
    expect(catalogueJobStatusFor(["failed", "completed"])).toBe("review");
    expect(catalogueJobStatusFor([])).toBe("review");
  });
});

describe("adProjectStatusFor", () => {
  it("derives the project status from its shots", () => {
    expect(adProjectStatusFor([{ status: "ready" }, { status: "preview_generating" }])).toBe(
      "generating",
    );
    expect(adProjectStatusFor([{ status: "ready" }, { status: "approved" }])).toBe("review");
    expect(adProjectStatusFor([{ status: "ready" }, { status: "failed" }])).toBe("planned");
    expect(adProjectStatusFor([])).toBe("planned");
  });
});
