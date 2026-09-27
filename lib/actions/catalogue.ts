"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import {
  approveCatalogueOutput,
  cancelCatalogueJob,
  queueCatalogueJobs,
  queueJobsSchema,
  regenerateCatalogueOutput,
  retryCatalogueJob,
  runCatalogueJob,
} from "@/lib/catalogue/service";
import { fail, ok, type ActionResult } from "@/lib/errors";

export async function queueCatalogueJobsAction(input: unknown): Promise<
  ActionResult<{
    jobIds: string[];
    skipped: { productId: string; jobType: string; reason: string }[];
  }>
> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const result = await queueCatalogueJobs(supabase, user.id, queueJobsSchema.parse(input));
    revalidatePath("/ghost");
    return ok({ jobIds: result.jobs.map((job) => job.id), skipped: result.skipped });
  } catch (error) {
    return fail(error);
  }
}

/** Runs one queued job (the Ghost Studio page drives the queue one job at a time). */
export async function runCatalogueJobAction(
  jobId: string,
): Promise<ActionResult<{ status: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const job = await runCatalogueJob(supabase, user.id, z.uuid().parse(jobId));
    return ok({ status: job.status });
  } catch (error) {
    return fail(error);
  }
}

export async function approveCatalogueOutputAction(generationId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await approveCatalogueOutput(supabase, z.uuid().parse(generationId));
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function regenerateCatalogueOutputAction(
  generationId: string,
  note: string | null,
): Promise<ActionResult<{ generationId: string }>> {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const row = await regenerateCatalogueOutput(
      supabase,
      user.id,
      z.uuid().parse(generationId),
      z.string().max(1000).nullable().parse(note),
    );
    revalidatePath("/ghost");
    return ok({ generationId: row.id });
  } catch (error) {
    return fail(error);
  }
}

export async function cancelCatalogueJobAction(jobId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await cancelCatalogueJob(supabase, z.uuid().parse(jobId));
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function retryCatalogueJobAction(jobId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireOwnerForAction();
    await retryCatalogueJob(supabase, z.uuid().parse(jobId));
    revalidatePath("/ghost");
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}
