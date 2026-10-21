-- 0019 — audit trail: attribute every request state change; persist the model's extraction.
--
-- Review gaps closed: approve/archive/requeue wrote no audit row and no actor; the extraction the
-- model produced was never stored, so a reviewer could not see what the agent read (worst on
-- escalations). A trigger records EVERY status transition and archive toggle, whichever code path
-- made it (RPC, worker, future code), with actor_id = auth.uid() (null = system/worker).

alter table public.audit_log add column if not exists actor_id uuid references auth.users(id) on delete set null;
alter table public.audit_log add column if not exists detail   jsonb;
alter table public.quote_requests add column if not exists extraction jsonb;

create or replace function public.log_request_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log (tenant_id, request_id, event, actor_id, detail)
    values (new.tenant_id, new.id, 'transition', auth.uid(),
            jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.escalation_reason));
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into public.audit_log (tenant_id, request_id, event, actor_id)
    values (new.tenant_id, new.id, 'archived', auth.uid());
  elsif old.archived_at is not null and new.archived_at is null then
    insert into public.audit_log (tenant_id, request_id, event, actor_id)
    values (new.tenant_id, new.id, 'unarchived', auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.log_request_transition() from public, anon, authenticated, service_role;

drop trigger if exists quote_requests_audit_transition on public.quote_requests;
create trigger quote_requests_audit_transition
  after update on public.quote_requests
  for each row execute function public.log_request_transition();

-- persist_run_outcome gains p_extraction (stored on the request in the same first-writer flip).
-- Body otherwise verbatim from 0015 (flip first; inserts only by the winning call).
drop function if exists public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb);

create function public.persist_run_outcome(
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

  insert into public.audit_log
    (tenant_id, request_id, event, model, input_tokens, output_tokens, est_cost_usd, injection_flag)
  values
    (p_tenant_id, p_request_id,
     case p_status when 'awaiting_review' then 'quote' else 'escalate' end,
     p_usage->>'model', (p_usage->>'input_tokens')::int, (p_usage->>'output_tokens')::int,
     (p_usage->>'est_cost_usd')::numeric, p_injection_flag);

  return true;
end;
$$;

revoke all on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb, jsonb)
  to service_role;
