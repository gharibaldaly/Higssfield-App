"use client";

import { useEffect, useState } from "react";

import { postJson } from "@/components/common/post-json";
import type { Estimate, EstimateRequest } from "@/lib/generations/estimate";

/**
 * The price of a request before it is sent, refreshed (after a short pause)
 * whenever the model, size, quality or duration changes. Null while nothing
 * is chosen or the answer is still on its way; `usd` null when the provider
 * cannot say.
 */
export function useEstimate(request: EstimateRequest | null): {
  estimate: Estimate | null;
  loading: boolean;
} {
  const [answer, setAnswer] = useState<{ key: string; estimate: Estimate | null } | null>(null);
  const key = request ? JSON.stringify(request) : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await postJson<Estimate>(
        "/api/generations/estimate",
        JSON.parse(key) as EstimateRequest,
      );
      if (!cancelled) setAnswer({ key, estimate: result.ok ? result.data : null });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  const current = key && answer?.key === key ? answer.estimate : null;
  return { estimate: current, loading: key !== null && answer?.key !== key };
}

/** "$1.10" or "12 cr", or null when the provider gave no price. */
export function formatPrice(estimate: Pick<Estimate, "usd" | "credits"> | null): string | null {
  if (!estimate) return null;
  if (estimate.usd !== null) return `$${estimate.usd.toFixed(2)}`;
  if (estimate.credits !== null) return `${estimate.credits} cr`;
  return null;
}
