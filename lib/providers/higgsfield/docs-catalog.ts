import { z } from "zod";

import { slugForEndpoint } from "@/lib/providers/higgsfield/catalog";
import snapshot from "@/lib/providers/higgsfield/docs/workflows.json";
import type {
  GenerationMode,
  ImageParam,
  ModelSpecInput,
  ParamOption,
} from "@/lib/providers/higgsfield/types";

/**
 * The studio's built-in models, read from Higgsfield's model docs.
 *
 * docs/workflows.json is a snapshot of every image and video workflow on
 * docs.higgsfield.ai (endpoint, usage notes, complete JSON input schema),
 * refreshed with `node scripts/higgsfield/sync-models.mjs`. Each workflow
 * becomes one model: its schema gives the fields and allowed values, and the
 * few limits its notes state but its schema does not are applied below.
 * Workflows the studio cannot feed (a source video, character training) are
 * left out. See CLAUDE.md → Decisions log.
 */

const jsonObject = z.record(z.string(), z.unknown());

const snapshotSchema = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  families: z.array(
    z.object({
      slug: z.string(),
      kind: z.enum(["image", "video"]),
      title: z.string(),
      description: z.string(),
      workflows: z.array(
        z.object({
          slug: z.string(),
          title: z.string(),
          endpoint: z.string(),
          notes: z.array(z.string()),
          output: z.enum(["images", "video"]).nullable(),
          schema: z.object({
            required: z.array(z.string()).optional(),
            properties: z.record(z.string(), jsonObject),
          }),
        }),
      ),
    }),
  ),
});

export type DocsSnapshot = z.infer<typeof snapshotSchema>;
type Family = DocsSnapshot["families"][number];
type Workflow = Family["workflows"][number];
type Property = Record<string, unknown>;

/**
 * Picker order and defaults: the first model that supports a mode is the
 * default for it (see pickModel). Grok Image 2.0 edits with up to ten
 * references while keeping the details of the input; Kling 3.0 Pro animates
 * the approved frame. Families not listed follow in docs order.
 */
const FAMILY_ORDER = [
  "grok-image-2",
  "marketing-studio-image",
  "qwen-image-3",
  "ideogram-4",
  "soul-2",
  "soul-standard",
  "soul-cinema",
  "recraft-v4-1-pro",
  "recraft-v4-1",
  "recraft-v4-1-utility-pro",
  "recraft-v4-1-utility",
  "z-image-turbo",
  "kling-3",
  "seedance-2",
  "seedance-2-5",
  "kling-o3",
  "kling-omni",
  "kling-2-6",
  "kling-2-5-turbo",
  "wan-3",
  "wan-3-prime",
  "wan-2-7",
  "wan-2-6",
  "minimax-h3",
  "hailuo-2-3",
  "pixverse-v6",
  "ltx-2-5",
  "happy-horse-1-1",
  "happy-horse-1",
  "grok-video-1-5",
  "cinema-studio-4",
];

/** Workflows listed first inside their family. */
const WORKFLOW_FIRST = new Set(["kling-video/v3.0/pro/image-to-video"]);

/** Reference fields, in order of preference, and how their URLs are sent. */
const IMAGE_FIELDS: { field: string; format: ImageParam["format"] }[] = [
  { field: "image_urls", format: "url_array" },
  { field: "image_url", format: "url" },
  { field: "first_frame_url", format: "url" },
];

/** References the studio sends when a workflow documents no maximum. */
const DEFAULT_REFERENCE_CAP = 4;
const MAX_REFERENCES = 16;

/**
 * Limits stated in the usage notes but not in the JSON schemas, or tighter
 * limits the model's own maker documents, keyed by endpoint (a trailing "/"
 * matches every endpoint under that path). A reference limit here wins over a
 * larger schema maximum.
 */
const NOTED_LIMITS: Record<
  string,
  {
    promptChars?: number;
    references?: number;
    requiresReferences?: boolean;
    resolutions?: string[];
    dropAspectRatio?: boolean;
  }
> = {
  // "Keep it within 2,500 characters; longer prompts are truncated."
  "kling-video/v3.0/": { promptChars: 2500 },
  "kling-video/v3.0-turbo/image-to-video": { promptChars: 2500 },
  // "Keep prompt within 3,072 characters; longer prompts are truncated."
  "kling-video/v3.0-turbo/text-to-video": { promptChars: 3072 },
  "kling-video/o3/": { promptChars: 2500 },
  "kling-video/omni/": { promptChars: 2500 },
  // "The current provider serializer uses only its first 7,000 characters."
  "minimax/h3/": { promptChars: 7000 },
  // "The output aspect ratio follows the input keyframe even when aspect_ratio is supplied."
  "minimax/h3/image-to-video": { promptChars: 7000, dropAspectRatio: true },
  // "Provide 1–9 reference images … enforced at submission."
  "alibaba/happy-horse/reference-to-video": { references: 9 },
  "alibaba/happy-horse/v1.1/reference-to-video": { references: 9 },
  // "Provide a nonempty image_urls or video_urls array. The combined number of image and video
  // references must not exceed 5."
  "wan/v2.7/reference-to-video": { references: 5, requiresReferences: true },
  // "When image_urls or audio_url is provided, resolution must be 480p or 720p."
  "xai/grok-imagine-video/v1.5/reference-to-video": { resolutions: ["480p", "720p"] },
  // xAI's docs (Multi-Image Editing): "Use up to five source images for a single image edit."
  // Higgsfield's schema allows ten; the studio's first edit, with eight, failed at once.
  "xai/grok-imagine-image-2.0": { references: 5 },
};

function notedLimits(endpoint: string) {
  const exact = NOTED_LIMITS[endpoint];
  if (exact) return exact;
  const prefix = Object.keys(NOTED_LIMITS).find(
    (key) => key.endsWith("/") && endpoint.startsWith(key),
  );
  return prefix ? NOTED_LIMITS[prefix]! : {};
}

/**
 * Switches sent to every workflow that has them. Prompt rewriting is off so
 * the model receives the exact product lock the director brain wrote, and
 * native audio is off because ad shots are cut to music in the montage.
 */
const HOUSE_SWITCHES: Record<string, unknown> = {
  enhance_prompt: false,
  prompt_extend: false,
  enable_thinking: false,
  prompt_optimizer: false,
  generate_audio: false,
};

function enumOf(property: Property | undefined): (string | number)[] | null {
  const values = property?.enum;
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.filter(
    (value): value is string | number => typeof value === "string" || typeof value === "number",
  );
}

function numberOf(property: Property | undefined, key: string): number | null {
  const value = property?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isArray(property: Property | undefined): boolean {
  return property?.type === "array";
}

/** Sort key for resolution tiers: 480p < 720p < 1k < 1080p < 2k < 4k. */
function resolutionRank(label: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([pk])$/i.exec(label.trim());
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  return match[2]!.toLowerCase() === "k" ? value * 1024 : value;
}

function options(values: (string | number)[]): ParamOption[] {
  return values.map((value) => ({ value, label: String(value) }));
}

function defaultLabel(property: Property | undefined, allowed: ParamOption[]): string | undefined {
  const value = property?.default;
  return allowed.find((option) => option.value === value)?.label;
}

function durationOptions(property: Property | undefined): number[] | null {
  const listed = enumOf(property)
    ?.map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (listed && listed.length > 0) return listed;
  const min = numberOf(property, "minimum");
  const max = numberOf(property, "maximum");
  if (min === null || max === null || max < min) return null;
  const values: number[] = [];
  for (let seconds = Math.max(1, Math.ceil(min)); seconds <= Math.floor(max); seconds += 1) {
    values.push(seconds);
  }
  return values.length > 0 ? values : null;
}

/** The fields the studio fills in; any other required field without a default rules a workflow out. */
function canFeed(workflow: Workflow, imageField: string | null): boolean {
  const supplied = new Set(["prompt", "duration", imageField]);
  return (workflow.schema.required ?? []).every(
    (field) => supplied.has(field) || workflow.schema.properties[field]?.default !== undefined,
  );
}

/** One workflow as a model spec, or null when the studio cannot use it. */
export function specFromWorkflow(
  family: Pick<Family, "slug" | "kind" | "title" | "description">,
  workflow: Workflow,
  fetchedAt: string,
): ModelSpecInput | null {
  const kind = family.kind;
  if (workflow.output !== (kind === "image" ? "images" : "video")) return null;
  const properties = workflow.schema.properties;
  const required = new Set(workflow.schema.required ?? []);
  if (!properties.prompt) return null;
  const limits = notedLimits(workflow.endpoint);

  const reference = IMAGE_FIELDS.find(({ field }) => properties[field]);
  if (!canFeed(workflow, reference?.field ?? null)) return null;

  const notes: string[] = [];
  let image: ImageParam | undefined;
  if (reference) {
    const property = properties[reference.field];
    const minItems = numberOf(property, "minItems") ?? 0;
    let max = 1;
    if (isArray(property)) {
      const schemaMax = numberOf(property, "maxItems");
      const stated = [schemaMax, limits.references ?? null].filter(
        (value): value is number => value !== null,
      );
      const documented = stated.length > 0 ? Math.min(...stated) : null;
      if (documented === null) {
        notes.push(`no documented maximum; the studio sends at most ${DEFAULT_REFERENCE_CAP}`);
      } else if (schemaMax !== null && documented < schemaMax) {
        notes.push(
          `at most ${documented} references, as the model's maker documents; the schema allows ${schemaMax}`,
        );
      }
      max = Math.min(documented ?? DEFAULT_REFERENCE_CAP, MAX_REFERENCES);
    }
    image = {
      field: reference.field,
      format: reference.format,
      max: Math.max(1, max),
      required: required.has(reference.field) || minItems > 0 || Boolean(limits.requiresReferences),
    };
  }

  const modes: GenerationMode[] =
    kind === "image"
      ? image
        ? image.required
          ? ["image-to-image"]
          : ["text-to-image", "image-to-image"]
        : ["text-to-image"]
      : image
        ? image.required
          ? ["image-to-video"]
          : ["text-to-video", "image-to-video"]
        : ["text-to-video"];

  const promptLimits = [
    numberOf(properties.prompt, "maxLength"),
    limits.promptChars ?? null,
  ].filter((value): value is number => value !== null);
  const params: ModelSpecInput["params"] = {
    prompt: {
      field: "prompt",
      ...(promptLimits.length > 0 ? { maxChars: Math.min(...promptLimits) } : {}),
    },
  };

  if (properties.negative_prompt) {
    const maxChars = numberOf(properties.negative_prompt, "maxLength");
    params.negativePrompt = { field: "negative_prompt", ...(maxChars ? { maxChars } : {}) };
  }
  if (image) params.image = image;

  const ratios = enumOf(properties.aspect_ratio);
  if (ratios && !limits.dropAspectRatio) {
    const allowed = options(ratios.map(String));
    params.aspectRatio = {
      field: "aspect_ratio",
      options: allowed,
      default: defaultLabel(properties.aspect_ratio, allowed),
    };
  }

  const tiers = enumOf(properties.resolution)
    ?.map(String)
    .filter((tier) => !limits.resolutions || limits.resolutions.includes(tier));
  if (tiers && tiers.length > 0) {
    const allowed = options([...tiers].sort((a, b) => resolutionRank(a) - resolutionRank(b)));
    params.resolution = {
      field: "resolution",
      options: allowed,
      default: defaultLabel(properties.resolution, allowed),
    };
  }

  const durations = durationOptions(properties.duration);
  if (durations) {
    const fallback = numberOf(properties.duration, "default");
    params.duration = {
      field: "duration",
      options: durations,
      ...(fallback !== null && durations.includes(fallback) ? { default: fallback } : {}),
    };
  }

  if (properties.seed) params.seed = { field: "seed" };

  const fixedParams: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(HOUSE_SWITCHES)) {
    if (properties[field]?.type === "boolean") fixedParams[field] = value;
  }
  // Kling's native audio switch is a string: "on" / "off".
  if (enumOf(properties.sound)?.includes("off")) fixedParams.sound = "off";
  // The studio only renders garments (lingerie and sleepwear on an invisible
  // display form, never a person), which a strict automatic content filter
  // tends to refuse: where a workflow offers the documented "low" level, use it.
  if (enumOf(properties.moderation)?.includes("low")) fixedParams.moderation = "low";

  return {
    id: slugForEndpoint(workflow.endpoint),
    label: `${family.title} · ${workflow.title}`.slice(0, 80),
    family: family.title,
    endpoint: workflow.endpoint,
    kind,
    modes,
    description: family.description.slice(0, 400) || undefined,
    fixedParams,
    params,
    source: "docs",
    sourceNote: [
      `docs.higgsfield.ai/docs/models/${family.slug}/${workflow.slug} (snapshot ${fetchedAt})`,
      ...notes,
    ].join("; "),
  };
}

function familyRank(slug: string): number {
  const index = FAMILY_ORDER.indexOf(slug);
  return index === -1 ? FAMILY_ORDER.length : index;
}

/** Every usable workflow in the snapshot, in picker order. */
export function specsFromDocs(input: unknown = snapshot): ModelSpecInput[] {
  const parsed = snapshotSchema.parse(input);
  const families = parsed.families
    .map((family, index) => ({ family, index }))
    .sort((a, b) => familyRank(a.family.slug) - familyRank(b.family.slug) || a.index - b.index);
  const specs: ModelSpecInput[] = [];
  for (const { family } of families) {
    const workflows = [...family.workflows].sort(
      (a, b) => Number(WORKFLOW_FIRST.has(b.endpoint)) - Number(WORKFLOW_FIRST.has(a.endpoint)),
    );
    for (const workflow of workflows) {
      const spec = specFromWorkflow(family, workflow, parsed.fetchedAt);
      if (spec) specs.push(spec);
    }
  }
  return specs;
}

/** Date of the docs snapshot the built-in models come from. */
export const DOCS_SNAPSHOT_DATE: string = snapshot.fetchedAt;
