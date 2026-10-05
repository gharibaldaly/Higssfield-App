import { z } from "zod";

import { requireOwnerForAction } from "@/lib/auth/owner";
import { fail, ok } from "@/lib/errors";
import { polishFreePrompt } from "@/lib/generations/free";
import {
  FREE_KINDS,
  FREE_MAX_PROMPT_CHARS,
  FREE_MAX_REFERENCES,
} from "@/lib/generations/free-plan";
import { jsonResult, readJsonBody } from "@/lib/http/json-route";
import { getOwnerSettings } from "@/lib/settings/service";

// The director brain may take a minute to answer.
export const maxDuration = 300;

const bodySchema = z.object({
  kind: z.enum(FREE_KINDS),
  prompt: z.string().trim().min(1).max(FREE_MAX_PROMPT_CHARS),
  modelLabel: z.string().trim().max(120).default("Higgsfield"),
  referencePaths: z.array(z.string().min(1).max(500)).max(FREE_MAX_REFERENCES).default([]),
  locale: z.enum(["ar", "en"]).default("ar"),
});

/**
 * POST /api/free/polish
 * The director brain rewrites the owner's prompt into a generation-ready one
 * without changing what it asks for. The owner reviews it before generating.
 */
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwnerForAction();
    const body = await readJsonBody(request, bodySchema);
    const settings = await getOwnerSettings(supabase, user.id);
    return jsonResult(ok(await polishFreePrompt(supabase, user.id, settings, body)));
  } catch (error) {
    return jsonResult(fail(error));
  }
}
