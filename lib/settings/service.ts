import "server-only";

import { z } from "zod";

import {
  DEFAULT_CATALOGUE_STYLE,
  parseCatalogueStyle,
  type CatalogueStyle,
} from "@/lib/domain/catalogue-style";
import { BUILTIN_PRESETS } from "@/lib/director/presets";
import { AppError } from "@/lib/errors";
import type { Json, SettingsRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export const driveSettingsSchema = z.object({
  folderId: z.string().max(200).nullable(),
  folderName: z.string().max(200).nullable(),
  autoMirror: z.boolean(),
});

export type DriveSettings = z.infer<typeof driveSettingsSchema>;

export type OwnerSettings = {
  llmProvider: SettingsRow["llm_provider"];
  claudeModel: string | null;
  geminiModel: string | null;
  catalogueStyle: CatalogueStyle;
  defaultImageModel: string | null;
  defaultVideoModel: string | null;
  customModels: unknown[];
  drive: DriveSettings;
};

const DEFAULT_DRIVE: DriveSettings = { folderId: null, folderName: null, autoMirror: false };

export function settingsFromRow(row: SettingsRow | null): OwnerSettings {
  const drive = driveSettingsSchema.safeParse(row?.drive);
  return {
    llmProvider: row?.llm_provider ?? "claude",
    claudeModel: row?.claude_model ?? null,
    geminiModel: row?.gemini_model ?? null,
    catalogueStyle: row ? parseCatalogueStyle(row.catalogue_style) : DEFAULT_CATALOGUE_STYLE,
    defaultImageModel: row?.default_image_model ?? null,
    defaultVideoModel: row?.default_video_model ?? null,
    customModels: Array.isArray(row?.custom_models) ? (row.custom_models as unknown[]) : [],
    drive: drive.success ? drive.data : DEFAULT_DRIVE,
  };
}

/**
 * Seeds the owner's defaults on first sign-in: the settings row with the
 * default catalogue style, and the built-in "Dr. Secret Cinematic" preset.
 * Idempotent (ON CONFLICT DO NOTHING), so it is safe on every visit.
 */
export async function ensureOwnerDefaults(
  supabase: TypedSupabaseClient,
  ownerId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("settings")
    .select("owner_id")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (existing) return;

  const { error: settingsError } = await supabase.from("settings").upsert(
    {
      owner_id: ownerId,
      llm_provider: "claude",
      catalogue_style: DEFAULT_CATALOGUE_STYLE as unknown as Json,
      drive: DEFAULT_DRIVE as unknown as Json,
    },
    { onConflict: "owner_id", ignoreDuplicates: true },
  );
  if (settingsError) console.error("Seeding settings failed", settingsError.message);

  const { error: presetError } = await supabase.from("director_presets").upsert(
    BUILTIN_PRESETS.map((preset) => ({
      owner_id: ownerId,
      name: preset.name,
      slug: preset.slug,
      description: preset.description,
      is_builtin: true,
      controls: preset.controls as unknown as Json,
      video_settings: preset.videoSettings as unknown as Json,
      rules: preset.rules as unknown as Json,
    })),
    { onConflict: "owner_id,slug", ignoreDuplicates: true },
  );
  if (presetError) console.error("Seeding director presets failed", presetError.message);
}

export async function getOwnerSettings(
  supabase: TypedSupabaseClient,
  ownerId: string,
): Promise<OwnerSettings> {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new AppError("unknown", "Could not load settings.", { detail: error.message });
  return settingsFromRow(data);
}

export async function updateOwnerSettings(
  supabase: TypedSupabaseClient,
  ownerId: string,
  patch: Partial<OwnerSettings>,
): Promise<void> {
  await ensureOwnerDefaults(supabase, ownerId);
  const update: Partial<SettingsRow> = {};
  if (patch.llmProvider) update.llm_provider = patch.llmProvider;
  if (patch.claudeModel !== undefined) update.claude_model = patch.claudeModel;
  if (patch.geminiModel !== undefined) update.gemini_model = patch.geminiModel;
  if (patch.catalogueStyle) update.catalogue_style = patch.catalogueStyle as unknown as Json;
  if (patch.defaultImageModel !== undefined) update.default_image_model = patch.defaultImageModel;
  if (patch.defaultVideoModel !== undefined) update.default_video_model = patch.defaultVideoModel;
  if (patch.customModels) update.custom_models = patch.customModels as Json;
  if (patch.drive) update.drive = patch.drive as unknown as Json;
  const { error } = await supabase.from("settings").update(update).eq("owner_id", ownerId);
  if (error) throw new AppError("unknown", "Could not save settings.", { detail: error.message });
}
