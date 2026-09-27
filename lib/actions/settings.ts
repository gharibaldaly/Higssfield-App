"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { catalogueStyleSchema } from "@/lib/domain/catalogue-style";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { parseModelSpecs } from "@/lib/providers/higgsfield/registry";
import { driveSettingsSchema, updateOwnerSettings } from "@/lib/settings/service";

const modelIdField = z.string().trim().max(200).nullable();

const settingsSchema = z.object({
  llmProvider: z.enum(["claude", "gemini"]).optional(),
  claudeModel: modelIdField.optional(),
  geminiModel: modelIdField.optional(),
  catalogueStyle: catalogueStyleSchema.optional(),
  defaultImageModel: modelIdField.optional(),
  defaultVideoModel: modelIdField.optional(),
  drive: driveSettingsSchema.optional(),
});

export async function updateSettingsAction(input: unknown): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = settingsSchema.parse(input);
    await updateOwnerSettings(supabase, user.id, {
      ...parsed,
      claudeModel: parsed.claudeModel === "" ? null : parsed.claudeModel,
      geminiModel: parsed.geminiModel === "" ? null : parsed.geminiModel,
    });
    revalidatePath("/settings");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

/** Save the owner's custom model list (JSON). Every entry is validated. */
export async function saveCustomModelsAction(
  json: string,
): Promise<ActionResult<{ count: number }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      return { ok: false, error: "The text is not valid JSON.", code: "validation" };
    }
    if (!Array.isArray(value)) {
      return { ok: false, error: "Use a JSON array of model objects.", code: "validation" };
    }
    const { specs, errors } = parseModelSpecs(value);
    if (errors.length > 0) {
      return { ok: false, error: errors.slice(0, 3).join(" · "), code: "validation" };
    }
    await updateOwnerSettings(supabase, user.id, { customModels: specs });
    revalidatePath("/settings");
    return ok({ count: specs.length });
  } catch (error) {
    return fail(error);
  }
}
