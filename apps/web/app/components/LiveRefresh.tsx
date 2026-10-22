"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

/**
 * Keeps the dashboard live without a manual browser refresh. Supabase Realtime (RLS-scoped to the
 * signed-in tenant via the session token) soft-refreshes the server components the instant a
 * `quote_requests` / `drafts` row changes — so inbound mail and the sent-status flip appear on their
 * own. A 10s interval is a safety net so the view is never stale even if the Realtime socket drops.
 * Renders nothing.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const refresh = () => router.refresh();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    void (async () => {
      // Hand the user's JWT to Realtime so postgres_changes are RLS-filtered to their tenant.
      const { data } = await supabase.auth.getSession();
      // Unmounted while awaiting (StrictMode's mount→unmount→mount) — don't leak a channel.
      if (cancelled) return;
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      // The browser client is a singleton and channel(topic) returns an EXISTING channel for a
      // topic, so a shared name hands a remount the already-subscribed channel (→ `.on` throws).
      channel = supabase
        .channel(`dashboard-live-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "quote_requests" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "drafts" }, refresh)
        .subscribe();
    })();

    const id = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
