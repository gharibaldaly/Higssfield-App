import { describe, expect, it } from "vitest";

import { mergeServerViews, type GenerationView } from "@/lib/domain/generation";

function view(id: string, patch: Partial<GenerationView> = {}): GenerationView {
  return {
    id,
    status: "completed",
    kind: "image",
    purpose: "ghost_front",
    modelId: "grok-image-2",
    provider: "higgsfield",
    slot: "front",
    url: `https://storage.test/${id}.png`,
    thumbUrl: `https://storage.test/${id}-thumb.jpg`,
    mimeType: "image/png",
    error: null,
    note: null,
    reviewStatus: "pending",
    isFavorite: false,
    createdAt: "2026-09-28T10:00:00.000Z",
    submittedAt: "2026-09-28T10:00:01.000Z",
    completedAt: "2026-09-28T10:01:00.000Z",
    review: null,
    cost: null,
    costUnit: null,
    backgroundOk: true,
    waitingReason: null,
    ...patch,
  };
}

const onScreen = (...views: GenerationView[]) => new Map(views.map((item) => [item.id, item]));
const none = new Map<string, GenerationView["reviewStatus"]>();

describe("mergeServerViews", () => {
  it("takes the server's views and keeps views the server did not send", () => {
    const merged = mergeServerViews(
      onScreen(view("a"), view("b")),
      [view("a", { review: { score: 90 } }), view("c")],
      none,
    );
    expect([...merged.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(merged.get("a")?.review).toEqual({ score: 90 });
  });

  it("never lets a stale pending status overwrite a view that already settled", () => {
    const merged = mergeServerViews(
      onScreen(view("a", { status: "completed" })),
      [view("a", { status: "in_progress", url: null })],
      none,
    );
    expect(merged.get("a")?.status).toBe("completed");
  });

  it("keeps a decision when the server data predates it", () => {
    const merged = mergeServerViews(
      onScreen(view("a", { reviewStatus: "approved" })),
      [view("a", { reviewStatus: "pending", review: { score: 72 } })],
      new Map([["a", "approved"]]),
    );
    expect(merged.get("a")).toMatchObject({ reviewStatus: "approved", review: { score: 72 } });
  });

  it("shows a regeneration's rejected output as decided until the new image replaces it", () => {
    const merged = mergeServerViews(
      onScreen(view("a", { reviewStatus: "rejected" })),
      [view("a")],
      new Map([["a", "rejected"]]),
    );
    expect(merged.get("a")?.reviewStatus).toBe("rejected");
  });

  it("takes the server's view whole once it agrees with the decision", () => {
    const server = view("a", { reviewStatus: "approved", review: { score: 95 } });
    const merged = mergeServerViews(
      onScreen(view("a", { reviewStatus: "approved" })),
      [server],
      new Map([["a", "approved"]]),
    );
    expect(merged.get("a")).toEqual(server);
  });

  it("leaves the views on screen untouched", () => {
    const current = onScreen(view("a"));
    mergeServerViews(current, [view("a", { reviewStatus: "approved" })], none);
    expect(current.get("a")?.reviewStatus).toBe("pending");
  });
});
