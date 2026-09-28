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

const GROK = "xai-grok-imagine-image-2.0";
const QWEN_EDIT = "alibaba-qwen-image-3-edit";
const SOUL_V2 = "higgsfield-ai-soul-v2-standard";
const KLING = "kling-video-v3.0-pro-image-to-video";
const SEEDANCE_REFS = "bytedance-seedance-2.0-reference-to-video";

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
    const grok = capabilitiesOf(spec(GROK));
    expect(grok.modes).toEqual(["text-to-image", "image-to-image"]);
    // xAI documents five source images per edit (Higgsfield's schema says ten).
    expect(grok.maxReferenceImages).toBe(5);
    expect(grok.aspectRatios).toContain("3:4");
    expect(grok.resolutions).toEqual(["1k", "2k"]);
    const kling = capabilitiesOf(spec(KLING));
    expect(kling.durations[0]).toBe(3);
    expect(kling.maxDurationS).toBe(15);
    expect(kling.maxPromptChars).toBe(2500);
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
    expect(pickModel(registry, "image-to-image")?.id).toBe(GROK);
    expect(pickModel(registry, "image-to-video")?.id).toBe(KLING);
    expect(pickModel(registry, "image-to-video", SEEDANCE_REFS)?.id).toBe(SEEDANCE_REFS);
    expect(pickModel(registry, "image-to-image", KLING)?.id).toBe(GROK);
  });
});

describe("buildProviderInput", () => {
  it("sends Grok Image 2.0 its references as an ordered URL list", () => {
    const built = buildProviderInput(spec(GROK), {
      mode: "image-to-image",
      prompt: "Front view",
      referenceUrls: ["https://example.com/front.jpg", "https://example.com/lace.jpg"],
      aspectRatio: "4:5",
      resolution: "2k",
    });
    expect(built.body).toEqual({
      prompt: "Front view",
      image_urls: ["https://example.com/front.jpg", "https://example.com/lace.jpg"],
      aspect_ratio: "3:4",
      resolution: "2k",
    });
    expect(built.applied).toMatchObject({
      aspectRatio: "3:4",
      resolution: "2k",
      referenceCount: 2,
    });
    expect(built.warnings.join(" ")).toContain("4:5");
  });

  it("keeps Qwen from rewriting the prompt and caps its references at three", () => {
    const built = buildProviderInput(spec(QWEN_EDIT), {
      mode: "image-to-image",
      prompt: "Front view",
      referenceUrls: ["a", "b", "c", "d"].map((name) => `https://example.com/${name}.jpg`),
      aspectRatio: "3:4",
      resolution: "2k",
    });
    expect(built.body).toMatchObject({
      prompt_extend: false,
      enable_thinking: false,
      image_urls: ["a", "b", "c"].map((name) => `https://example.com/${name}.jpg`),
      aspect_ratio: "3:4",
      resolution: "2k",
    });
    expect(built.warnings.join(" ")).toContain("accepts 3 reference");
  });

  it("animates the first reference with Kling 3.0, sound off", () => {
    const built = buildProviderInput(spec(KLING), {
      mode: "image-to-video",
      prompt: "Slow push-in",
      referenceUrls: ["https://example.com/a.png", "https://example.com/b.png"],
      durationS: 2.5,
    });
    expect(built.body).toEqual({
      sound: "off",
      prompt: "Slow push-in",
      image_url: "https://example.com/a.png",
      duration: 3,
    });
    expect(built.warnings.join(" ")).toContain("accepts 1 reference");
  });

  it("rejects missing required references and unsupported modes", () => {
    expect(() =>
      buildProviderInput(spec(KLING), {
        mode: "image-to-video",
        prompt: "x",
        referenceUrls: [],
      }),
    ).toThrow(/reference image/);
    expect(() =>
      buildProviderInput(spec(SOUL_V2), {
        mode: "image-to-image",
        prompt: "x",
        referenceUrls: ["https://example.com/a.png"],
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

  it("truncates prompts and negative prompts to the model's limits", () => {
    const model = spec(GROK);
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

    const pixverse = buildProviderInput(spec("pixverse-v6-image-to-video"), {
      mode: "image-to-video",
      prompt: "x",
      negativePrompt: "n".repeat(3000),
      referenceUrls: ["https://example.com/a.png"],
    });
    expect(String(pixverse.body.negative_prompt)).toHaveLength(2048);
    expect(pixverse.warnings.join(" ")).toContain("Negative prompt shortened");
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
    expect(highestResolution(spec(GROK))).toBe("2k");
    expect(highestResolution(spec(SEEDANCE_REFS))).toBe("4k");
    expect(highestResolution(spec(KLING))).toBeNull();
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
