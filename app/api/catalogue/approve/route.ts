import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { approveCatalogueOutput } from "@/lib/catalogue/service";
import { fail, ok } from "@/lib/errors";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";

const bodySchema = z.object({ generationId: z.uuid() });

/**
 * POST /api/catalogue/approve
 * Approves one catalogue output. A route and not a server action: an action
 * that revalidates renders the whole page again in its answer, and Next runs
 * actions one at a time, so approving a batch image by image queued a full
 * render per click. The page shows the approval at once and refreshes once
 * for a burst of them.
 */
export async function POST(request: Request) {
  try {
    const { supabase } = await requireOwnerForAction();
    const { generationId } = await readJsonBody(request, bodySchema);
    await approveCatalogueOutput(supabase, generationId);
    return jsonResult(ok(undefined));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
