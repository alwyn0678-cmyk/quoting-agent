-- 0011 — Real send on Approve (OUTBOX) + Archive + Re-run (escalations).
-- D-27 reverses D-14 (simulated-only): Approve now causes a REAL Graph send — but NOT from the thin
-- browser-authenticated dashboard (which holds no secrets and whose caller can't be trusted to assert
-- "a real email went out"). Instead:
--   1. APPROVE (human, authenticated) atomically CLAIMS awaiting_review -> 'sending' — exactly-once,
--      tenant-scoped. It neither sends nor reaches 'sent'.
--   2. A TRUSTED worker (service_role + Graph, scripts/send_outbox.ts) sends the reply, then calls
--      finalize_send: 'sending' -> 'sent' + stamps the REAL drafts.sent_at (success), or 'sending' ->
--      'awaiting_review' (failure, so a human can retry). finalize_send is service_role ONLY, so the
--      "real send" record is NON-FORGEABLE by a reviewer (codex Gate-4 P1) and the send is EXACTLY-ONCE
--      (the claim — no double-send, codex Gate-4 P1).
-- 'sent' stays reachable ONLY via finalize_send (the enforce_sent_via_approve trigger gate, 0006),
-- which needs a 'sending' row that only a human approve_request can create — HITL preserved (AC-6).
-- Adds: status 'sending'; drafts.sent_at (real send time, set only by finalize_send);
-- quote_requests.archived_at; approve_request(uuid); finalize_send(uuid,uuid,bool);
-- archive/unarchive/requeue. All authenticated RPCs are SECURITY DEFINER + tenant-scoped via
-- auth_tenant_id() (P-APPROVE-AUTH), EXECUTE to authenticated only. Append-only; idempotent.

alter table public.quote_requests drop constraint if exists quote_requests_status_check;
alter table public.quote_requests
  add constraint quote_requests_status_check
  check (status in ('received','processing','awaiting_review','sending','escalated','sent','error'));

alter table public.drafts          add column if not exists sent_at         timestamptz;
alter table public.quote_requests  add column if not exists archived_at     timestamptz;
-- Send lease: a worker that has CLAIMED a 'sending' row stamps this so no second worker re-sends it
-- (exactly-once under concurrency, codex Gate-4 R2 P1). It is NEVER auto-reclaimed: a crash after the
-- Graph send leaves the row claimed-'sending' for manual reconciliation rather than risking a re-send
-- (at-most-once on crash — the safe direction for an external, non-idempotent send).
alter table public.quote_requests  add column if not exists send_claimed_at timestamptz;

-- HITL claim: a human moves an approvable request awaiting_review -> 'sending'. Exactly-once (one
-- concurrent approve wins; the rest match nothing -> no double-send). Refuses cross-tenant / wrong-
-- state / draftless in one shot. Does NOT send and does NOT reach 'sent'.
drop function if exists public.approve_request(uuid);
drop function if exists public.approve_request(uuid, boolean);
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
  returning q.id into v_id;
  if not found then
    raise exception 'approve_request: % is not approvable by caller (wrong tenant, not awaiting_review, or no draft)', p_request_id
      using errcode = 'check_violation';
  end if;
  return v_id;
end; $$;
revoke all on function public.approve_request(uuid) from public;
grant execute on function public.approve_request(uuid) to authenticated;

-- Trusted finalize (service_role ONLY — non-forgeable by reviewers). Tenant-scoped (P-TENANT: the
-- worker bypasses RLS, so scope explicitly). Success: 'sending' -> 'sent' (through the one-shot trigger
-- gate) + stamp the REAL drafts.sent_at. Failure: 'sending' -> 'awaiting_review' (human retry).
-- Idempotent: a row not in 'sending' matches nothing -> returns null (a retried finalize is a no-op).
create or replace function public.finalize_send(p_request_id uuid, p_tenant_id uuid, p_ok boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_ok then
    update public.drafts d
       set sent_at = now(), status = 'sent'
      from public.quote_requests q
     where d.request_id = p_request_id and d.tenant_id = p_tenant_id
       and q.id = p_request_id and q.tenant_id = p_tenant_id and q.status = 'sending';
    perform set_config('quoteagent.allow_sent', 'on', true);
    update public.quote_requests
       set status = 'sent'
     where id = p_request_id and tenant_id = p_tenant_id and status = 'sending'
    returning id into v_id;
    perform set_config('quoteagent.allow_sent', 'off', true);
  else
    -- Definite pre-send failure (e.g. unparseable recipient): return to awaiting_review for human
    -- retry and clear the lease. The worker only calls this for failures that provably did NOT send.
    update public.quote_requests
       set status = 'awaiting_review', send_claimed_at = null
     where id = p_request_id and tenant_id = p_tenant_id and status = 'sending'
    returning id into v_id;
  end if;
  return v_id;
end; $$;
revoke all on function public.finalize_send(uuid, uuid, boolean) from public;
grant execute on function public.finalize_send(uuid, uuid, boolean) to service_role;

-- Atomic claim for the send-outbox worker (service_role ONLY). Moves a batch of UNCLAIMED 'sending'
-- rows under a lease (send_claimed_at) and returns them joined to their draft, so exactly one worker
-- ever sends a given row (FOR UPDATE SKIP LOCKED + the send_claimed_at IS NULL guard). Tenant-scoped.
create or replace function public.claim_for_send(p_tenant_id uuid, p_limit int default 50)
returns table(request_id uuid, from_email text, subject text, body text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select q.id
      from public.quote_requests q
     where q.tenant_id = p_tenant_id and q.status = 'sending' and q.send_claimed_at is null
     order by q.created_at
     for update skip locked
     limit p_limit
  ),
  claimed as (
    update public.quote_requests q
       set send_claimed_at = now()
      from picked
     where q.id = picked.id
    returning q.id, q.from_email
  )
  select c.id, c.from_email, d.subject, d.body
    from claimed c
    join public.drafts d on d.request_id = c.id and d.tenant_id = p_tenant_id;
end; $$;
revoke all on function public.claim_for_send(uuid, int) from public;
grant execute on function public.claim_for_send(uuid, int) to service_role;

-- Soft-archive a terminal request (sent / escalated / error). Tenant-scoped; refuses otherwise.
create or replace function public.archive_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'archive_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set archived_at = now()
   where id = p_request_id and tenant_id = v_tenant
     and archived_at is null and status in ('sent','escalated','error')
  returning id into v_id;
  if not found then
    raise exception 'archive_request: % not archivable (wrong tenant, already archived, or not terminal)', p_request_id
      using errcode = 'check_violation';
  end if;
  return v_id;
end; $$;
revoke all on function public.archive_request(uuid) from public;
grant execute on function public.archive_request(uuid) to authenticated;

create or replace function public.unarchive_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
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
end; $$;
revoke all on function public.unarchive_request(uuid) from public;
grant execute on function public.unarchive_request(uuid) to authenticated;

-- Re-run an escalated|error request: reset to 'received', clear the prior outcome + archive flag, and
-- drop any prior quote/draft so the agent re-runs fresh. The autonomous poll re-enqueues 'received'
-- (W5) and runRequestTask re-processes it. Never touches 'sent'/'sending' (no resend path).
create or replace function public.requeue_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'requeue_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set status = 'received', escalation_reason = null, injection_flag = false, archived_at = null
   where id = p_request_id and tenant_id = v_tenant and status in ('escalated','error')
  returning id into v_id;
  if not found then
    raise exception 'requeue_request: % not re-runnable (wrong tenant or not escalated/error)', p_request_id
      using errcode = 'check_violation';
  end if;
  delete from public.quotes where request_id = p_request_id and tenant_id = v_tenant;
  delete from public.drafts where request_id = p_request_id and tenant_id = v_tenant;
  return v_id;
end; $$;
revoke all on function public.requeue_request(uuid) from public;
grant execute on function public.requeue_request(uuid) to authenticated;
