-- 0020 — audit fidelity (Codex review 2 of Phase 0).
--  * actor_type ('user' | 'system') is snapshotted on every audit row, so deleting a reviewer's
--    account (actor_id → null) never turns a human action into a "system" one.
--  * Each run's usage row stores that run's extraction in detail.extraction — immutable per-run
--    evidence; quote_requests.extraction is only the CURRENT run's convenience copy.
--  * A requeue (any transition back to 'received') clears the current extraction, so a stale
--    extraction is never shown against a run that has not produced one yet.

alter table public.audit_log add column if not exists actor_type text;
update public.audit_log set actor_type = case when actor_id is null then 'system' else 'user' end
 where actor_type is null;
alter table public.audit_log alter column actor_type set default 'system';
alter table public.audit_log alter column actor_type set not null;
alter table public.audit_log drop constraint if exists audit_log_actor_type_check;
alter table public.audit_log add constraint audit_log_actor_type_check check (actor_type in ('user', 'system'));

create or replace function public.log_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_type  text := case when auth.uid() is null then 'system' else 'user' end;
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (tenant_id, request_id, event, actor_id, actor_type, detail)
    values (new.tenant_id, new.id, 'transition', v_actor, v_type,
            jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.escalation_reason));
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into public.audit_log (tenant_id, request_id, event, actor_id, actor_type)
    values (new.tenant_id, new.id, 'archived', v_actor, v_type);
  elsif old.archived_at is not null and new.archived_at is null then
    insert into public.audit_log (tenant_id, request_id, event, actor_id, actor_type)
    values (new.tenant_id, new.id, 'unarchived', v_actor, v_type);
  end if;
  return new;
end;
$$;

create or replace function public.clear_extraction_on_requeue()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'received' and old.status is distinct from 'received' then
    new.extraction := null;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_extraction_on_requeue() from public, anon, authenticated, service_role;

drop trigger if exists quote_requests_clear_extraction on public.quote_requests;
create trigger quote_requests_clear_extraction
  before update on public.quote_requests
  for each row execute function public.clear_extraction_on_requeue();

create or replace function public.persist_run_outcome(
  p_request_id        uuid,
  p_tenant_id         uuid,
  p_status            text,
  p_escalation_reason text,
  p_injection_flag    boolean,
  p_quote             jsonb,
  p_draft             jsonb,
  p_usage             jsonb,
  p_extraction        jsonb default null  -- the validated ExtractionResult, or null when extraction failed
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('awaiting_review', 'escalated') then
    raise exception 'persist_run_outcome: invalid status %', p_status;
  end if;

  update public.quote_requests
    set status = p_status, escalation_reason = p_escalation_reason,
        injection_flag = p_injection_flag, extraction = p_extraction
    where id = p_request_id and tenant_id = p_tenant_id and status = 'processing';

  if not found then
    return false;
  end if;

  if p_quote is not null then
    insert into public.quotes
      (request_id, tenant_id, rate_card_version, container_type, container_qty, all_in_total, breakdown_snapshot, validity_through)
    values
      (p_request_id, p_tenant_id, p_quote->>'rate_card_version', p_quote->>'container_type',
       (p_quote->>'container_qty')::int, (p_quote->>'all_in_total')::int,
       p_quote->'breakdown_snapshot', (p_quote->>'validity_through')::date)
    on conflict (request_id) do nothing;
  end if;

  if p_draft is not null then
    insert into public.drafts (request_id, tenant_id, subject, body)
    values (p_request_id, p_tenant_id, p_draft->>'subject', p_draft->>'body')
    on conflict (request_id) do nothing;
  end if;

  -- the run's usage row also carries the run's extraction: immutable per-run evidence, so a later
  -- requeue/re-run (which replaces the request's CURRENT extraction) never erases what this run read.
  insert into public.audit_log
    (tenant_id, request_id, event, model, input_tokens, output_tokens, est_cost_usd, injection_flag,
     actor_type, detail)
  values
    (p_tenant_id, p_request_id,
     case p_status when 'awaiting_review' then 'quote' else 'escalate' end,
     p_usage->>'model', (p_usage->>'input_tokens')::int, (p_usage->>'output_tokens')::int,
     (p_usage->>'est_cost_usd')::numeric, p_injection_flag,
     'system', jsonb_build_object('extraction', p_extraction));

  return true;
end;
$$;

