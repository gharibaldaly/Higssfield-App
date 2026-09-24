import { describe, expect, it } from "vitest";

import { BUILTIN_MODELS, MOCK_MODELS } from "@/lib/providers/higgsfield/models";
import {
  buildProviderInput,
  buildRegistry,
  capabilitiesOf,
  highestResolution,
  matchAspectRatio,
  matchDuration,
  parseModelSpecs,
  pickModel,
  redactBody,
} from "@/lib/providers/higgsfield/registry";
import { modelSpecSchema, type ModelSpec } from "@/lib/providers/higgsfield/types";

function spec(id: string): ModelSpec {
  const input = [...BUILTIN_MODELS, ...MOCK_MODELS].find((model) => model.id === id);
  if (!input) throw new Error(`missing ${id}`);
  return modelSpecSchema.parse(input);
}

describe("model registry", () => {
  it("parses every built-in and mock model", () => {
    const { specs, errors } = parseModelSpecs([...BUILTIN_MODELS, ...MOCK_MODELS]);
    expect(errors).toEqual([]);
    expect(specs.length).toBe(BUILTIN_MODELS.length + MOCK_MODELS.length);
  });

  it("lists image and video models with capabilities", () => {
    const registry = buildRegistry({ includeReal: true, includeMock: false });
    expect(registry.some((model) => model.kind === "image")).toBe(true);
    expect(registry.some((model) => model.kind === "video")).toBe(true);
    expect(registry.some((model) => model.source === "mock")).toBe(false);
    const soul = capabilitiesOf(spec("higgsfield-soul"));
    expect(soul.maxReferenceImages).toBe(1);
    expect(soul.aspectRatios).toContain("3:4");
    expect(soul.resolutions).toEqual(["720p", "1080p"]);
  });

  it("shows only mock models when the mock provider is active", () => {
    const registry = buildRegistry({ includeReal: false, includeMock: true });
    expect(registry.map((model) => model.id).sort()).toEqual(["mock-image", "mock-video"]);
  });

  it("merges valid custom models and ignores invalid ones", () => {
    const custom = {
      id: "custom-i2v",
      label: "Custom",
      endpoint: "vendor/model/image-to-video",
      kind: "video",
      modes: ["image-to-video"],
      params: {
        prompt: { field: "prompt" },
        image: { field: "image_url", format: "url", max: 1, required: true },
      },
      source: "custom",
    };
    const registry = buildRegistry({
      includeReal: true,
      includeMock: false,
      customModels: [custom, { id: "!!" }],
    });
    const found = registry.find((model) => model.id === "custom-i2v");
    expect(found?.source).toBe("custom");
    expect(registry.some((model) => model.id === "!!")).toBe(false);
  });

  it("picks a model for a mode, preferring the requested one", () => {
    const registry = buildRegistry({ includeReal: true, includeMock: false });
    expect(pickModel(registry, "image-to-video")?.kind).toBe("video");
    expect(pickModel(registry, "image-to-video", "higgsfield-dop-standard")?.id).toBe(
      "higgsfield-dop-standard",
    );
    expect(pickModel(registry, "image-to-image", "higgsfield-dop-standard")?.id).toBe(
      "higgsfield-soul",
    );
  });
});

describe("buildProviderInput", () => {
  it("encodes Soul image-to-image exactly like the official SDK types", () => {
    const built = buildProviderInput(spec("higgsfield-soul"), {
      mode: "image-to-image",
      prompt: "Front view",
      referenceUrls: ["https://example.com/front.jpg"],
      aspectRatio: "3:4",
      resolution: null,
    });
    expect(built.body).toEqual({
      batch_size: 1,
      enhance_prompt: false,
      prompt: "Front view",
      image_reference: { type: "image_url", image_url: "https://example.com/front.jpg" },
      width_and_height: "1536x2048",
      quality: "1080p",
    });
    expect(built.applied).toMatchObject({
      aspectRatio: "3:4",
      resolution: "1080p",
      referenceCount: 1,
    });
  });

  it("falls back to the closest aspect ratio with a warning", () => {
    const built = buildProviderInput(spec("higgsfield-soul"), {
      mode: "text-to-image",
      prompt: "Front view",
      referenceUrls: [],
      aspectRatio: "4:5",
    });
    expect(built.applied.aspectRatio).toBe("3:4");
    expect(built.warnings.join(" ")).toContain("4:5");
  });

  it("encodes DoP image-to-video input_images and the fixed model variant", () => {
    const built = buildProviderInput(spec("higgsfield-dop-turbo"), {
      mode: "image-to-video",
      prompt: "Slow push-in",
      referenceUrls: ["https://example.com/a.png", "https://example.com/b.png"],
      seed: 7,
    });
    expect(built.body).toEqual({
      model: "dop-turbo",
      enhance_prompt: false,
      prompt: "Slow push-in",
      input_images: [{ type: "image_url", image_url: "https://example.com/a.png" }],
      seed: 7,
    });
    expect(built.warnings.join(" ")).toContain("accepts 1 reference");
  });

  it("rejects missing required references and unsupported modes", () => {
    expect(() =>
      buildProviderInput(spec("higgsfield-dop-lite"), {
        mode: "image-to-video",
        prompt: "x",
        referenceUrls: [],
      }),
    ).toThrow(/reference image/);
    expect(() =>
      buildProviderInput(spec("flux-kontext-max"), {
        mode: "image-to-video",
        prompt: "x",
        referenceUrls: [],
      }),
    ).toThrow(/does not support/);
  });

  it("maps durations to the nearest supported clip length", () => {
    const built = buildProviderInput(spec("mock-video"), {
      mode: "image-to-video",
      prompt: "x",
      referenceUrls: ["https://example.com/a.png"],
      durationS: 2.5,
      aspectRatio: "9:16",
    });
    expect(built.body.duration).toBe(3);
    expect(built.body.image_url).toBe("https://example.com/a.png");
    expect(built.body.aspect_ratio).toBe("9:16");
  });

  it("truncates prompts to the model budget", () => {
    const model = spec("higgsfield-soul");
    const limited: ModelSpec = {
      ...model,
      params: { ...model.params, prompt: { field: "prompt", maxChars: 10 } },
    };
    const built = buildProviderInput(limited, {
      mode: "text-to-image",
      prompt: "0123456789ABCDEF",
      referenceUrls: [],
    });
    expect(built.body.prompt).toBe("0123456789");
    expect(built.warnings.length).toBeGreaterThan(0);
  });
});

describe("option matching helpers", () => {
  it("matches aspect ratios exactly or by closeness", () => {
    const options = [
      { value: "1536x2048", label: "3:4" },
      { value: "1152x2048", label: "9:16" },
      { value: "2048x1152", label: "16:9" },
    ];
    expect(matchAspectRatio(options, "9:16")?.value).toBe("1152x2048");
    expect(matchAspectRatio(options, "4:5")?.label).toBe("3:4");
    expect(matchAspectRatio(options, "21:9")?.label).toBe("16:9");
    expect(matchAspectRatio(options, "portrait")).toBeNull();
  });

  it("chooses the shortest duration that covers the request", () => {
    expect(matchDuration([5, 10], 3)).toBe(5);
    expect(matchDuration([10, 5], 5)).toBe(5);
    expect(matchDuration([5, 10], 12)).toBe(10);
  });

  it("finds the highest resolution option", () => {
    expect(highestResolution(spec("higgsfield-soul"))).toBe("1080p");
    expect(highestResolution(spec("higgsfield-dop-lite"))).toBeNull();
  });

  it("redacts signed URLs from stored request bodies", () => {
    const body = {
      prompt: "x",
      input_images: [{ type: "image_url", image_url: "https://signed/abc?token=1" }],
    };
    const redacted = redactBody(
      body,
      new Map([["https://signed/abc?token=1", "storage:owner/a.png"]]),
    );
    expect(JSON.stringify(redacted)).not.toContain("token=1");
    expect(JSON.stringify(redacted)).toContain("storage:owner/a.png");
  });
});
