import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { fail, ok } from "@/lib/errors";
import { reviewGenerationFidelity } from "@/lib/generations/fidelity";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";

// The director brain compares the result with its references.
export const maxDuration = 300;

const bodySchema = z.object({ generationId: z.uuid() });

/**
 * POST /api/generations/fidelity
 * The AI fidelity check of one finished image. A route and not a server
 * action, so the owner can keep approving while the director brain looks.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const { generationId } = await readJsonBody(request, bodySchema);
    return jsonResult(ok(await reviewGenerationFidelity(supabase, user.id, generationId)));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
