import { NextResponse } from "next/server";
import type { z } from "zod";

import { AppError, type ActionResult, type AppErrorCode } from "@/lib/errors";

/** The HTTP status of a failed ActionResult, for the logs and the browser's network panel. */
export function jsonStatus(code: AppErrorCode | undefined): number {
  switch (code) {
    case "auth":
      return 401;
    case "not_found":
      return 404;
    case "validation":
      return 400;
    case "conflict":
      return 409;
    case undefined:
    case "config":
    case "unknown":
      return 500;
    default:
      // A provider (Higgsfield, the director brain) failed or refused.
      return 502;
  }
}

/** Answers with an ActionResult, like the studio's server actions; never cached. */
export function jsonResult<T>(result: ActionResult<T>): NextResponse {
  return NextResponse.json(result, {
    status: result.ok ? 200 : jsonStatus(result.code),
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Reads a route's JSON body against its schema. Only JSON is accepted: a
 * cross-site page cannot send it without a CORS preflight, which is refused.
 */
export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  const body: unknown = type.startsWith("application/json")
    ? await request.json().catch(() => undefined)
    : undefined;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("validation", "The studio could not read this request. Reload the page.");
  }
  return parsed.data;
}
