import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Public routes reachable without a session (the login form + the magic-link callback). */
function isPublicPath(pathname: string): boolean {
  return pathname.startsWith("/login") || pathname.startsWith("/auth");
}

/**
 * Refresh the auth session on every request (Supabase SSR pattern) and gate private routes.
 * Returning the same `response` the client wrote cookies onto keeps the session fresh; an
 * unauthenticated request to a private route is redirected to /login. Invoked from proxy.ts
 * (Next 16's renamed Middleware).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() (not getSession()) re-validates with the auth server — the supported gate.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
