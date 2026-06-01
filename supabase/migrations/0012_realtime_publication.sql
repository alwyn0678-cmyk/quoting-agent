-- 0012 — enable Supabase Realtime for the dashboard live-refresh.
-- The dashboard <LiveRefresh/> client subscribes to postgres_changes on these tables (RLS-scoped to
-- the signed-in tenant by the existing SELECT policies) and soft-refreshes the server components, so
-- inbound mail and the sent-status flip appear without a manual browser refresh. No new access is
-- granted: Realtime only ever delivers rows the caller could already SELECT. Idempotent.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quote_requests') then
    alter publication supabase_realtime add table public.quote_requests;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drafts') then
    alter publication supabase_realtime add table public.drafts;
  end if;
end $$;
