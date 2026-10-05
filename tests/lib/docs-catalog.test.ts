import { describe, expect, it } from "vitest";

import { specFromWorkflow, specsFromDocs } from "@/lib/providers/higgsfield/docs-catalog";
import snapshot from "@/lib/providers/higgsfield/docs/workflows.json";
import { modelSpecSchema, type ModelSpecInput } from "@/lib/providers/higgsfield/types";

const specs = specsFromDocs();
const byEndpoint = (endpoint: string): ModelSpecInput => {
  const found = specs.find((spec) => spec.endpoint === endpoint);
  if (!found) throw new Error(`missing ${endpoint}`);
  return found;
};

describe("models from the Higgsfield docs", () => {
  it("turns every workflow the studio can feed into a valid, uniquely named model", () => {
    for (const spec of specs) expect(() => modelSpecSchema.parse(spec)).not.toThrow();
    expect(new Set(specs.map((spec) => spec.id)).size).toBe(specs.length);
    expect(specs.every((spec) => spec.source === "docs" && spec.family)).toBe(true);
    expect(specs.filter((spec) => spec.kind === "image").length).toBeGreaterThanOrEqual(10);
    expect(specs.filter((spec) => spec.kind === "video").length).toBeGreaterThanOrEqual(40);
  });

  it("leaves out only workflows that need a source video or train a character", () => {
    const listed = new Set(specs.map((spec) => spec.endpoint));
    const skipped = snapshot.families.flatMap((family) =>
      family.workflows.filter((workflow) => !listed.has(workflow.endpoint)),
    );
    for (const workflow of skipped) {
      const required = (workflow.schema as { required?: string[] }).required ?? [];
      const needsVideo = required.some((field) => field === "video_url" || field === "video_urls");
      expect(needsVideo || workflow.output === null).toBe(true);
    }
    expect(listed.has("v1/custom-references")).toBe(false);
  });

  it("makes Grok Image 2.0 the default editor and Kling 3.0 Pro the default animator", () => {
    expect(specs.find((spec) => spec.modes.includes("image-to-image"))?.endpoint).toBe(
      "xai/grok-imagine-image-2.0",
    );
    expect(specs.find((spec) => spec.modes.includes("image-to-video"))?.endpoint).toBe(
      "kling-video/v3.0/pro/image-to-video",
    );
  });

  it("flags Marketing Studio Image as a known problem and ranks it last among image models", () => {
    const images = specs.filter((spec) => spec.kind === "image");
    const marketing = images.filter((spec) => spec.endpoint.startsWith("marketing-studio/image"));
    expect(marketing.length).toBeGreaterThan(0);
    for (const spec of marketing) expect(spec.knownIssue).toMatch(/failed without a reason/);
    expect(images.slice(-marketing.length).map((spec) => spec.endpoint)).toEqual(
      marketing.map((spec) => spec.endpoint),
    );
    expect(byEndpoint("xai/grok-imagine-image-2.0").knownIssue).toBeUndefined();
  });

  it("reads references, ratios, tiers and durations from each schema", () => {
    const grok = byEndpoint("xai/grok-imagine-image-2.0");
    expect(grok.modes).toEqual(["text-to-image", "image-to-image"]);
    // Higgsfield's schema allows ten references; xAI documents five for an edit.
    expect(grok.params.image).toEqual({
      field: "image_urls",
      format: "url_array",
      max: 5,
      required: false,
    });
    expect(grok.sourceNote).toContain("at most 5 references");
    expect(grok.sourceNote).toContain("the schema allows 10");
    expect(grok.params.resolution?.options.map((option) => option.label)).toEqual(["1k", "2k"]);

    const qwen = byEndpoint("alibaba/qwen-image-3/edit");
    expect(qwen.modes).toEqual(["image-to-image"]);
    expect(qwen.params.image).toMatchObject({ max: 3, required: true });

    const seedance = byEndpoint("bytedance/seedance-2.5/reference-to-video");
    expect(seedance.modes).toEqual(["image-to-video"]);
    expect(seedance.params.duration?.options[0]).toBe(4);
    expect(seedance.params.duration?.options.at(-1)).toBe(30);
    expect(seedance.params.image?.max).toBe(16);

    const kling = byEndpoint("kling-video/v3.0/pro/image-to-video");
    expect(kling.params.image).toEqual({
      field: "image_url",
      format: "url",
      max: 1,
      required: true,
    });
    expect(kling.params.aspectRatio).toBeUndefined();
  });

  it("applies the limits the usage notes state but the schemas do not", () => {
    expect(byEndpoint("kling-video/v3.0/pro/image-to-video").params.prompt.maxChars).toBe(2500);
    expect(byEndpoint("kling-video/v3.0-turbo/text-to-video").params.prompt.maxChars).toBe(3072);
    const minimax = byEndpoint("minimax/h3/image-to-video");
    expect(minimax.params.prompt.maxChars).toBe(7000);
    expect(minimax.params.aspectRatio).toBeUndefined();
    expect(byEndpoint("alibaba/happy-horse/v1.1/reference-to-video").params.image?.max).toBe(9);
    const wan = byEndpoint("wan/v2.7/reference-to-video");
    expect(wan.params.image).toMatchObject({ max: 5, required: true });
    expect(wan.modes).toEqual(["image-to-video"]);
    expect(
      byEndpoint("xai/grok-imagine-video/v1.5/reference-to-video").params.resolution?.options.map(
        (option) => option.label,
      ),
    ).toEqual(["480p", "720p"]);
    const o3 = byEndpoint("kling-video/o3/image-reference");
    expect(o3.params.image?.max).toBe(4);
    expect(o3.sourceNote).toContain("no documented maximum");
  });

  it("keeps prompts verbatim and turns native audio off wherever a workflow has the switch", () => {
    expect(byEndpoint("alibaba/qwen-image-3/edit").fixedParams).toEqual({
      prompt_extend: false,
      enable_thinking: false,
    });
    // Marketing Studio's default automatic filter refused every garment image (2026-09-28).
    for (const endpoint of [
      "marketing-studio/image",
      "marketing-studio/image/flare",
      "marketing-studio/image/sunburst",
    ]) {
      expect(byEndpoint(endpoint).fixedParams).toEqual({
        enhance_prompt: false,
        moderation: "low",
      });
    }
    expect(byEndpoint("minimax/hailuo-2.3/standard/image-to-video").fixedParams).toEqual({
      prompt_optimizer: false,
    });
    expect(byEndpoint("bytedance/seedance-2.0/image-to-video").fixedParams).toEqual({
      generate_audio: false,
    });
    expect(byEndpoint("kling-video/v3.0/pro/image-to-video").fixedParams).toEqual({
      sound: "off",
    });
    expect(byEndpoint("xai/grok-imagine-image-2.0").fixedParams).toEqual({});
  });

  it("sorts resolution tiers and skips workflows it cannot feed", () => {
    const family = { slug: "test", kind: "video" as const, title: "Test", description: "" };
    const workflow = {
      slug: "i2v",
      title: "Image to video",
      endpoint: "vendor/test/image-to-video",
      notes: [],
      output: "video" as const,
      schema: {
        required: ["prompt", "image_url"],
        properties: {
          prompt: { type: "string" },
          image_url: { type: "string" },
          resolution: { type: "string", enum: ["1080p", "480p", "4k", "720p"] },
          duration: { type: "number", minimum: 1.5, maximum: 4 },
        },
      },
    };
    const spec = specFromWorkflow(family, workflow, "2026-09-27");
    expect(spec?.params.resolution?.options.map((option) => option.label)).toEqual([
      "480p",
      "720p",
      "1080p",
      "4k",
    ]);
    expect(spec?.params.duration?.options).toEqual([2, 3, 4]);
    expect(
      specFromWorkflow(
        family,
        {
          ...workflow,
          schema: {
            required: ["prompt", "video_url"],
            properties: { ...workflow.schema.properties, video_url: { type: "string" } },
          },
        },
        "2026-09-27",
      ),
    ).toBeNull();
    expect(specFromWorkflow(family, { ...workflow, output: "images" }, "2026-09-27")).toBeNull();
  });
});
