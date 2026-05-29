import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser (anon) Supabase client. Used only by the login page to request a magic link.
 * Tenant isolation is enforced by RLS on the signed-in JWT — this key is safe in the client
 * (that is exactly what AC-5 proves: anon + session sees only the caller's tenant).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
