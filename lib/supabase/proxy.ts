import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";

const PUBLIC_PATHS = ["/login", "/setup"];
const PUBLIC_API_PREFIXES = ["/api/webhooks/"];

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/**
 * Refreshes the Supabase session cookie on every request and keeps signed-out
 * visitors on /login. Authorization is still enforced per request in Server
 * Components, Server Actions and Route Handlers (requireOwner) and by RLS.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;

  if (!url || !anonKey) {
    if (pathname === "/setup") return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims() validates the JWT (locally when asymmetric keys are enabled).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}
