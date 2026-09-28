"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import {
  cancelCatalogueJob,
  queueCatalogueJobs,
  queueJobsSchema,
  retryCatalogueJob,
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
