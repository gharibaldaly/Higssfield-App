import { specsFromDocs } from "@/lib/providers/higgsfield/docs-catalog";
import type { ModelSpecInput } from "@/lib/providers/higgsfield/types";

/**
 * Built-in model registry: every image and video workflow documented on
 * docs.higgsfield.ai that the studio can feed (see docs-catalog.ts). More
 * models can be added without a deploy in Settings → Models (custom models)
 * or via HIGGSFIELD_MODELS_URL. See CLAUDE.md → Decisions log.
 */
export const BUILTIN_MODELS: ModelSpecInput[] = specsFromDocs();

const COMMON_ASPECT_RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "4:3", "3:2", "16:9", "21:9"].map(
  (label) => ({ value: label, label }),
);

/** Mock models used when no Higgsfield key is configured (or HIGGSFIELD_MOCK=1). */
export const MOCK_MODELS: ModelSpecInput[] = [
  {
    id: "mock-image",
    label: "Mock image model",
    endpoint: "mock/image",
    kind: "image",
    modes: ["text-to-image", "image-to-image"],
    description: "Local placeholder renders — no credits used.",
    params: {
      prompt: { field: "prompt" },
      negativePrompt: { field: "negative_prompt" },
      image: { field: "image_urls", format: "url_array", max: 4, required: false },
      aspectRatio: { field: "aspect_ratio", options: COMMON_ASPECT_RATIOS, default: "4:5" },
      resolution: {
        field: "resolution",
        options: [
          { value: "1K", label: "1K" },
          { value: "2K", label: "2K" },
        ],
        default: "2K",
      },
      seed: { field: "seed" },
    },
    source: "mock",
  },
  {
    id: "mock-video",
    label: "Mock video model",
    endpoint: "mock/video",
    kind: "video",
    modes: ["image-to-video", "text-to-video"],
    description: "Local placeholder clips (still frames) — no credits used.",
    params: {
      prompt: { field: "prompt" },
      negativePrompt: { field: "negative_prompt" },
      image: { field: "image_url", format: "url", max: 1, required: false },
      aspectRatio: {
        field: "aspect_ratio",
        options: ["9:16", "1:1", "4:5", "16:9"].map((label) => ({ value: label, label })),
        default: "9:16",
      },
      resolution: {
        field: "resolution",
        options: [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
        default: "1080p",
      },
      duration: { field: "duration", options: [2, 3, 4, 5, 6, 8, 10], default: 3 },
      seed: { field: "seed" },
    },
    source: "mock",
  },
];
