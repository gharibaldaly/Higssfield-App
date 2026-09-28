import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { AppError, fail, ok } from "@/lib/errors";
import { jsonResult } from "@/lib/http/json-route";
import { collectionFiles } from "@/lib/library/collections";

const querySchema = z.object({
  batch: z.uuid().optional(),
  product: z.uuid().optional(),
  scope: z.enum(["all", "approved"]).default("all"),
});

/**
 * GET /api/library/files?batch=<id>|product=<id>&scope=all|approved
 * The files of a collection for a download: each finished image's path in
 * the archive and a link signed just now, so a page left open for hours
 * still downloads. The browser fetches the images and zips them itself.
 */
export async function GET(request: Request) {
  try {
    const { supabase } = await requireOwnerForAction();
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success || (!parsed.data.batch && !parsed.data.product)) {
      throw new AppError("validation", "The studio could not read this request. Reload the page.");
    }
    const ref = parsed.data.batch
      ? { kind: "batch" as const, id: parsed.data.batch }
      : { kind: "product" as const, id: parsed.data.product! };
    const files = await collectionFiles(supabase, ref, parsed.data.scope);
    if (!files) throw new AppError("not_found", "This collection no longer exists.");
    return jsonResult(ok(files));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
