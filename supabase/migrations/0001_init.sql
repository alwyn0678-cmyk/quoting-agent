-- 0001_init.sql — Phase 1B.1: multi-tenant schema + RLS for QuoteAgent (SPEC.md data model).
-- Applied to the live `quoteagent` project via the Supabase Management API. Structure only —
-- rows are seeded in 1B.2. RLS model (D-15): the browser path (anon/authenticated) is filtered by
-- the policies below; `service_role` (poll/agent run) BYPASSES RLS, so the autonomous path's
-- isolation is code-level tenant_id scoping (AUTONOMY P-TENANT), not these policies. AC-5 here
-- proves the policies isolate the browser path; the end-to-end browser auth test lands at 1C.3.

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists public.profiles (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id)
);

create table if not exists public.rate_cards (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  lane             text not null,
  version          text not null,
  validity_through date not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- rate_card_lines has NO own tenant_id — it is isolated by a parent join to rate_cards (D-16).
create table if not exists public.rate_card_lines (
  id             uuid primary key default gen_random_uuid(),
  rate_card_id   uuid not null references public.rate_cards(id) on delete cascade,
  kind           text not null check (kind in ('base','surcharge_per_container','per_shipment_fee')),
  code           text not null,
  container_type text,
  amount         integer not null
);

create table if not exists public.quote_requests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  source           text not null check (source in ('poll','paste','sample')),
  from_email       text,
  subject          text,
  body             text,
  graph_message_id text unique,
  status           text not null default 'received'
                     check (status in ('received','processing','awaiting_review','escalated','sent','error')),
  created_at       timestamptz not null default now()
);

create table if not exists public.quotes (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null unique references public.quote_requests(id) on delete cascade,
  tenant_id          uuid not null references public.tenants(id),
  rate_card_version  text not null,
  container_type     text not null,
  container_qty      integer not null,
  all_in_total       integer not null,
  breakdown_snapshot jsonb not null,           -- immutable priced line items (D-16 reproducibility)
  validity_through   date not null,
  created_at         timestamptz not null default now()
);

create table if not exists public.drafts (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null unique references public.quote_requests(id) on delete cascade,
  tenant_id         uuid not null references public.tenants(id),
  subject           text not null,
  body              text not null,
  edited_body       text,
  status            text not null default 'draft',
  simulated_sent_at timestamptz
);

create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id),
  request_id     uuid references public.quote_requests(id) on delete set null,
  event          text not null,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  est_cost_usd   numeric,
  injection_flag boolean,
  created_at     timestamptz not null default now()
);

-- ── Tenant resolver: SECURITY DEFINER reads profiles bypassing RLS, so tenant policies that call
--    it do NOT recurse through profiles' own policy (the classic Supabase self-reference trap). ──
create or replace function public.auth_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where user_id = auth.uid()
$$;

revoke all on function public.auth_tenant_id() from public;
grant execute on function public.auth_tenant_id() to anon, authenticated, service_role;

-- ── Grants: PostgREST needs table privileges before RLS can filter rows. ──
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.tenants         enable row level security;
alter table public.profiles        enable row level security;
alter table public.rate_cards      enable row level security;
alter table public.rate_card_lines enable row level security;
alter table public.quote_requests  enable row level security;
alter table public.quotes          enable row level security;
alter table public.drafts          enable row level security;
alter table public.audit_log       enable row level security;

-- profiles: DIRECT policy (user_id = auth.uid()) — never calls auth_tenant_id(), so no recursion.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- tenants: a user sees only their own tenant.
drop policy if exists tenants_own on public.tenants;
create policy tenants_own on public.tenants
  for all using (id = public.auth_tenant_id()) with check (id = public.auth_tenant_id());

-- rate_card_lines: isolated by PARENT JOIN to rate_cards (no own tenant_id).
drop policy if exists rate_card_lines_by_parent on public.rate_card_lines;
create policy rate_card_lines_by_parent on public.rate_card_lines
  for all
  using      (rate_card_id in (select id from public.rate_cards where tenant_id = public.auth_tenant_id()))
  with check (rate_card_id in (select id from public.rate_cards where tenant_id = public.auth_tenant_id()));

-- every other tenant-scoped table: tenant_id = auth_tenant_id()
drop policy if exists rate_cards_by_tenant on public.rate_cards;
create policy rate_cards_by_tenant on public.rate_cards
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());

drop policy if exists quote_requests_by_tenant on public.quote_requests;
create policy quote_requests_by_tenant on public.quote_requests
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());

drop policy if exists quotes_by_tenant on public.quotes;
create policy quotes_by_tenant on public.quotes
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());

drop policy if exists drafts_by_tenant on public.drafts;
create policy drafts_by_tenant on public.drafts
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());

drop policy if exists audit_log_by_tenant on public.audit_log;
create policy audit_log_by_tenant on public.audit_log
  for all using (tenant_id = public.auth_tenant_id()) with check (tenant_id = public.auth_tenant_id());
