import type { ActionResult } from "@/lib/errors";

/**
 * POST to one of the studio's JSON routes, which answer with an ActionResult.
 * Long work (the director brain) goes through routes rather than server
 * actions: Next runs server actions one at a time, so a minute-long one would
 * hold up every click after it.
 */
export async function postJson<T>(url: string, body: unknown): Promise<ActionResult<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as ActionResult<T> | null;
    if (payload && typeof payload === "object" && "ok" in payload) return payload;
    // The session proxy answers signed-out API calls itself.
    if (response.status === 401) {
      return { ok: false, error: "Your session has ended. Sign in again.", code: "auth" };
    }
    // The platform cut the function off at its time limit.
    if (response.status === 504) {
      return {
        ok: false,
        error:
          "The studio took too long to answer. The work may have started anyway: refresh the page in a minute before trying again.",
      };
    }
    return { ok: false, error: `The studio did not answer (HTTP ${response.status}). Try again.` };
  } catch {
    return {
      ok: false,
      error: "The studio could not be reached. Check the connection and try again.",
    };
  }
}
