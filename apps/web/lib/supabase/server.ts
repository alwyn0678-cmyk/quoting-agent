import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server (anon + session-from-cookies) Supabase client for Server Components and Route Handlers.
 * It carries the signed-in user's JWT via cookies, so every query runs under that user's RLS —
 * the dashboard's tenant scoping is the database's job, not the app's (AC-5).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll was called from a Server Component (cookies are read-only there).
            // Safe to ignore: the middleware refreshes the session cookies on every request.
          }
        },
      },
    },
  );
}
