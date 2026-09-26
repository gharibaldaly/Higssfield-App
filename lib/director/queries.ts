import "server-only";

import type { StoredAdPlan } from "@/lib/domain/ad-plan";
import type { DirectorControls, ShotOverrides, VideoSettings } from "@/lib/domain/director";
import type { GenerationView } from "@/lib/domain/generation";
import { getProject, listPresets, listShots, parseShotOverrides } from "@/lib/director/service";
import { ownerRegistry } from "@/lib/generations/models";
import { toViews } from "@/lib/generations/queries";
import { toModelOptions, type ModelOption } from "@/lib/providers/higgsfield/options";
import { getOwnerSettings } from "@/lib/settings/service";
import { listCrops } from "@/lib/sheet/service";
import { signPaths } from "@/lib/storage/objects";
import type { ShotRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export type CropOption = { id: string; kind: string; label: string; url: string | null };

export type ShotView = {
  id: string;
  position: number;
  purpose: string;
  detailShown: string;
  framing: string;
  angle: string;
  movement: string;
  placement: string | null;
  durationS: number;
  referenceCropIds: string[];
  prompt: string;
  overrides: ShotOverrides;
  previewFrameFirst: boolean;
  previewApproved: boolean;
  status: ShotRow["status"];
  preview: GenerationView | null;
  video: GenerationView | null;
};

export type DirectorBoardData = {
  project: {
    id: string;
    name: string;
    brief: string;
    status: string;
    presetId: string | null;
    controls: DirectorControls;
    videoSettings: VideoSettings;
    rules: string[];
    plan: StoredAdPlan | null;
  };
  product: { id: string; name: string };
  crops: CropOption[];
  shots: ShotView[];
  presets: { id: string; name: string; isBuiltin: boolean }[];
  videoModels: ModelOption[];
  defaultVideoModelId: string | null;
};

export async function loadDirectorBoard(
  supabase: TypedSupabaseClient,
  ownerId: string,
  projectId: string,
): Promise<DirectorBoardData | null> {
  let project;
  try {
    project = await getProject(supabase, projectId);
  } catch {
    return null;
  }
  const [product, shots, presets, settings, crops] = await Promise.all([
    supabase.from("products").select("id, name").eq("id", project.product_id).maybeSingle(),
    listShots(supabase, projectId),
    listPresets(supabase),
    getOwnerSettings(supabase, ownerId),
    project.sheet_id ? listCrops(supabase, project.sheet_id) : Promise.resolve([]),
  ]);
  const generationIds = shots
    .flatMap((shot) => [shot.preview_generation_id, shot.video_generation_id])
    .filter((id): id is string => Boolean(id));
  const { data: generations } = generationIds.length
    ? await supabase.from("generations").select("*").in("id", generationIds)
    : { data: [] };
  const views = new Map(
    (await toViews(supabase, generations ?? [])).map((view) => [view.id, view]),
  );
  const signed = await signPaths(
    supabase,
    crops.map((crop) => crop.storage_path),
  );
  const registry = await ownerRegistry(settings);
  const videoModels = toModelOptions(registry, "video", ["image-to-video"]);
  const defaultVideo =
    videoModels.find((model) => model.id === settings.defaultVideoModel && !model.disabledReason) ??
    videoModels.find((model) => !model.disabledReason);

  return {
    project: {
      id: project.id,
      name: project.name,
      brief: project.brief,
      status: project.status,
      presetId: project.preset_id,
      controls: project.controlsParsed,
      videoSettings: project.videoParsed,
      rules: project.rulesParsed,
      plan: project.planParsed,
    },
    product: { id: product.data?.id ?? project.product_id, name: product.data?.name ?? "" },
    crops: crops.map((crop) => ({
      id: crop.id,
      kind: crop.kind,
      label: crop.label,
      url: signed.get(crop.storage_path) ?? null,
    })),
    shots: shots.map((shot) => ({
      id: shot.id,
      position: shot.position,
      purpose: shot.purpose,
      detailShown: shot.detail_shown,
      framing: shot.framing,
      angle: shot.angle,
      movement: shot.movement,
      placement: shot.placement,
      durationS: Number(shot.duration_s),
      referenceCropIds: shot.reference_crop_ids,
      prompt: shot.prompt,
      overrides: parseShotOverrides(shot.overrides),
      previewFrameFirst: shot.preview_frame_first,
      previewApproved: shot.preview_approved,
      status: shot.status,
      preview: shot.preview_generation_id ? (views.get(shot.preview_generation_id) ?? null) : null,
      video: shot.video_generation_id ? (views.get(shot.video_generation_id) ?? null) : null,
    })),
    presets: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      isBuiltin: preset.is_builtin,
    })),
    videoModels,
    defaultVideoModelId: defaultVideo?.id ?? null,
  };
}
