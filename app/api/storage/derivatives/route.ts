import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { fail, ok } from "@/lib/errors";
import { BACKFILL_PHASES, backfillStep, countBackfill } from "@/lib/storage/backfill";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";

// Each call reads and re-encodes a page of stored images.
export const maxDuration = 300;

const bodySchema = z.object({
  cursor: z.object({ phase: z.enum(BACKFILL_PHASES), offset: z.number().int().min(0) }).nullable(),
});

/**
 * POST /api/storage/derivatives
 * Makes the small copies of the files stored before copies existed, one page
 * per call: the first call (no cursor) also counts the files, and every
 * answer carries the cursor for the next call until `next` is null.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const { cursor } = await readJsonBody(request, bodySchema);
    const total = cursor ? null : await countBackfill(supabase, user.id);
    const step = await backfillStep(supabase, user.id, cursor);
    return jsonResult(ok({ ...step, total }));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
