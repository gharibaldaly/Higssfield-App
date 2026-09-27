import { NextResponse } from "next/server";

import { getOwner } from "@/lib/auth/owner";
import { toUserMessage } from "@/lib/errors";
import { advanceGhostWork } from "@/lib/ghost-batches/runner";

// One step can analyse a model (photo sorting + Garment DNA) or write a job's prompts.
export const maxDuration = 300;

/**
 * POST /api/ghost-batches/advance
 * Runs one unit of ghost-batch work and reports what happened. The studio's
 * GhostBatchRunner calls it in a loop while a tab is open.
 */
export async function POST() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const report = await advanceGhostWork(owner.supabase, owner.user.id);
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Ghost batch step failed", error);
    return NextResponse.json(
      { error: toUserMessage(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
