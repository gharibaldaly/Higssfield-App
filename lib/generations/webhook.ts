import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

function signature(generationId: string, secret: string): string {
  return createHmac("sha256", secret).update(generationId).digest("hex");
}

/**
 * Per-generation webhook URL. Higgsfield calls it on completion
 * (?hf_webhook=… per the official SDK); the HMAC in the URL proves the call
 * came from a URL we issued. Returns null when webhooks are not configured.
 */
export function webhookUrlFor(generationId: string): string | null {
  const env = serverEnv();
  if (!env.HIGGSFIELD_WEBHOOK_SECRET || !env.APP_URL) return null;
  const base = env.APP_URL.replace(/\/+$/, "");
  const sig = signature(generationId, env.HIGGSFIELD_WEBHOOK_SECRET);
  return `${base}/api/webhooks/higgsfield?gid=${encodeURIComponent(generationId)}&sig=${sig}`;
}

export function verifyWebhookSignature(generationId: string, sig: string): boolean {
  const secret = serverEnv().HIGGSFIELD_WEBHOOK_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = Buffer.from(signature(generationId, secret), "hex");
  const received = Buffer.from(sig, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
