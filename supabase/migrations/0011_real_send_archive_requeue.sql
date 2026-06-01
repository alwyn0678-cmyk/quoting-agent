-- 0011 — Real send on Approve + Archive + Re-run (escalations).
-- REVERSES D-14's "simulated send only" (see DECISION_LOG D-27): Approve now triggers a REAL Graph
-- send (Mail.Send), wired in the web Approve action; the DB records the real send via drafts.sent_at
-- (distinct from the legacy simulated_sent_at). The HITL gate is unchanged — only a human Approve can
-- reach 'sent' (enforce_sent_via_approve trigger, migration 0006); the autonomous run still never sends.
-- Adds:
--   * drafts.sent_at              — set when Approve performed a REAL Graph send (p_sent=true).
--   * quote_requests.archived_at  — soft-archive for terminal requests (sent / escalated / error).
--   * approve_request(uuid,bool)  — the 0006 gate, plus stamps sent_at when p_sent (real send done).
--   * archive_request / unarchive_request — soft-archive toggle (terminal requests only).
--   * requeue_request             — escalated|error -> received (clears the prior outcome) so the
--                                   autonomous poll re-enqueues it (W5) and the agent re-runs it.
-- Every RPC is SECURITY DEFINER + tenant-scoped via auth_tenant_id() (P-APPROVE-AUTH), EXECUTE to
-- `authenticated` ONLY (never service_role — these are human-only HITL controls). Append-only; idempotent.

alter table public.drafts          add column if not exists sent_at     timestamptz;
alter table public.quote_requests  add column if not exists archived_at timestamptz;

-- approve_request gains p_sent: the web action passes true only after a successful real Graph send,
-- so sent_at means "a real email went out" while simulated_sent_at stays the approval timestamp.
drop function if exists public.approve_request(uuid);
create or replace function public.approve_request(p_request_id uuid, p_sent boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tenant  uuid := public.auth_tenant_id();
  v_request uuid;
begin
  if v_tenant is null then
    raise exception 'approve_request: caller has no tenant' using errcode = 'check_violation';
  end if;

  -- Stamp the draft of an approvable request (own tenant + awaiting_review + has a draft); record the
  -- real send time only when p_sent. One shot also refuses cross-tenant / wrong-state / draftless.
  update public.drafts d
     set simulated_sent_at = now(),
         sent_at = case when p_sent then now() else d.sent_at end,
         status  = 'sent'
    from public.quote_requests q
   where d.request_id = p_request_id
     and d.tenant_id  = v_tenant
     and q.id = d.request_id
     and q.tenant_id = v_tenant
     and q.status = 'awaiting_review'
  returning d.request_id into v_request;

  if not found then
    raise exception 'approve_request: % is not approvable by caller (wrong tenant, not awaiting_review, or no draft)', p_request_id
      using errcode = 'check_violation';
  end if;

  perform set_config('quoteagent.allow_sent', 'on', true);
  update public.quote_requests
     set status = 'sent'
   where id = p_request_id and tenant_id = v_tenant and status = 'awaiting_review';
  perform set_config('quoteagent.allow_sent', 'off', true);

  return v_request;
end;
$$;
revoke all on function public.approve_request(uuid, boolean) from public;
grant execute on function public.approve_request(uuid, boolean) to authenticated;

-- Soft-archive a terminal request (sent / escalated / error). Tenant-scoped; refuses otherwise.
create or replace function public.archive_request(p_request_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'archive_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set archived_at = now()
   where id = p_request_id and tenant_id = v_tenant
     and archived_at is null
     and status in ('sent','escalated','error')
  returning id into v_id;
  if not found then
    raise exception 'archive_request: % not archivable (wrong tenant, already archived, or not terminal)', p_request_id
      using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;
revoke all on function public.archive_request(uuid) from public;
grant execute on function public.archive_request(uuid) to authenticated;

create or replace function public.unarchive_request(p_request_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'unarchive_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set archived_at = null
   where id = p_request_id and tenant_id = v_tenant and archived_at is not null
  returning id into v_id;
  if not found then
    raise exception 'unarchive_request: % not un-archivable (wrong tenant or not archived)', p_request_id
      using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;
revoke all on function public.unarchive_request(uuid) from public;
grant execute on function public.unarchive_request(uuid) to authenticated;

-- Re-run an escalated|error request: reset to 'received', clear the prior outcome + archive flag, and
-- drop any prior quote/draft so the agent re-runs fresh. The autonomous poll re-enqueues 'received'
-- (W5) and runRequestTask re-processes it — "the agent re-runs it". Never touches 'sent' (no resend).
create or replace function public.requeue_request(p_request_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'requeue_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set status = 'received', escalation_reason = null, injection_flag = false, archived_at = null
   where id = p_request_id and tenant_id = v_tenant
     and status in ('escalated','error')
  returning id into v_id;
  if not found then
    raise exception 'requeue_request: % not re-runnable (wrong tenant or not escalated/error)', p_request_id
      using errcode = 'check_violation';
  end if;
  delete from public.quotes where request_id = p_request_id and tenant_id = v_tenant;
  delete from public.drafts where request_id = p_request_id and tenant_id = v_tenant;
  return v_id;
end;
$$;
revoke all on function public.requeue_request(uuid) from public;
grant execute on function public.requeue_request(uuid) to authenticated;
