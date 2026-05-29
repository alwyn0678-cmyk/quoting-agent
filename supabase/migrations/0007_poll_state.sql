-- 0007 — Phase 1C.1: poll cursor state. The scheduled poll (Trigger.dev, service_role) persists a
-- per-tenant, per-mailbox cursor (the latest receivedDateTime ingested) so each cycle lists only newer
-- mail (OutlookMailbox.listSince). Written ONLY by the autonomous path (service_role, which bypasses
-- RLS); the browser never writes it. RLS + a tenant policy are enabled for consistency (D-15) so that
-- if a cursor is ever surfaced it is tenant-scoped. Append-only; idempotent.

create table if not exists public.poll_state (
  tenant_id  uuid not null references public.tenants(id),
  mailbox    text not null,
  cursor     text not null default '1970-01-01T00:00:00Z',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, mailbox)
);

alter table public.poll_state enable row level security;

drop policy if exists poll_state_by_tenant on public.poll_state;
create policy poll_state_by_tenant on public.poll_state
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());

-- Read-only for the browser roles (no DML — writes are service_role only, like the rest post-0003).
grant select on public.poll_state to anon, authenticated;
