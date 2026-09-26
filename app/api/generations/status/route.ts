import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getOwner } from "@/lib/auth/owner";
import { isPendingStatus } from "@/lib/domain/generation";
import { toViews } from "@/lib/generations/queries";
import { refreshGenerations } from "@/lib/generations/service";

// Copying a finished video into Storage can take a while.
export const maxDuration = 300;

const idsSchema = z.array(z.uuid()).min(1).max(60);

/**
 * GET /api/generations/status?ids=a,b,c
 * Polls the provider for pending generations (copying finished files into
 * Supabase Storage right away) and returns client-safe views with signed URLs.
 */
export async function GET(request: NextRequest) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = idsSchema.safeParse(
    (request.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean),
  );
  if (!parsed.success) return NextResponse.json({ error: "invalid ids" }, { status: 400 });

  const { data: rows, error } = await owner.supabase
    .from("generations")
    .select("*")
    .in("id", parsed.data);
  if (error) return NextResponse.json({ error: "query failed" }, { status: 500 });

  const pending = (rows ?? []).filter((row) => isPendingStatus(row.status));
  const refreshed = await refreshGenerations(owner.supabase, pending);
  const byId = new Map([...(rows ?? []), ...refreshed].map((row) => [row.id, row]));
  const views = await toViews(owner.supabase, [...byId.values()]);
  return NextResponse.json({ generations: views }, { headers: { "Cache-Control": "no-store" } });
}
