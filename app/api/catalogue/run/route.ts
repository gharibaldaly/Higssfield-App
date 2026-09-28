import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { runCatalogueJob } from "@/lib/catalogue/service";
import { fail, ok } from "@/lib/errors";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";

// The director brain writes every output's prompt before it is sent.
export const maxDuration = 300;

const bodySchema = z.object({ jobId: z.uuid() });

/**
 * POST /api/catalogue/run
 * Runs one queued catalogue job; the Ghost Studio page drives its queue one
 * job at a time. A route and not a server action, so approvals and page
 * updates never wait behind the director brain.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const { jobId } = await readJsonBody(request, bodySchema);
    const job = await runCatalogueJob(supabase, user.id, jobId);
    return jsonResult(ok({ status: job.status }));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
