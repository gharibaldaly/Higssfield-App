import { requireOwnerForAction } from "@/lib/auth/owner";
import { fail, ok } from "@/lib/errors";
import { submitFreeRequest } from "@/lib/generations/free";
import { freeRequestSchema } from "@/lib/generations/free-plan";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";
import { getOwnerSettings } from "@/lib/settings/service";

// Up to four submits, each signing its references and asking for an estimate.
export const maxDuration = 120;

/**
 * POST /api/free/generate
 * Sends the owner's own prompt to Higgsfield as it is, once per requested
 * output. A route rather than a server action, so the page never waits
 * behind the provider.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const body = await readJsonBody(request, freeRequestSchema);
    const settings = await getOwnerSettings(supabase, user.id);
    return jsonResult(ok(await submitFreeRequest(supabase, user.id, settings, body)));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
