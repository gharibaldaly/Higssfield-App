import type { ModelSpecInput } from "@/lib/providers/higgsfield/types";

/**
 * Built-in model registry.
 *
 * The official docs (docs.higgsfield.ai) were not reachable from the build
 * sandbox, so this list only contains endpoints and parameters that appear in
 * Higgsfield's own published SDKs:
 *   - @higgsfield/client 0.2.6 (npm): README + dist/v2/types.d.ts + helpers.d.ts
 *   - higgsfield-client 0.2.0 (PyPI): README
 * Option lists marked `verified: false` are sensible defaults that still need
 * checking against the docs. More models can be added without a deploy in
 * Settings → Models (custom models) or via HIGGSFIELD_MODELS_URL.
 * See CLAUDE.md → Decisions log.
 */

const SOUL_SIZES = [
  // Largest size per aspect ratio from SoulSize in helpers.d.ts.
  { value: "1536x1536", label: "1:1" },
  { value: "1536x2048", label: "3:4" },
  { value: "1344x2016", label: "2:3" },
  { value: "1152x2048", label: "9:16" },
  { value: "2048x1536", label: "4:3" },
  { value: "2016x1344", label: "3:2" },
  { value: "2048x1152", label: "16:9" },
];

const COMMON_ASPECT_RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "4:3", "3:2", "16:9", "21:9"].map(
  (label) => ({ value: label, label }),
);

export const BUILTIN_MODELS: ModelSpecInput[] = [
  {
    id: "higgsfield-soul",
    label: "Higgsfield Soul",
    endpoint: "/v1/text2image/soul",
    kind: "image",
    modes: ["text-to-image", "image-to-image"],
    description: "Photographic stills; accepts one image reference.",
    fixedParams: { batch_size: 1, enhance_prompt: false },
    params: {
      prompt: { field: "prompt" },
      image: { field: "image_reference", format: "image_reference", max: 1, required: false },
      aspectRatio: { field: "width_and_height", options: SOUL_SIZES, default: "3:4" },
      resolution: {
        field: "quality",
        options: [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
        default: "1080p",
      },
      seed: { field: "seed" },
    },
    source: "sdk",
    sourceNote: "SoulText2ImageInput + SoulSize/SoulQuality in @higgsfield/client 0.2.6",
  },
  {
    id: "flux-kontext-max",
    label: "FLUX.1 Kontext [max]",
    endpoint: "flux-pro/kontext/max/text-to-image",
    kind: "image",
    modes: ["text-to-image"],
    description: "Text-to-image; strong typography and layout (good for product sheets).",
    fixedParams: { safety_tolerance: 2 },
    params: {
      prompt: { field: "prompt" },
      aspectRatio: {
        field: "aspect_ratio",
        options: COMMON_ASPECT_RATIOS,
        default: "16:9",
        verified: false,
      },
      seed: { field: "seed" },
    },
    source: "sdk",
    sourceNote:
      "Endpoint and params from the @higgsfield/client README example; aspect ratios beyond 9:16 and 1:1 unverified",
  },
  {
    id: "seedream-v4",
    label: "Seedream 4.0",
    endpoint: "bytedance/seedream/v4/text-to-image",
    kind: "image",
    modes: ["text-to-image"],
    description: "Text-to-image with 2K output.",
    fixedParams: { camera_fixed: false },
    params: {
      prompt: { field: "prompt" },
      aspectRatio: {
        field: "aspect_ratio",
        options: COMMON_ASPECT_RATIOS,
        default: "16:9",
        verified: false,
      },
      resolution: {
        field: "resolution",
        options: [{ value: "2K", label: "2K" }],
        default: "2K",
      },
    },
    source: "sdk",
    sourceNote: "Endpoint and params from the higgsfield-client (Python) README example",
  },
  ...(["lite", "turbo", "standard"] as const).map((variant): ModelSpecInput => ({
    id: `higgsfield-dop-${variant}`,
    label: `Higgsfield DoP ${variant[0]!.toUpperCase()}${variant.slice(1)}`,
    endpoint: "/v1/image2video/dop",
    kind: "video",
    modes: ["image-to-video"],
    description:
      variant === "lite"
        ? "Image-to-video, basic speed and quality."
        : variant === "turbo"
          ? "Image-to-video, 2× speed with priority queue."
          : "Image-to-video, highest quality with priority queue.",
    fixedParams: { model: `dop-${variant}`, enhance_prompt: false },
    params: {
      prompt: { field: "prompt" },
      image: { field: "input_images", format: "input_images", max: 1, required: true },
      seed: { field: "seed" },
    },
    source: "sdk",
    sourceNote:
      "DoPImage2VideoInput + DoPModel in @higgsfield/client 0.2.6 (no duration/aspect params)",
  })),
  {
    id: "higgsfield-speak",
    label: "Higgsfield Speak",
    endpoint: "/v1/speak/higgsfield",
    kind: "video",
    modes: ["speech-to-video"],
    description: "Talking-avatar video from an image and WAV audio (for the coming UGC module).",
    params: {
      prompt: { field: "prompt" },
      image: { field: "input_image", format: "image_reference", max: 1, required: true },
      resolution: {
        field: "quality",
        options: [
          { value: "mid", label: "mid" },
          { value: "high", label: "high" },
        ],
        default: "high",
      },
      duration: { field: "duration", options: [5, 10, 15], default: 5 },
      seed: { field: "seed" },
    },
    source: "sdk",
    sourceNote: "SpeakVideoInput in @higgsfield/client 0.2.6 (also needs input_audio)",
  },
];

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
