import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * Magic-link landing (PKCE). Supabase redirects here with a `code`; we exchange it for a
 * session (cookies written via the server client) and forward to the dashboard. On failure
 * (expired/used link) we bounce back to /login with a flag.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
