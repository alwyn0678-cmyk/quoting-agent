-- 0006 — Phase 1C audit (codex Gate-4). Two hardenings to the approve gate:
--
-- P1: "sent only via approve_request" was only true for `authenticated` (no DML grant). service_role
--     bypasses RLS and holds DML, so it could set status='sent' directly. Make it a DB invariant for
--     ALL roles: a BEFORE UPDATE trigger blocks any transition INTO 'sent' unless a one-shot
--     transaction flag is set — and ONLY approve_request() sets it. This also enforces the HITL rule
--     that the autonomous run (1C.2, service_role) can never auto-send.
--
-- P2: approve_request flipped the request to 'sent' before ensuring a draft existed, so a request
--     could reach 'sent' with no simulated_sent_at. Now it stamps the draft of an approvable request
--     FIRST (own tenant + awaiting_review + has a draft) and refuses otherwise, then flips the request.
-- Append-only; idempotent.

create or replace function public.enforce_sent_via_approve()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    if current_setting('quoteagent.allow_sent', true) is distinct from 'on' then
      raise exception 'quote_requests.status -> sent is only allowed via approve_request()'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_sent_via_approve on public.quote_requests;
create trigger trg_enforce_sent_via_approve
  before update on public.quote_requests
  for each row execute function public.enforce_sent_via_approve();

create or replace function public.approve_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  uuid := public.auth_tenant_id();
  v_request uuid;
begin
  if v_tenant is null then
    raise exception 'approve_request: caller has no tenant' using errcode = 'check_violation';
  end if;

  -- Stamp the draft of an approvable request (own tenant + awaiting_review + has a draft). This
  -- guarantees there is something to "send" (so simulated_sent_at is always set) and, in one shot,
  -- refuses cross-tenant / wrong-state / draftless requests (P-APPROVE-AUTH, AC-6).
  update public.drafts d
     set simulated_sent_at = now(), status = 'sent'
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

  -- Flip the request to 'sent'. The trigger above permits this ONLY while the one-shot flag is set,
  -- so 'sent' is unreachable by any other path or role. Set → update → reset, all within this call.
  perform set_config('quoteagent.allow_sent', 'on', true);
  update public.quote_requests
     set status = 'sent'
   where id = p_request_id and tenant_id = v_tenant and status = 'awaiting_review';
  perform set_config('quoteagent.allow_sent', 'off', true);

  return v_request;
end;
$$;

revoke all on function public.approve_request(uuid) from public;
grant execute on function public.approve_request(uuid) to authenticated;
