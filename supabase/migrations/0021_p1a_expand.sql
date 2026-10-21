-- 0021 — P1a expand (spec docs/specs/2026-10-21-p1a-multimodal-core.md §11, §15.11–13, §16.8–9).
-- Additive: v1 producers keep working; v2 producers can ship after this migration.
--   1. quotes: v2 columns + a version discriminator with per-version shape checks.
--   2. quote_requests: public outcome detail; lease ownership (claim_owner, claimed_at).
--   3. Final escalation taxonomy (mirrors packages/core/src/reasons.ts).
--   4. quote_internals: costs, margins, all candidates, trace — service_role ONLY.
--   5. claim_request / mark_run_error: owner-checked lease (Trigger run id), stale-steal after 70 min.
--   6. persist_run_outcome: owner-checked first statement; v1/v2 quote branches; outcome detail;
--      internals; tenant verified from the claimed row.
--   7. requeue_request also clears internals, outcome detail and the lease.
--   8. get_rate_card: one atomic read of a card and its lines (no torn snapshot).

-- ── 1. quotes v2 ──────────────────────────────────────────────────────────────────────────────
alter table public.quotes add column if not exists quote_version int not null default 1;
alter table public.quotes add column if not exists mode text;
alter table public.quotes add column if not exists currency text;
alter table public.quotes add column if not exists total_minor bigint;
alter table public.quotes add column if not exists option_count int;
alter table public.quotes alter column rate_card_version drop not null;
alter table public.quotes alter column container_type drop not null;
alter table public.quotes alter column container_qty drop not null;
alter table public.quotes alter column all_in_total drop not null;
alter table public.quotes drop constraint if exists quotes_version_shape;
alter table public.quotes add constraint quotes_version_shape check (
  (quote_version = 1
     and rate_card_version is not null and container_type is not null and container_qty is not null
     and all_in_total is not null and validity_through is not null)
  or
  (quote_version = 2
     and mode in ('FCL', 'LCL')
     and currency in ('EUR','USD','GBP','CNY','SGD','ZAR','BRL','HKD','INR','JPY')
     and total_minor between 0 and 1000000000000000
     and option_count >= 1
     and validity_through is not null)
);

-- ── 2. requests: outcome detail + lease ownership ───────────────────────────────────────────────
alter table public.quote_requests add column if not exists outcome_detail jsonb;
alter table public.quote_requests add column if not exists claim_owner text;
alter table public.quote_requests add column if not exists claimed_at timestamptz;

-- ── 3. final escalation taxonomy ────────────────────────────────────────────────────────────────
alter table public.quote_requests drop constraint if exists quote_requests_reason_enum;
alter table public.quote_requests add constraint quote_requests_reason_enum
  check (escalation_reason is null or escalation_reason in (
    'missing_required_field','out_of_scope_lane','out_of_scope_mode','out_of_scope_container',
    'out_of_scope_service','out_of_scope_cargo','conflicting_cargo','request_too_large',
    'rate_expired','ambiguous_request','tariff_config_error','pricing_capacity_exceeded',
    'fx_invalid','fx_missing_rate','model_refused','model_output_invalid','low_confidence',
    'guard_violation'));

-- ── 4. quote_internals (cost-confidential) ──────────────────────────────────────────────────────
create table if not exists public.quote_internals (
  request_id     uuid primary key references public.quote_requests(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id),
  pricing_result jsonb not null,
  created_at     timestamptz not null default now()
);
alter table public.quote_internals enable row level security;
revoke all on table public.quote_internals from public, anon, authenticated;
grant select, insert, delete on table public.quote_internals to service_role;

-- ── 5. lease: claim + owner-checked error marking ───────────────────────────────────────────────
create or replace function public.claim_request(
  p_tenant_id uuid, p_request_id uuid, p_owner text, p_lease_minutes int default 70)
returns table (id uuid, tenant_id uuid, from_email text, subject text, body text)
language plpgsql security definer set search_path = public as $$
begin
  if p_owner is null or length(p_owner) = 0 then
    raise exception 'claim_request: owner token required' using errcode = 'check_violation';
  end if;
  return query
  update public.quote_requests q
     set status = 'processing', claim_owner = p_owner, claimed_at = now()
   where q.id = p_request_id and q.tenant_id = p_tenant_id
     and (q.status = 'received'
          or (q.status = 'processing'
              and (q.claim_owner = p_owner
                   or q.claimed_at is null
                   or q.claimed_at < now() - make_interval(mins => p_lease_minutes))))
  returning q.id, q.tenant_id, q.from_email, q.subject, q.body;
end; $$;

create or replace function public.mark_run_error(p_tenant_id uuid, p_request_id uuid, p_owner text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.quote_requests
     set status = 'error'
   where id = p_request_id and tenant_id = p_tenant_id and status = 'processing'
     and claim_owner is not distinct from p_owner;
  return found;
end; $$;

-- ── 6. persist_run_outcome (owner-checked, v1/v2) ───────────────────────────────────────────────
drop function if exists public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb, jsonb);

create function public.persist_run_outcome(
  p_request_id        uuid,
  p_tenant_id         uuid,
  p_status            text,
  p_escalation_reason text,
  p_injection_flag    boolean,
  p_quote             jsonb,
  p_draft             jsonb,
  p_usage             jsonb,
  p_extraction        jsonb default null,
  p_outcome_detail    jsonb default null,
  p_internals         jsonb default null,
  p_owner             text  default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_version int;
begin
  if p_status not in ('awaiting_review', 'escalated') then
    raise exception 'persist_run_outcome: invalid status %', p_status;
  end if;

  -- FIRST statement: owner- and tenant-checked, first-writer-wins transition. A losing, stale or
  -- foreign attempt changes nothing and writes nothing (returns false).
  update public.quote_requests
     set status = p_status, escalation_reason = p_escalation_reason, injection_flag = p_injection_flag,
         extraction = p_extraction, outcome_detail = p_outcome_detail
   where id = p_request_id and tenant_id = p_tenant_id and status = 'processing'
     and claim_owner is not distinct from p_owner;
  if not found then
    return false;
  end if;

  if p_quote is not null then
    v_version := coalesce((p_quote->>'quote_version')::int, 1);
    if v_version = 2 then
      insert into public.quotes
        (request_id, tenant_id, quote_version, mode, currency, total_minor, option_count,
         breakdown_snapshot, validity_through)
      values
        (p_request_id, p_tenant_id, 2, p_quote->>'mode', p_quote->>'currency',
         (p_quote->>'total_minor')::bigint, (p_quote->>'option_count')::int,
         p_quote->'breakdown_snapshot', (p_quote->>'validity_through')::date)
      on conflict (request_id) do nothing;
    else
      insert into public.quotes
        (request_id, tenant_id, rate_card_version, container_type, container_qty, all_in_total,
         breakdown_snapshot, validity_through)
      values
        (p_request_id, p_tenant_id, p_quote->>'rate_card_version', p_quote->>'container_type',
         (p_quote->>'container_qty')::int, (p_quote->>'all_in_total')::int,
         p_quote->'breakdown_snapshot', (p_quote->>'validity_through')::date)
      on conflict (request_id) do nothing;
    end if;
  end if;

  if p_draft is not null then
    insert into public.drafts (request_id, tenant_id, subject, body)
    values (p_request_id, p_tenant_id, p_draft->>'subject', p_draft->>'body')
    on conflict (request_id) do nothing;
  end if;

  if p_internals is not null then
    insert into public.quote_internals (request_id, tenant_id, pricing_result)
    values (p_request_id, p_tenant_id, p_internals)
    on conflict (request_id) do nothing;
  end if;

  insert into public.audit_log
    (tenant_id, request_id, event, model, input_tokens, output_tokens, est_cost_usd, injection_flag,
     actor_type, detail)
  values
    (p_tenant_id, p_request_id,
     case p_status when 'awaiting_review' then 'quote' else 'escalate' end,
     p_usage->>'model', (p_usage->>'input_tokens')::int, (p_usage->>'output_tokens')::int,
     (p_usage->>'est_cost_usd')::numeric, p_injection_flag,
     'system', jsonb_build_object('extraction', p_extraction, 'outcome', p_outcome_detail));

  return true;
end; $$;

-- ── 7. requeue clears the whole previous run ────────────────────────────────────────────────────
create or replace function public.requeue_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'requeue_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set status = 'received', escalation_reason = null, injection_flag = false, archived_at = null,
         send_claimed_at = null, outcome_detail = null, claim_owner = null, claimed_at = null
   where id = p_request_id and tenant_id = v_tenant and status in ('escalated','error')
  returning id into v_id;
  if not found then
    raise exception 'requeue_request: % not re-runnable (wrong tenant or not escalated/error)', p_request_id
      using errcode = 'check_violation';
  end if;
  delete from public.quotes where request_id = p_request_id and tenant_id = v_tenant;
  delete from public.drafts where request_id = p_request_id and tenant_id = v_tenant;
  delete from public.quote_internals where request_id = p_request_id and tenant_id = v_tenant;
  return v_id;
end; $$;

-- ── 8. atomic rate-card read for the legacy tariff adapter ──────────────────────────────────────
create or replace function public.get_rate_card(p_tenant_id uuid, p_mode text, p_lane text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'card', jsonb_build_object('id', c.id, 'mode', c.mode, 'version', c.version,
                                      'validity_through', c.validity_through, 'lane', c.lane),
           'lines', coalesce((select jsonb_agg(jsonb_build_object(
                                 'kind', l.kind, 'code', l.code, 'container_type', l.container_type,
                                 'amount', l.amount, 'sort_order', l.sort_order)
                               order by l.kind, l.sort_order, l.code)
                              from public.rate_card_lines l where l.rate_card_id = c.id), '[]'::jsonb))
    from public.rate_cards c
   where c.tenant_id = p_tenant_id and c.mode = p_mode and c.lane = p_lane and c.is_active
   order by c.created_at desc
   limit 1;
$$;

-- ── grants: explicit matrix (lint: supabase/tests/hardening_function_privileges.sql) ────────────
revoke all on function public.claim_request(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.claim_request(uuid, uuid, text, int) to service_role;
revoke all on function public.mark_run_error(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_run_error(uuid, uuid, text) to service_role;
revoke all on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  to service_role;
revoke all on function public.requeue_request(uuid) from public, anon, service_role;
grant execute on function public.requeue_request(uuid) to authenticated;
revoke all on function public.get_rate_card(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_rate_card(uuid, text, text) to service_role;
