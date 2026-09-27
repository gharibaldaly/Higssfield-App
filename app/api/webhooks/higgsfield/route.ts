import { NextResponse, type NextRequest } from "next/server";

import { refreshGeneration } from "@/lib/generations/service";
import { verifyWebhookSignature } from "@/lib/generations/webhook";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Higgsfield completion webhook (?hf_webhook=… on submit). The payload is not
 * trusted: the signed generation id in the URL tells us which row to refresh,
 * and the result is fetched from the provider's status endpoint as usual —
 * then copied into Supabase Storage immediately.
 */
export async function POST(request: NextRequest) {
  const generationId = request.nextUrl.searchParams.get("gid") ?? "";
  const signature = request.nextUrl.searchParams.get("sig") ?? "";
  if (!generationId || !verifyWebhookSignature(generationId, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: row } = await supabase
    .from("generations")
    .select("*")
    .eq("id", generationId)
    .maybeSingle();
  if (!row) return NextResponse.json({ ok: true, ignored: true });

  await refreshGeneration(supabase, row, { force: true });
  return NextResponse.json({ ok: true });
}
