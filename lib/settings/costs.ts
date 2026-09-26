import "server-only";

import type { TypedSupabaseClient } from "@/lib/supabase/server";

export type CostSummary = {
  generations: { total: number; completed: number; failed: number; images: number; videos: number };
  thisMonth: { usd: number; credits: number; count: number };
  allTime: { usd: number; credits: number };
  byPurpose: { purpose: string; count: number; usd: number; credits: number }[];
  unpricedCount: number;
};

/** Totals from generations.cost (recorded only when the provider returns a cost). */
export async function loadCostSummary(supabase: TypedSupabaseClient): Promise<CostSummary> {
  const { data } = await supabase
    .from("generations")
    .select("purpose, kind, status, cost, cost_unit, provider, created_at")
    .order("created_at", { ascending: false })
    .limit(5000);
  const rows = data ?? [];
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const summary: CostSummary = {
    generations: { total: rows.length, completed: 0, failed: 0, images: 0, videos: 0 },
    thisMonth: { usd: 0, credits: 0, count: 0 },
    allTime: { usd: 0, credits: 0 },
    byPurpose: [],
    unpricedCount: 0,
  };
  const byPurpose = new Map<string, { count: number; usd: number; credits: number }>();
  for (const row of rows) {
    if (row.status === "completed") summary.generations.completed += 1;
    if (row.status === "failed" || row.status === "nsfw") summary.generations.failed += 1;
    if (row.kind === "image") summary.generations.images += 1;
    else summary.generations.videos += 1;
    const entry = byPurpose.get(row.purpose) ?? { count: 0, usd: 0, credits: 0 };
    entry.count += 1;
    const cost = row.cost === null ? null : Number(row.cost);
    const inMonth = Date.parse(row.created_at) >= monthStart.getTime();
    if (inMonth) summary.thisMonth.count += 1;
    if (cost === null) {
      if (row.provider === "higgsfield" && row.status === "completed") summary.unpricedCount += 1;
    } else if (row.cost_unit === "usd") {
      summary.allTime.usd += cost;
      entry.usd += cost;
      if (inMonth) summary.thisMonth.usd += cost;
    } else {
      summary.allTime.credits += cost;
      entry.credits += cost;
      if (inMonth) summary.thisMonth.credits += cost;
    }
    byPurpose.set(row.purpose, entry);
  }
  summary.byPurpose = [...byPurpose.entries()]
    .map(([purpose, value]) => ({ purpose, ...value }))
    .sort((a, b) => b.count - a.count);
  return summary;
}
