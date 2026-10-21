-- 0022 — P1a hardening after the independent security review (docs/AUDIT_LOG.md, P1a entry).
--   1. persist_run_outcome / mark_run_error REQUIRE an owner token: a null owner matched pre-lease rows
--      ('is not distinct from'), letting an owner-less call write an outcome (review L2).
--   2. approve_request requires a READABLE quote, not just a draft: no approval of a draft whose quote
--      is missing or whose v2 snapshot has no options (the dashboard check was UI-only — review L2).
--   3. Least privilege on tables (review L3): anon holds no table privileges at all; authenticated
--      cannot TRUNCATE (TRUNCATE bypasses RLS); quote_internals is append-only for service_role (no
--      UPDATE/TRUNCATE — pricing receipts cannot be rewritten after the fact). Defaults for future
--      tables follow the same rule.

-- ── 1. owner required ────────────────────────────────────────────────────────────────────────────
create or replace function public.persist_run_outcome(
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
  if p_owner is null or length(p_owner) = 0 then
    raise exception 'persist_run_outcome: owner token required' using errcode = 'check_violation';
  end if;
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

create or replace function public.mark_run_error(p_tenant_id uuid, p_request_id uuid, p_owner text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_owner is null or length(p_owner) = 0 then
    raise exception 'mark_run_error: owner token required' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set status = 'error'
   where id = p_request_id and tenant_id = p_tenant_id and status = 'processing'
     and claim_owner = p_owner;
  return found;
end; $$;

-- ── 2. approval needs a readable quote ───────────────────────────────────────────────────────────
create or replace function public.approve_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'approve_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests q
     set status = 'sending'
   where q.id = p_request_id and q.tenant_id = v_tenant and q.status = 'awaiting_review'
     and exists (select 1 from public.drafts d where d.request_id = q.id and d.tenant_id = v_tenant)
     and exists (
       select 1 from public.quotes k
        where k.request_id = q.id and k.tenant_id = v_tenant
          and (k.quote_version = 1
               or (jsonb_typeof(k.breakdown_snapshot -> 'options') = 'array'
                   and jsonb_array_length(k.breakdown_snapshot -> 'options') > 0)))
  returning q.id into v_id;
  if not found then
    raise exception 'approve_request: % is not approvable by caller (wrong tenant, not awaiting_review, no draft, or no readable quote)', p_request_id
      using errcode = 'check_violation';
  end if;
  return v_id;
end; $$;

-- ── 3. least privilege on tables ─────────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
revoke update, truncate on table public.quote_internals from service_role;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke truncate on tables from authenticated;

-- grants: unchanged signatures, re-asserted explicitly (lint: hardening_function_privileges.sql)
revoke all on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  to service_role;
revoke all on function public.mark_run_error(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_run_error(uuid, uuid, text) to service_role;
revoke all on function public.approve_request(uuid) from public, anon, service_role;
grant execute on function public.approve_request(uuid) to authenticated;
