import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { generateShot } from "@/lib/director/service";
import { fail, ok } from "@/lib/errors";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";

// The director brain writes the shot's prompt before the request is sent.
export const maxDuration = 300;

const bodySchema = z.object({
  shotId: z.uuid(),
  note: z.string().trim().max(1000).nullable().optional(),
  target: z.enum(["auto", "preview", "video"]).optional(),
});

/**
 * POST /api/ads/shots/generate
 * Generates one shot's preview frame or video. A route and not a server
 * action, so edits and approvals on the board never wait behind the
 * director brain. The board refreshes itself once the answer is in.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const body = await readJsonBody(request, bodySchema);
    const generation = await generateShot(supabase, user.id, body.shotId, {
      note: body.note || null,
      target: body.target,
    });
    return jsonResult(ok({ generationId: generation.id, status: generation.status }));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
