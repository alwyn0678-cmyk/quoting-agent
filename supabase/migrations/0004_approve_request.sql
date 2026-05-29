-- 0004 — Phase 1C.4: the approve → simulated-send transition, as the "narrow per-operation write"
-- that 0003 promised. `authenticated` has NO direct DML (0003 revoked INSERT/UPDATE/DELETE), so the
-- ONLY browser path that can move a request to 'sent' is this SECURITY DEFINER function. It enforces,
-- in one transaction:
--   (a) the caller's tenant — v_tenant = auth_tenant_id() (the caller's JWT), and every write is
--       scoped to it, so a reviewer cannot approve another tenant's request (P-APPROVE-AUTH). RLS is
--       bypassed under definer rights, so — exactly like the autonomous path (P-TENANT) — the tenant
--       scoping is done explicitly in the WHERE, not left to RLS.
--   (b) the state machine — only awaiting_review → sent; anything else refuses (no silent no-op).
-- There is NO Graph send anywhere (R1 / AC-7): the "send" is simulated by stamping
-- drafts.simulated_sent_at. EXECUTE is granted to `authenticated` only — NOT service_role, so the
-- autonomous path structurally cannot auto-approve (approve is a human-only HITL gate). Append-only.

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

  update public.quote_requests
     set status = 'sent'
   where id = p_request_id
     and tenant_id = v_tenant
     and status = 'awaiting_review'
  returning id into v_request;

  if not found then
    -- wrong tenant, not found, or not in awaiting_review → refuse loudly (no silent no-op)
    raise exception 'approve_request: % is not approvable by caller (wrong tenant or not awaiting_review)', p_request_id
      using errcode = 'check_violation';
  end if;

  update public.drafts
     set simulated_sent_at = now(),
         status = 'sent'
   where request_id = p_request_id
     and tenant_id = v_tenant;

  return v_request;
end;
$$;

revoke all on function public.approve_request(uuid) from public;
grant execute on function public.approve_request(uuid) to authenticated;
