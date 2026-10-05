import { describe, expect, it } from "vitest";

import { matchDuration, preferredResolution } from "@/lib/providers/higgsfield/fit";

describe("preferredResolution", () => {
  it("keeps the highest tier for images", () => {
    expect(preferredResolution("image", ["1k", "2k"], "1k")).toBe("2k");
  });

  it("takes 1080p for video when offered, never the top tier by default", () => {
    expect(preferredResolution("video", ["480p", "720p", "1080p", "4k"], "720p")).toBe("1080p");
  });

  it("falls back to the model's own default, then the highest tier, for video", () => {
    expect(preferredResolution("video", ["480p", "720p"], "720p")).toBe("720p");
    expect(preferredResolution("video", ["480p", "720p"], null)).toBe("720p");
    expect(preferredResolution("video", [], "720p")).toBeNull();
  });
});

describe("matchDuration", () => {
  it("rounds a 3 s shot up to a model's shortest 4 s clip", () => {
    expect(matchDuration([4, 5, 6, 10, 15], 3)).toBe(4);
    expect(matchDuration([5, 10], 20)).toBe(10);
  });
});
