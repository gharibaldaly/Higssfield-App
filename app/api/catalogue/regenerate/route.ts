import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { regenerateCatalogueOutput } from "@/lib/catalogue/service";
import { fail, ok } from "@/lib/errors";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";

// The director brain writes the new prompt before the request is sent.
export const maxDuration = 300;

const bodySchema = z.object({
  generationId: z.uuid(),
  note: z.string().trim().max(1000).nullable(),
});

/**
 * POST /api/catalogue/regenerate
 * Regenerates one catalogue output, with the owner's note if any. A route and
 * not a server action: it waits for the director brain, and Next runs server
 * actions one at a time, so an Approve clicked meanwhile would wait with it.
 * The page refreshes itself once the answer is in.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const body = await readJsonBody(request, bodySchema);
    const row = await regenerateCatalogueOutput(
      supabase,
      user.id,
      body.generationId,
      body.note || null,
    );
    return jsonResult(ok({ generationId: row.id }));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
