import { after, NextResponse, type NextRequest } from "next/server";

import { isTerminalStatus } from "@/lib/domain/generation";
import { refreshGeneration } from "@/lib/generations/service";
import { verifyWebhookSignature, webhookEnvelopeSchema } from "@/lib/generations/webhook";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Higgsfield completion webhook (?hf_webhook=… on submit). Per the docs,
 * Higgsfield POSTs { request_id, status, error, payload } once a request is
 * completed, failed or nsfw, may deliver it more than once, retries network
 * failures and 5xx for two hours, gives up on 4xx, and wants an answer within
 * ten seconds. So the call is answered at once and the result is settled
 * afterwards: the signed generation id in the URL names the row, and the
 * result is read from the status endpoint as usual (the payload is not
 * trusted), then copied into Supabase Storage.
 */
export async function POST(request: NextRequest) {
  const generationId = request.nextUrl.searchParams.get("gid") ?? "";
  const signature = request.nextUrl.searchParams.get("sig") ?? "";
  if (!generationId || !verifyWebhookSignature(generationId, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const envelope = webhookEnvelopeSchema.safeParse(await request.json().catch(() => null));
  if (!envelope.success) {
    return NextResponse.json({ error: "unexpected body" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: row } = await supabase
    .from("generations")
    .select("*")
    .eq("id", generationId)
    .maybeSingle();
  if (!row) return NextResponse.json({ ok: true, ignored: true });
  if (!row.provider_request_id) {
    // The submit has not recorded its request id yet: ask Higgsfield to deliver again.
    return NextResponse.json({ error: "not ready" }, { status: 503 });
  }
  if (row.provider_request_id !== envelope.data.request_id) {
    return NextResponse.json({ error: "unknown request" }, { status: 400 });
  }
  if (isTerminalStatus(row.status)) return NextResponse.json({ ok: true, duplicate: true });

  after(async () => {
    await refreshGeneration(supabase, row, { force: true });
  });
  return NextResponse.json({ ok: true });
}
