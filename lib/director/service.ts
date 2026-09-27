import "server-only";

import { z } from "zod";

import { sanitizeAdPlan, type StoredAdPlan } from "@/lib/domain/ad-plan";
import {
  describeControls,
  directorControlsSchema,
  presetRulesSchema,
  shotOverridesSchema,
  videoSettingsSchema,
  type DirectorControls,
  type ShotOverrides,
  type VideoSettings,
} from "@/lib/domain/director";
import { DR_SECRET_CINEMATIC, BUILTIN_PRESETS } from "@/lib/director/presets";
import { requireApprovedDna } from "@/lib/dna/service";
import { AppError, toUserMessage } from "@/lib/errors";
import { ownerRegistry, promptBudget, resolveModel } from "@/lib/generations/models";
import { getGeneration, recordFailedGeneration } from "@/lib/generations/queries";
import { submitGeneration } from "@/lib/generations/service";
import { activeProviderMode } from "@/lib/providers/higgsfield";
import { capabilitiesOf, highestResolution } from "@/lib/providers/higgsfield/registry";
import type { ModelSpec } from "@/lib/providers/higgsfield/types";
import { getDirectorBrain } from "@/lib/providers/llm";
import { getPieces, getProduct } from "@/lib/products/service";
import { listCrops } from "@/lib/sheet/service";
import { getOwnerSettings, type OwnerSettings } from "@/lib/settings/service";
import type {
  AdProjectRow,
  DirectorPresetRow,
  GenerationRow,
  Json,
  ShotRow,
} from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

export type ParsedProject = AdProjectRow & {
  controlsParsed: DirectorControls;
  videoParsed: VideoSettings;
  rulesParsed: string[];
  planParsed: StoredAdPlan | null;
};

export function parseProject(row: AdProjectRow): ParsedProject {
  const controls = directorControlsSchema.safeParse(row.controls);
  const video = videoSettingsSchema.safeParse(row.video_settings);
  const rules = presetRulesSchema.safeParse(row.rules);
  return {
    ...row,
    controlsParsed: controls.success ? controls.data : DR_SECRET_CINEMATIC.controls,
    videoParsed: video.success ? video.data : DR_SECRET_CINEMATIC.videoSettings,
    rulesParsed: rules.success ? rules.data : DR_SECRET_CINEMATIC.rules,
    planParsed: (row.plan as StoredAdPlan | null) ?? null,
  };
}

export function parseShotOverrides(value: Json): ShotOverrides {
  const parsed = shotOverridesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export async function listPresets(supabase: TypedSupabaseClient): Promise<DirectorPresetRow[]> {
  const { data, error } = await supabase
    .from("director_presets")
    .select("*")
    .order("is_builtin", { ascending: false })
    .order("created_at");
  if (error) throw new AppError("unknown", "Could not load presets.", { detail: error.message });
  return data ?? [];
}

export async function getProject(
  supabase: TypedSupabaseClient,
  projectId: string,
): Promise<ParsedProject> {
  const { data, error } = await supabase
    .from("ad_projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new AppError("unknown", "Could not load the ad.", { detail: error.message });
  if (!data) throw new AppError("not_found", "Ad not found.");
  return parseProject(data);
}

export async function listShots(
  supabase: TypedSupabaseClient,
  projectId: string,
): Promise<ShotRow[]> {
  const { data, error } = await supabase
    .from("shots")
    .select("*")
    .eq("ad_project_id", projectId)
    .order("position");
  if (error) throw new AppError("unknown", "Could not load shots.", { detail: error.message });
  return data ?? [];
}

export const createProjectSchema = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  presetId: z.uuid().nullable(),
  brief: z.string().max(4000).optional(),
});

export async function createAdProject(
  supabase: TypedSupabaseClient,
  input: z.infer<typeof createProjectSchema>,
): Promise<AdProjectRow> {
  const product = await getProduct(supabase, input.productId);
  if (!product.approved_sheet_id) {
    throw new AppError(
      "validation",
      "Approve a product sheet first — the ad is built from its reference crops.",
    );
  }
  let preset: DirectorPresetRow | null = null;
  if (input.presetId) {
    const { data } = await supabase
      .from("director_presets")
      .select("*")
      .eq("id", input.presetId)
      .maybeSingle();
    preset = data;
  }
  const { data, error } = await supabase
    .from("ad_projects")
    .insert({
      product_id: input.productId,
      sheet_id: product.approved_sheet_id,
      preset_id: preset?.id ?? null,
      name: input.name,
      brief: input.brief ?? "",
      controls: (preset?.controls ?? DR_SECRET_CINEMATIC.controls) as Json,
      video_settings: (preset?.video_settings ?? DR_SECRET_CINEMATIC.videoSettings) as Json,
      rules: (preset?.rules ?? DR_SECRET_CINEMATIC.rules) as Json,
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not create the ad.", { detail: error?.message });
  return data;
}

export const updateProjectSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(160).optional(),
  brief: z.string().max(4000).optional(),
  controls: directorControlsSchema.optional(),
  videoSettings: videoSettingsSchema.optional(),
  rules: presetRulesSchema.optional(),
});

export async function updateAdProject(
  supabase: TypedSupabaseClient,
  input: z.infer<typeof updateProjectSchema>,
): Promise<void> {
  const update: Partial<AdProjectRow> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.brief !== undefined) update.brief = input.brief;
  if (input.controls) update.controls = input.controls as unknown as Json;
  if (input.videoSettings) update.video_settings = input.videoSettings as unknown as Json;
  if (input.rules) update.rules = input.rules as unknown as Json;
  const { error } = await supabase.from("ad_projects").update(update).eq("id", input.projectId);
  if (error) throw new AppError("unknown", "Could not save the ad.", { detail: error.message });
}

export async function applyPreset(
  supabase: TypedSupabaseClient,
  projectId: string,
  presetId: string,
): Promise<void> {
  const { data: preset } = await supabase
    .from("director_presets")
    .select("*")
    .eq("id", presetId)
    .maybeSingle();
  if (!preset) throw new AppError("not_found", "Preset not found.");
  const { error } = await supabase
    .from("ad_projects")
    .update({
      preset_id: preset.id,
      controls: preset.controls,
      video_settings: preset.video_settings,
      rules: preset.rules,
    })
    .eq("id", projectId);
  if (error)
    throw new AppError("unknown", "Could not apply the preset.", { detail: error.message });
}

export const savePresetSchema = z.object({
  presetId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  controls: directorControlsSchema,
  videoSettings: videoSettingsSchema,
  rules: presetRulesSchema,
});

/** Save as a new preset (presetId null) or overwrite an existing one. */
export async function savePreset(
  supabase: TypedSupabaseClient,
  input: z.infer<typeof savePresetSchema>,
): Promise<DirectorPresetRow> {
  const values = {
    name: input.name,
    description: input.description ?? null,
    controls: input.controls as unknown as Json,
    video_settings: input.videoSettings as unknown as Json,
    rules: input.rules as unknown as Json,
  };
  if (input.presetId) {
    const { data, error } = await supabase
      .from("director_presets")
      .update(values)
      .eq("id", input.presetId)
      .select("*")
      .single();
    if (error || !data)
      throw new AppError("unknown", "Could not save the preset.", { detail: error?.message });
    return data;
  }
  const existing = await listPresets(supabase);
  let slug = slugify(input.name);
  if (existing.some((preset) => preset.slug === slug)) slug = `${slug}-${existing.length + 1}`;
  const { data, error } = await supabase
    .from("director_presets")
    .insert({ ...values, slug })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not save the preset.", { detail: error?.message });
  return data;
}

/** Restore a built-in preset (e.g. "Dr. Secret Cinematic") to its shipped values. */
export async function resetBuiltinPreset(
  supabase: TypedSupabaseClient,
  presetId: string,
): Promise<void> {
  const { data: preset } = await supabase
    .from("director_presets")
    .select("*")
    .eq("id", presetId)
    .maybeSingle();
  const builtin = BUILTIN_PRESETS.find((candidate) => candidate.slug === preset?.slug);
  if (!preset || !builtin) throw new AppError("validation", "Only built-in presets can be reset.");
  const { error } = await supabase
    .from("director_presets")
    .update({
      name: builtin.name,
      description: builtin.description,
      controls: builtin.controls as unknown as Json,
      video_settings: builtin.videoSettings as unknown as Json,
      rules: builtin.rules as unknown as Json,
    })
    .eq("id", presetId);
  if (error)
    throw new AppError("unknown", "Could not reset the preset.", { detail: error.message });
}

export async function deletePreset(supabase: TypedSupabaseClient, presetId: string): Promise<void> {
  const { data: preset } = await supabase
    .from("director_presets")
    .select("is_builtin")
    .eq("id", presetId)
    .maybeSingle();
  if (preset?.is_builtin)
    throw new AppError("validation", "Built-in presets can be edited or reset, not deleted.");
  const { error } = await supabase.from("director_presets").delete().eq("id", presetId);
  if (error)
    throw new AppError("unknown", "Could not delete the preset.", { detail: error.message });
}

function resolveVideoModel(
  registry: ModelSpec[],
  settings: OwnerSettings,
  requestedId: string | null | undefined,
) {
  return resolveModel(registry, {
    kind: "video",
    preferredModes: ["image-to-video"],
    requestedId,
    defaultId: settings.defaultVideoModel,
  });
}

/** Ask the director brain for a shot list and replace the project's shots. */
export async function planShots(
  supabase: TypedSupabaseClient,
  ownerId: string,
  projectId: string,
): Promise<ShotRow[]> {
  const project = await getProject(supabase, projectId);
  if (!project.sheet_id) throw new AppError("validation", "This ad has no approved product sheet.");
  const [product, pieces, settings, approved, crops, existingShots] = await Promise.all([
    getProduct(supabase, project.product_id),
    getPieces(supabase, project.product_id),
    getOwnerSettings(supabase, ownerId),
    requireApprovedDna(supabase, project.product_id),
    listCrops(supabase, project.sheet_id),
    listShots(supabase, projectId),
  ]);
  if (crops.length === 0)
    throw new AppError("validation", "The approved sheet has no reference crops yet.");
  if (
    existingShots.some(
      (shot) => shot.status === "generating" || shot.status === "preview_generating",
    )
  ) {
    throw new AppError("conflict", "Wait for the running shots to finish before re-planning.");
  }
  const registry = await ownerRegistry(settings);
  const { model } = resolveVideoModel(registry, settings, project.videoParsed.modelId);
  const capabilities = capabilitiesOf(model);

  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  const plan = await brain.planAd({
    brief: project.brief,
    product: {
      name: product.name,
      productLine: product.product_line,
      notes: product.notes,
      pieces: pieces.map((piece) => ({ position: piece.position, name: piece.name })),
    },
    dna: approved.dna,
    controlsDescription: describeControls(project.controlsParsed),
    rules: project.rulesParsed,
    crops: crops.map((crop) => ({ id: crop.id, kind: crop.kind, label: crop.label })),
    video: {
      totalDurationS: project.videoParsed.totalDurationS,
      maxShotDurationS: project.videoParsed.maxShotDurationS,
      aspectRatio: project.videoParsed.aspectRatio,
      modelLabel: model.label,
      durationOptions: capabilities.durations.length > 0 ? capabilities.durations : null,
    },
    targetShotCount: project.controlsParsed.shotCount,
    humanModel: project.controlsParsed.humanModel,
  });
  const hero = crops.find((crop) => crop.kind === "front") ?? crops[0]!;
  const { plan: sanitized } = sanitizeAdPlan(plan, {
    maxShotDurationS: project.videoParsed.maxShotDurationS,
    knownCropIds: crops.map((crop) => crop.id),
    fallbackCropId: hero.id,
  });

  await supabase.from("shots").delete().eq("ad_project_id", projectId);
  const { data: shots, error } = await supabase
    .from("shots")
    .insert(
      sanitized.shots.map((shot, index) => ({
        ad_project_id: projectId,
        position: index,
        purpose: shot.purpose,
        detail_shown: shot.detailShown,
        framing: shot.framing,
        angle: shot.angle,
        movement: shot.movement,
        placement: shot.placement || null,
        duration_s: shot.durationS,
        reference_crop_ids: shot.referenceCropIds,
        prompt: shot.prompt,
      })),
    )
    .select("*");
  if (error)
    throw new AppError("unknown", "Could not save the shot list.", { detail: error.message });

  const stored: StoredAdPlan = {
    concept: sanitized.concept,
    hook: sanitized.hook,
    environmentBible: sanitized.environmentBible,
    musicCue: sanitized.musicCue,
    promptVersion: "plan-ad@1.0.0",
    provider: brain.provider,
    model: brain.model,
    plannedAt: new Date().toISOString(),
  };
  await supabase
    .from("ad_projects")
    .update({ plan: stored as unknown as Json, status: "planned" })
    .eq("id", projectId);
  return (shots ?? []).sort((a, b) => a.position - b.position);
}

export const updateShotSchema = z.object({
  shotId: z.uuid(),
  purpose: z.string().trim().min(1).max(300).optional(),
  detailShown: z.string().trim().min(1).max(300).optional(),
  framing: z.string().trim().min(1).max(200).optional(),
  angle: z.string().trim().min(1).max(200).optional(),
  movement: z.string().trim().min(1).max(200).optional(),
  placement: z.string().trim().max(200).nullable().optional(),
  durationS: z.number().min(0.5).max(30).optional(),
  referenceCropIds: z.array(z.uuid()).min(1).max(8).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  overrides: shotOverridesSchema.optional(),
  previewFrameFirst: z.boolean().optional(),
});

export async function updateShot(
  supabase: TypedSupabaseClient,
  input: z.infer<typeof updateShotSchema>,
): Promise<void> {
  const update: Partial<ShotRow> = {};
  if (input.purpose !== undefined) update.purpose = input.purpose;
  if (input.detailShown !== undefined) update.detail_shown = input.detailShown;
  if (input.framing !== undefined) update.framing = input.framing;
  if (input.angle !== undefined) update.angle = input.angle;
  if (input.movement !== undefined) update.movement = input.movement;
  if (input.placement !== undefined) update.placement = input.placement;
  if (input.durationS !== undefined) update.duration_s = input.durationS;
  if (input.referenceCropIds !== undefined) update.reference_crop_ids = input.referenceCropIds;
  if (input.prompt !== undefined) update.prompt = input.prompt;
  if (input.overrides !== undefined) update.overrides = input.overrides as Json;
  if (input.previewFrameFirst !== undefined) {
    update.preview_frame_first = input.previewFrameFirst;
    if (!input.previewFrameFirst) update.preview_approved = false;
  }
  const { error } = await supabase.from("shots").update(update).eq("id", input.shotId);
  if (error) throw new AppError("unknown", "Could not save the shot.", { detail: error.message });
}

export async function addShot(supabase: TypedSupabaseClient, projectId: string): Promise<ShotRow> {
  const [project, shots] = await Promise.all([
    getProject(supabase, projectId),
    listShots(supabase, projectId),
  ]);
  const crops = project.sheet_id ? await listCrops(supabase, project.sheet_id) : [];
  const hero = crops.find((crop) => crop.kind === "front") ?? crops[0];
  if (!hero) throw new AppError("validation", "The approved sheet has no reference crops yet.");
  const { data, error } = await supabase
    .from("shots")
    .insert({
      ad_project_id: projectId,
      position: shots.length,
      purpose: "detail",
      detail_shown: hero.label,
      framing: "close-up",
      angle: "eye level",
      movement: "slow push-in",
      duration_s: Math.min(3, project.videoParsed.maxShotDurationS),
      reference_crop_ids: [hero.id],
      prompt: "Describe the scene, the light and the camera move.",
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not add a shot.", { detail: error?.message });
  return data;
}

export async function deleteShot(supabase: TypedSupabaseClient, shotId: string): Promise<void> {
  const { error } = await supabase.from("shots").delete().eq("id", shotId);
  if (error) throw new AppError("unknown", "Could not delete the shot.", { detail: error.message });
}

export async function reorderShots(
  supabase: TypedSupabaseClient,
  projectId: string,
  orderedIds: string[],
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from("shots")
      .update({ position: index })
      .eq("id", id)
      .eq("ad_project_id", projectId);
    if (error)
      throw new AppError("unknown", "Could not reorder the shots.", { detail: error.message });
  }
}

/**
 * Generate one shot without touching the others. With "preview frame first"
 * on and no approved frame yet, a still frame is generated for approval;
 * otherwise the video is generated from the approved frame or, by default,
 * straight from the shot's isolated reference crops (image-to-video).
 */
export async function generateShot(
  supabase: TypedSupabaseClient,
  ownerId: string,
  shotId: string,
  options: { note?: string | null; target?: "auto" | "preview" | "video" } = {},
): Promise<GenerationRow> {
  const { data: shot } = await supabase.from("shots").select("*").eq("id", shotId).maybeSingle();
  if (!shot) throw new AppError("not_found", "Shot not found.");
  const project = await getProject(supabase, shot.ad_project_id);
  if (!project.sheet_id) throw new AppError("validation", "This ad has no approved product sheet.");
  const [settings, approved, crops] = await Promise.all([
    getOwnerSettings(supabase, ownerId),
    requireApprovedDna(supabase, project.product_id),
    listCrops(supabase, project.sheet_id),
  ]);
  const registry = await ownerRegistry(settings);
  const overrides = parseShotOverrides(shot.overrides);
  const aspectRatio = overrides.aspectRatio || project.videoParsed.aspectRatio;
  const shotCrops = crops.filter((crop) => shot.reference_crop_ids.includes(crop.id));
  if (shotCrops.length === 0)
    throw new AppError("validation", "Pick at least one reference crop for this shot.");

  const target =
    options.target && options.target !== "auto"
      ? options.target
      : shot.preview_frame_first && !shot.preview_approved
        ? "preview"
        : "video";
  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  const shotInput = {
    purpose: shot.purpose,
    detailShown: shot.detail_shown,
    framing: shot.framing,
    angle: shot.angle,
    movement: shot.movement,
    placement: shot.placement,
    durationS: overrides.durationS ?? Number(shot.duration_s),
    prompt: shot.prompt,
  };
  const common = {
    environmentBible: project.planParsed?.environmentBible ?? "",
    controlsDescription: describeControls(project.controlsParsed),
    rules: project.rulesParsed,
    dna: approved.dna,
    aspectRatio,
    note: options.note ?? null,
  };

  if (target === "preview") {
    const { model, mode } = resolveModel(registry, {
      kind: "image",
      preferredModes: ["image-to-image"],
      defaultId: settings.defaultImageModel,
    });
    const references = shotCrops.slice(0, capabilitiesOf(model).maxReferenceImages);
    let generation: GenerationRow;
    try {
      const built = await brain.buildShotPrompt({
        ...common,
        target: "frame",
        shot: shotInput,
        referenceLabels: references.map((crop) => crop.label),
        promptBudget: promptBudget(model),
      });
      generation = await submitGeneration(supabase, {
        purpose: "shot_preview",
        model,
        mode,
        prompt: built.prompt,
        negativePrompt: built.negativePrompt,
        referencePaths: references.map((crop) => crop.storage_path),
        aspectRatio,
        resolution: highestResolution(model),
        links: {
          productId: project.product_id,
          adProjectId: project.id,
          shotId: shot.id,
          parentId: shot.preview_generation_id,
        },
        note: options.note ?? null,
      });
    } catch (error) {
      generation = await recordFailedGeneration(
        supabase,
        {
          provider: activeProviderMode(),
          model_id: model.id,
          endpoint: model.endpoint,
          kind: "image",
          purpose: "shot_preview",
          prompt: "",
          product_id: project.product_id,
          ad_project_id: project.id,
          shot_id: shot.id,
        },
        toUserMessage(error),
      );
    }
    await supabase
      .from("shots")
      .update({
        preview_generation_id: generation.id,
        preview_approved: false,
        status: generation.status === "failed" ? "failed" : "preview_generating",
      })
      .eq("id", shot.id);
    return generation;
  }

  const { model, mode } = resolveVideoModel(
    registry,
    settings,
    overrides.modelId || project.videoParsed.modelId,
  );
  let referencePaths: string[];
  let referenceLabels: string[];
  if (shot.preview_frame_first) {
    if (!shot.preview_generation_id || !shot.preview_approved) {
      throw new AppError(
        "validation",
        "Approve the preview frame first (or turn the preview toggle off).",
      );
    }
    const preview = await getGeneration(supabase, shot.preview_generation_id);
    if (!preview.storage_path) throw new AppError("validation", "The preview frame is not ready.");
    referencePaths = [preview.storage_path];
    referenceLabels = ["Approved first frame of this shot"];
  } else {
    const references = shotCrops.slice(0, Math.max(1, capabilitiesOf(model).maxReferenceImages));
    referencePaths = references.map((crop) => crop.storage_path);
    referenceLabels = references.map((crop) => crop.label);
  }

  let generation: GenerationRow;
  try {
    const built = await brain.buildShotPrompt({
      ...common,
      target: "video",
      shot: shotInput,
      referenceLabels,
      promptBudget: promptBudget(model),
    });
    generation = await submitGeneration(supabase, {
      purpose: "shot_video",
      model,
      mode,
      prompt: built.prompt,
      negativePrompt: built.negativePrompt,
      referencePaths,
      aspectRatio,
      resolution:
        overrides.resolution || project.videoParsed.resolution || highestResolution(model),
      durationS: overrides.durationS ?? Number(shot.duration_s),
      links: {
        productId: project.product_id,
        adProjectId: project.id,
        shotId: shot.id,
        parentId: shot.video_generation_id,
      },
      note: options.note ?? null,
    });
  } catch (error) {
    generation = await recordFailedGeneration(
      supabase,
      {
        provider: activeProviderMode(),
        model_id: model.id,
        endpoint: model.endpoint,
        kind: "video",
        purpose: "shot_video",
        prompt: "",
        product_id: project.product_id,
        ad_project_id: project.id,
        shot_id: shot.id,
      },
      toUserMessage(error),
    );
  }
  await supabase
    .from("shots")
    .update({
      video_generation_id: generation.id,
      status: generation.status === "failed" ? "failed" : "generating",
    })
    .eq("id", shot.id);
  await supabase
    .from("ad_projects")
    .update({ status: "generating" })
    .eq("id", project.id)
    .neq("status", "done");
  return generation;
}

export async function approvePreview(supabase: TypedSupabaseClient, shotId: string): Promise<void> {
  const { data: shot } = await supabase
    .from("shots")
    .select("preview_generation_id")
    .eq("id", shotId)
    .maybeSingle();
  if (!shot?.preview_generation_id)
    throw new AppError("validation", "There is no preview frame to approve.");
  const preview = await getGeneration(supabase, shot.preview_generation_id);
  if (preview.status !== "completed")
    throw new AppError("validation", "Wait for the preview frame to finish.");
  await supabase
    .from("generations")
    .update({ review_status: "approved", approved_at: new Date().toISOString() })
    .eq("id", preview.id);
  await supabase
    .from("shots")
    .update({ preview_approved: true, status: "preview_ready" })
    .eq("id", shotId);
}

export async function approveShot(supabase: TypedSupabaseClient, shotId: string): Promise<void> {
  const { data: shot } = await supabase
    .from("shots")
    .select("video_generation_id")
    .eq("id", shotId)
    .maybeSingle();
  if (!shot?.video_generation_id) throw new AppError("validation", "There is no video to approve.");
  const video = await getGeneration(supabase, shot.video_generation_id);
  if (video.status !== "completed")
    throw new AppError("validation", "Wait for the video to finish.");
  await supabase
    .from("generations")
    .update({ review_status: "approved", approved_at: new Date().toISOString() })
    .eq("id", video.id);
  await supabase.from("shots").update({ status: "approved" }).eq("id", shotId);
}
