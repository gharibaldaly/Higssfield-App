import { requireMemberForAction } from "@/lib/auth/owner";
import { fail, ok } from "@/lib/errors";
import { estimateGeneration, estimateRequestSchema } from "@/lib/generations/estimate";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";
import { getOwnerSettings } from "@/lib/settings/service";

/**
 * POST /api/generations/estimate
 * The price of a request before it is sent, from Higgsfield's estimate
 * endpoint (nothing is generated or charged), with the size, quality and
 * duration the request would really carry.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireMemberForAction();
    const body = await readJsonBody(request, estimateRequestSchema);
    const settings = await getOwnerSettings(supabase, user.id);
    return jsonResult(ok(await estimateGeneration(settings, body)));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
