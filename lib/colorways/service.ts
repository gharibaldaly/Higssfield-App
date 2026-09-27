import "server-only";

import { z } from "zod";

import { hexColor } from "@/lib/domain/garment-dna";
import { AppError } from "@/lib/errors";
import { removeObjects } from "@/lib/storage/objects";
import { isOwnedPath } from "@/lib/storage/paths";
import type { ColorwayRow, Json } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export const colorwayInputSchema = z
  .object({
    productId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    hex: hexColor,
    source: z.enum(["swatch", "eyedropper", "manual"]),
    swatchPath: z.string().max(500).nullable().optional(),
    sampleImagePath: z.string().max(500).nullable().optional(),
    samplePoint: z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .nullable()
      .optional(),
  })
  .refine((value) => value.source !== "swatch" || Boolean(value.swatchPath), {
    message: "Upload a fabric swatch photo.",
    path: ["swatchPath"],
  })
  .refine(
    (value) => value.source !== "eyedropper" || (value.sampleImagePath && value.samplePoint),
    {
      message: "Pick a colour on a photo.",
      path: ["samplePoint"],
    },
  );

export type ColorwayInput = z.infer<typeof colorwayInputSchema>;

export async function listColorways(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<ColorwayRow[]> {
  const { data, error } = await supabase
    .from("colorways")
    .select("*")
    .eq("product_id", productId)
    .order("position")
    .order("created_at");
  if (error) throw new AppError("unknown", "Could not load colourways.", { detail: error.message });
  return data ?? [];
}

export async function addColorway(
  supabase: TypedSupabaseClient,
  ownerId: string,
  input: ColorwayInput,
): Promise<ColorwayRow> {
  for (const path of [input.swatchPath, input.sampleImagePath]) {
    if (path && !isOwnedPath(path, ownerId))
      throw new AppError("validation", "Invalid image path.");
  }
  const existing = await listColorways(supabase, input.productId);
  const { data, error } = await supabase
    .from("colorways")
    .insert({
      product_id: input.productId,
      name: input.name,
      hex: input.hex.toUpperCase(),
      source: input.source,
      swatch_path: input.swatchPath ?? null,
      sample_image_path: input.sampleImagePath ?? null,
      sample_point: (input.samplePoint ?? null) as Json,
      position: existing.length,
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not add the colourway.", { detail: error?.message });
  return data;
}

export async function renameColorway(
  supabase: TypedSupabaseClient,
  colorwayId: string,
  patch: { name?: string; hex?: string },
): Promise<void> {
  const update: Partial<ColorwayRow> = {};
  if (patch.name) update.name = patch.name.trim();
  if (patch.hex) {
    if (!hexColor.safeParse(patch.hex).success)
      throw new AppError("validation", "Use a #RRGGBB colour.");
    update.hex = patch.hex.toUpperCase();
  }
  const { error } = await supabase.from("colorways").update(update).eq("id", colorwayId);
  if (error)
    throw new AppError("unknown", "Could not update the colourway.", { detail: error.message });
}

export async function deleteColorway(
  supabase: TypedSupabaseClient,
  colorwayId: string,
): Promise<void> {
  const { data } = await supabase
    .from("colorways")
    .select("swatch_path")
    .eq("id", colorwayId)
    .maybeSingle();
  const { error } = await supabase.from("colorways").delete().eq("id", colorwayId);
  if (error)
    throw new AppError("unknown", "Could not delete the colourway.", { detail: error.message });
  // Eyedropper samples point at product photos, so only swatches are removed.
  if (data?.swatch_path) await removeObjects(supabase, [data.swatch_path]);
}
