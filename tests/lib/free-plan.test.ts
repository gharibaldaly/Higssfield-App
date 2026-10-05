import { describe, expect, it } from "vitest";

import {
  appliedOf,
  freeMetaOf,
  freeModeFor,
  freeRequestSchema,
  planFreeRequest,
} from "@/lib/generations/free-plan";
import type { ModelSpec } from "@/lib/providers/higgsfield/types";

const imageModel: ModelSpec = {
  id: "edit-model",
  label: "Edit Model",
  endpoint: "vendor/edit",
  kind: "image",
  modes: ["text-to-image", "image-to-image"],
  fixedParams: {},
  params: {
    prompt: { field: "prompt" },
    negativePrompt: { field: "negative_prompt" },
    image: { field: "image_urls", format: "url_array", max: 3, required: false },
    aspectRatio: {
      field: "aspect_ratio",
      options: [
        { value: "1:1", label: "1:1" },
        { value: "4:5", label: "4:5" },
        { value: "16:9", label: "16:9" },
      ],
      default: "1:1",
      verified: true,
    },
    resolution: {
      field: "resolution",
      options: [
        { value: "1k", label: "1k" },
        { value: "2k", label: "2k" },
      ],
      verified: true,
    },
  },
  source: "docs",
};

const videoModel: ModelSpec = {
  id: "clip-model",
  label: "Clip Model",
  endpoint: "vendor/clip",
  kind: "video",
  modes: ["image-to-video"],
  fixedParams: {},
  params: {
    prompt: { field: "prompt" },
    image: { field: "image_url", format: "url", max: 1, required: true },
    duration: { field: "duration", options: [5, 10], default: 5, verified: true },
  },
  source: "docs",
};

const request = (overrides: Partial<Parameters<typeof planFreeRequest>[1]> = {}) =>
  freeRequestSchema.parse({
    kind: "image",
    modelId: "edit-model",
    prompt: "a satin robe",
    ...overrides,
  });

describe("freeModeFor", () => {
  it("follows the references", () => {
    expect(freeModeFor("image", false)).toBe("text-to-image");
    expect(freeModeFor("image", true)).toBe("image-to-image");
    expect(freeModeFor("video", false)).toBe("text-to-video");
    expect(freeModeFor("video", true)).toBe("image-to-video");
  });
});

describe("planFreeRequest", () => {
  it("runs a text prompt as text-to-image with the model's defaults", () => {
    const plan = planFreeRequest(imageModel, request());
    expect(plan.mode).toBe("text-to-image");
    expect(plan.aspectRatio).toBe("1:1");
    expect(plan.resolution).toBe("2k");
    expect(plan.durationS).toBeNull();
    expect(plan.count).toBe(1);
    expect(plan.warnings).toEqual([]);
  });

  it("keeps the chosen size, quality and count", () => {
    const plan = planFreeRequest(
      imageModel,
      request({ aspectRatio: "4:5", resolution: "1k", count: 3 }),
    );
    expect(plan).toMatchObject({ aspectRatio: "4:5", resolution: "1k", count: 3 });
  });

  it("switches to image-to-image with references and trims them to the model's cap", () => {
    const plan = planFreeRequest(
      imageModel,
      request({ referencePaths: ["o/a.jpg", "o/b.jpg", "o/c.jpg", "o/d.jpg", "o/a.jpg"] }),
    );
    expect(plan.mode).toBe("image-to-image");
    expect(plan.referencePaths).toEqual(["o/a.jpg", "o/b.jpg", "o/c.jpg"]);
    expect(plan.warnings[0]).toMatch(/takes 3 reference/);
  });

  it("warns when the size is not offered and falls back", () => {
    const plan = planFreeRequest(imageModel, request({ aspectRatio: "9:16" }));
    expect(plan.aspectRatio).toBe("1:1");
    expect(plan.warnings[0]).toMatch(/no 9:16/);
  });

  it("refuses a model of the other kind", () => {
    expect(() => planFreeRequest(videoModel, request())).toThrow(/makes videos/);
  });

  it("requires a reference for a model that needs one", () => {
    expect(() =>
      planFreeRequest(videoModel, request({ kind: "video", modelId: "clip-model" })),
    ).toThrow(/reference image/);
  });

  it("refuses references for a text-only model", () => {
    const textOnly: ModelSpec = {
      ...imageModel,
      modes: ["text-to-image"],
      params: { prompt: { field: "prompt" } },
    };
    expect(() => planFreeRequest(textOnly, request({ referencePaths: ["o/a.jpg"] }))).toThrow(
      /text only/,
    );
  });

  it("picks the smallest duration that covers the request", () => {
    const plan = planFreeRequest(
      videoModel,
      request({ kind: "video", modelId: "clip-model", referencePaths: ["o/a.jpg"], durationS: 7 }),
    );
    expect(plan.mode).toBe("image-to-video");
    expect(plan.durationS).toBe(10);
    expect(plan.warnings[0]).toMatch(/no 7s/);
  });
});

describe("stored params", () => {
  it("reads the studio's meta and what was applied", () => {
    const params = {
      prompt: "x",
      _applied: { aspectRatio: "4:5", resolution: "2k", durationS: null, referenceCount: 0 },
      _meta: { studio: "free", batch: "b1", index: 1, count: 2, negativePrompt: "blurry" },
    };
    expect(freeMetaOf(params)).toEqual({
      studio: "free",
      batch: "b1",
      index: 1,
      count: 2,
      negativePrompt: "blurry",
    });
    expect(appliedOf(params)).toEqual({ aspectRatio: "4:5", resolution: "2k", durationS: null });
    expect(freeMetaOf({ _meta: { slotLabel: "lace" } })).toBeNull();
    expect(freeMetaOf(null)).toBeNull();
  });
});
