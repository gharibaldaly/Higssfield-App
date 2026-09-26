import { z } from "zod";

export const GENERATION_MODES = [
  "text-to-image",
  "image-to-image",
  "image-to-video",
  "text-to-video",
  "speech-to-video",
] as const;

export type GenerationMode = (typeof GENERATION_MODES)[number];

export const paramOptionSchema = z.object({
  /** Value sent to the API. */
  value: z.union([z.string(), z.number()]),
  /** Human label, e.g. "3:4" for Soul's "1536x2048". Used for matching requests. */
  label: z.string().min(1),
});

export type ParamOption = z.infer<typeof paramOptionSchema>;

const choiceParamSchema = z.object({
  field: z.string().min(1),
  /** Ordered from smallest/lowest to largest/highest. */
  options: z.array(paramOptionSchema).min(1),
  default: z.string().optional(),
  /** False when the option list was not confirmed against official docs. */
  verified: z.boolean().default(true),
});

export const imageParamSchema = z.object({
  field: z.string().min(1),
  /**
   * How reference URLs are encoded:
   * - input_images:    [{ type: "image_url", image_url }]  (DoP, per official SDK)
   * - image_reference: { type: "image_url", image_url }    (Soul, per official SDK)
   * - url:             "https://…"
   * - url_array:       ["https://…", …]
   */
  format: z.enum(["input_images", "image_reference", "url", "url_array"]),
  max: z.number().int().min(1).max(16),
  required: z.boolean(),
});

export type ImageParam = z.infer<typeof imageParamSchema>;

export const modelSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,80}$/, "lowercase letters, digits, . _ -"),
  label: z.string().min(1).max(80),
  /** POST path on the Higgsfield API, e.g. "/v1/image2video/dop". */
  endpoint: z.string().min(1).max(200),
  kind: z.enum(["image", "video"]),
  modes: z.array(z.enum(GENERATION_MODES)).min(1),
  description: z.string().max(400).optional(),
  fixedParams: z.record(z.string(), z.unknown()).default({}),
  params: z.object({
    prompt: z.object({
      field: z.string().min(1),
      maxChars: z.number().int().positive().optional(),
    }),
    negativePrompt: z.object({ field: z.string().min(1) }).optional(),
    image: imageParamSchema.optional(),
    aspectRatio: choiceParamSchema.optional(),
    resolution: choiceParamSchema.optional(),
    duration: z
      .object({
        field: z.string().min(1),
        options: z.array(z.number().positive()).min(1),
        default: z.number().positive().optional(),
        verified: z.boolean().default(true),
      })
      .optional(),
    seed: z.object({ field: z.string().min(1) }).optional(),
  }),
  /** Where the spec comes from: official SDK source, remote catalogue, owner-added, or mock. */
  source: z.enum(["sdk", "catalog", "custom", "mock"]),
  sourceNote: z.string().max(400).optional(),
});

export type ModelSpec = z.infer<typeof modelSpecSchema>;
export type ModelSpecInput = z.input<typeof modelSpecSchema>;

export type ModelCapabilities = {
  modes: GenerationMode[];
  maxReferenceImages: number;
  referenceRequired: boolean;
  aspectRatios: string[];
  resolutions: string[];
  durations: number[];
  maxDurationS: number | null;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  maxPromptChars: number;
};

/** Provider-neutral request produced by the app's services. */
export type GenerationRequest = {
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string | null;
  referenceUrls: string[];
  aspectRatio?: string | null;
  resolution?: string | null;
  durationS?: number | null;
  seed?: number | null;
};

export type ProviderStatus =
  "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export type ProviderState = {
  requestId: string;
  status: ProviderStatus;
  statusUrl: string | null;
  resultUrls: string[];
  resultKind: "image" | "video" | null;
  cost: { amount: number; unit: "usd" | "credits" } | null;
  error: string | null;
  /** Mock provider returns bytes directly instead of a URL. */
  resultBuffer?: { data: Buffer; mimeType: string } | null;
};

export type SubmitContext = {
  /** Generation row id (used by the mock to derive deterministic output). */
  generationId: string;
  webhookUrl: string | null;
};

export type StatusContext = {
  generationId: string;
  submittedAt: string | null;
  kind: "image" | "video";
  /** Request body as stored (reference URLs replaced by storage paths). */
  params: Record<string, unknown>;
  /** Loads the first isolated reference image (used by the mock provider). */
  loadReference: () => Promise<Buffer | null>;
};

/** Image/video provider used by the generation service. */
export interface ImageVideoProvider {
  readonly id: "higgsfield" | "mock";
  submit(
    spec: ModelSpec,
    body: Record<string, unknown>,
    context: SubmitContext,
  ): Promise<ProviderState>;
  getStatus(requestId: string, context: StatusContext): Promise<ProviderState>;
  cancel(requestId: string): Promise<void>;
}
