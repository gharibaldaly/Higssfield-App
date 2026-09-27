import { z } from "zod";

import type { GenerationMode, ModelSpec, ParamOption } from "@/lib/providers/higgsfield/types";

/**
 * Optional remote model catalogue.
 *
 * The official SDK ships a `ModelSchemasResponse` type — `{ models: [{ endpoint,
 * name, description?, inputSchema: JSON Schema }] }` — but no client call that
 * fetches it, and the docs were unreachable when this was built. So the URL is
 * configurable (HIGGSFIELD_MODELS_URL) and this module converts each model's
 * JSON Schema into a ModelSpec using the parameter names the SDK uses.
 */

const jsonSchemaProperty: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

export const modelSchemasResponseSchema = z.object({
  models: z.array(
    z.object({
      endpoint: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      inputSchema: z.object({
        type: z.literal("object").optional(),
        properties: z.record(z.string(), jsonSchemaProperty),
        required: z.array(z.string()).optional(),
      }),
    }),
  ),
});

export type RemoteModelSchema = z.infer<typeof modelSchemasResponseSchema>["models"][number];

const PROMPT_FIELDS = ["prompt", "text", "description"];
const NEGATIVE_FIELDS = ["negative_prompt", "negative"];
const ASPECT_FIELDS = ["aspect_ratio", "aspect", "ratio", "width_and_height", "size"];
const RESOLUTION_FIELDS = ["resolution", "quality"];
const DURATION_FIELDS = ["duration", "duration_s", "seconds", "length"];
const SEED_FIELDS = ["seed"];

function firstField(properties: Record<string, unknown>, candidates: string[]): string | null {
  return candidates.find((candidate) => candidate in properties) ?? null;
}

function enumOptions(property: unknown): ParamOption[] | null {
  if (typeof property !== "object" || property === null) return null;
  const values = (property as { enum?: unknown }).enum;
  if (!Array.isArray(values) || values.length === 0) return null;
  return values
    .filter(
      (value): value is string | number => typeof value === "string" || typeof value === "number",
    )
    .map((value) => ({ value, label: String(value) }));
}

function detectImageField(
  properties: Record<string, Record<string, unknown>>,
  required: Set<string>,
): ModelSpec["params"]["image"] | undefined {
  const candidates: [string, NonNullable<ModelSpec["params"]["image"]>["format"]][] = [
    ["input_images", "input_images"],
    ["image_reference", "image_reference"],
    ["input_image", "image_reference"],
    ["image_urls", "url_array"],
    ["reference_images", "url_array"],
    ["image_url", "url"],
    ["image", "url"],
    ["start_image", "url"],
    ["first_frame", "url"],
  ];
  for (const [field, format] of candidates) {
    const property = properties[field];
    if (!property) continue;
    const maxItems = typeof property.maxItems === "number" ? property.maxItems : null;
    const isArray = property.type === "array";
    return {
      field,
      format,
      max: Math.max(1, Math.min(16, isArray ? (maxItems ?? 4) : 1)),
      required: required.has(field),
    };
  }
  return undefined;
}

export function slugForEndpoint(endpoint: string): string {
  return endpoint
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Convert a remote model schema into a ModelSpec; null when it cannot be used. */
export function specFromRemoteSchema(model: RemoteModelSchema): ModelSpec | null {
  const properties = model.inputSchema.properties as Record<string, Record<string, unknown>>;
  const required = new Set(model.inputSchema.required ?? []);
  const promptField = firstField(properties, PROMPT_FIELDS);
  if (!promptField) return null;

  const endpointLower = model.endpoint.toLowerCase();
  const kind: ModelSpec["kind"] =
    /video|2video|i2v|t2v|dop|speak/.test(endpointLower) || /video/i.test(model.name)
      ? "video"
      : "image";
  const image = detectImageField(properties, required);

  const modes: GenerationMode[] = [];
  if (kind === "image") {
    if (!image?.required) modes.push("text-to-image");
    if (image) modes.push("image-to-image");
  } else {
    if (!image?.required) modes.push("text-to-video");
    if (image) modes.push("image-to-video");
  }

  const params: ModelSpec["params"] = { prompt: { field: promptField } };
  const negativeField = firstField(properties, NEGATIVE_FIELDS);
  if (negativeField) params.negativePrompt = { field: negativeField };
  if (image) params.image = image;

  const aspectField = firstField(properties, ASPECT_FIELDS);
  const aspectOptions = aspectField ? enumOptions(properties[aspectField]) : null;
  if (aspectField && aspectOptions) {
    params.aspectRatio = { field: aspectField, options: aspectOptions, verified: true };
  }
  const resolutionField = firstField(properties, RESOLUTION_FIELDS);
  const resolutionOptions = resolutionField ? enumOptions(properties[resolutionField]) : null;
  if (resolutionField && resolutionOptions) {
    params.resolution = { field: resolutionField, options: resolutionOptions, verified: true };
  }
  const durationField = firstField(properties, DURATION_FIELDS);
  if (durationField) {
    const options = enumOptions(properties[durationField])
      ?.map((option) => Number(option.value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (options && options.length > 0) {
      params.duration = { field: durationField, options, verified: true };
    }
  }
  const seedField = firstField(properties, SEED_FIELDS);
  if (seedField) params.seed = { field: seedField };

  const id = slugForEndpoint(model.endpoint);
  if (id.length < 2 || modes.length === 0) return null;
  return {
    id,
    label: model.name.slice(0, 80),
    endpoint: model.endpoint,
    kind,
    modes,
    description: model.description?.slice(0, 400),
    fixedParams: {},
    params,
    source: "catalog",
    sourceNote: "Converted from the remote model catalogue",
  };
}

export function specsFromCatalog(payload: unknown): ModelSpec[] {
  const parsed = modelSchemasResponseSchema.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.models
    .map((model) => specFromRemoteSchema(model))
    .filter((spec): spec is ModelSpec => spec !== null);
}
