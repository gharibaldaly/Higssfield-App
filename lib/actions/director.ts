"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import {
  addShot,
  applyPreset,
  approvePreview,
  approveShot,
  createAdProject,
  createProjectSchema,
  deletePreset,
  deleteShot,
  generateShot,
  planShots,
  reorderShots,
  resetBuiltinPreset,
  savePreset,
  savePresetSchema,
  updateAdProject,
  updateProjectSchema,
  updateShot,
  updateShotSchema,
} from "@/lib/director/service";
import { fail, ok, type ActionResult } from "@/lib/errors";

const uuid = z.uuid();

function revalidateProject(projectId: string) {
  revalidatePath(`/ads/${projectId}`);
}

export async function createAdProjectAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase } = await requireOwnerForAction();
    const project = await createAdProject(supabase, createProjectSchema.parse(input));
    revalidatePath("/ads");
    return ok({ id: project.id });
  } catch (error) {
    return fail(error);
  }
}

export async function updateAdProjectAction(input: unknown): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    const parsed = updateProjectSchema.parse(input);
    await updateAdProject(supabase, parsed);
    revalidateProject(parsed.projectId);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function applyPresetAction(
  projectId: string,
  presetId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await applyPreset(supabase, uuid.parse(projectId), uuid.parse(presetId));
    revalidateProject(projectId);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function savePresetAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase } = await requireOwnerForAction();
    const preset = await savePreset(supabase, savePresetSchema.parse(input));
    revalidatePath("/ads");
    return ok({ id: preset.id });
  } catch (error) {
    return fail(error);
  }
}

export async function resetPresetAction(presetId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await resetBuiltinPreset(supabase, uuid.parse(presetId));
    revalidatePath("/ads");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function deletePresetAction(presetId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await deletePreset(supabase, uuid.parse(presetId));
    revalidatePath("/ads");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function planShotsAction(projectId: string): Promise<ActionResult<{ shots: number }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const shots = await planShots(supabase, user.id, uuid.parse(projectId));
    revalidateProject(projectId);
    return ok({ shots: shots.length });
  } catch (error) {
    return fail(error);
  }
}

export async function updateShotAction(projectId: string, input: unknown): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await updateShot(supabase, updateShotSchema.parse(input));
    revalidateProject(projectId);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function addShotAction(projectId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase } = await requireOwnerForAction();
    const shot = await addShot(supabase, uuid.parse(projectId));
    revalidateProject(projectId);
    return ok({ id: shot.id });
  } catch (error) {
    return fail(error);
  }
}

export async function deleteShotAction(projectId: string, shotId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await deleteShot(supabase, uuid.parse(shotId));
    revalidateProject(projectId);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function reorderShotsAction(
  projectId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await reorderShots(supabase, uuid.parse(projectId), z.array(uuid).max(20).parse(orderedIds));
    revalidateProject(projectId);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

const generateSchema = z.object({
  shotId: uuid,
  note: z.string().trim().max(1000).nullable().optional(),
  target: z.enum(["auto", "preview", "video"]).optional(),
});

export async function generateShotAction(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ generationId: string; status: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const parsed = generateSchema.parse(input);
    const generation = await generateShot(supabase, user.id, parsed.shotId, {
      note: parsed.note || null,
      target: parsed.target,
    });
    revalidateProject(projectId);
    return ok({ generationId: generation.id, status: generation.status });
  } catch (error) {
    return fail(error);
  }
}

export async function approvePreviewAction(
  projectId: string,
  shotId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await approvePreview(supabase, uuid.parse(shotId));
    revalidateProject(projectId);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function approveShotAction(projectId: string, shotId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await approveShot(supabase, uuid.parse(shotId));
    revalidateProject(projectId);
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}
