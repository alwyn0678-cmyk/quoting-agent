-- 0009 — codex Gate-4 (1C live) P1-b + P2-d: make the durable run's persistence atomic, and the
-- poll cursor DB-monotonic. Both run as service_role (autonomous path); EXECUTE is granted to
-- service_role only (the browser never calls them). SECURITY DEFINER + pinned search_path; tenant
-- scoping stays INSIDE each function (every write carries / filters tenant_id — P-TENANT).

-- ── P1-b: one transaction for the whole run outcome ──────────────────────────────────────────────
-- The TS run previously did 4 separate calls (saveQuote, saveDraft, complete, logUsage). A crash
-- BETWEEN them left partial state: a status flip without a usage row, or (with a nondeterministic
-- retry) an orphan quote/draft under an escalated status. This RPC does it ALL in one txn:
--   insert-once quote + draft (immutable snapshot, AC-4) → first-writer status flip (processing→terminal)
--   → audit row logged EXACTLY when (and only when) this call wins the flip.
-- Returns true iff THIS call transitioned the request (so a retry-after-success is a clean no-op).
create or replace function public.persist_run_outcome(
  p_request_id       uuid,
  p_tenant_id        uuid,
  p_status           text,    -- 'awaiting_review' (quote) | 'escalated'
  p_escalation_reason text,   -- null on the quote path
  p_injection_flag   boolean,
  p_quote            jsonb,   -- quoteToRow(...) shape, or null on escalate
  p_draft            jsonb,   -- { subject, body }, or null on escalate
  p_usage            jsonb    -- { model, input_tokens, output_tokens, est_cost_usd }
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transitioned boolean := false;
begin
  if p_status not in ('awaiting_review', 'escalated') then
    raise exception 'persist_run_outcome: invalid status %', p_status;
  end if;

  -- insert-once quote (a retry never overwrites the immutable snapshot — AC-4 / P-1C.2)
  if p_quote is not null then
    insert into public.quotes
      (request_id, tenant_id, rate_card_version, container_type, container_qty, all_in_total, breakdown_snapshot, validity_through)
    values
      (p_request_id, p_tenant_id, p_quote->>'rate_card_version', p_quote->>'container_type',
       (p_quote->>'container_qty')::int, (p_quote->>'all_in_total')::int,
       p_quote->'breakdown_snapshot', (p_quote->>'validity_through')::date)
    on conflict (request_id) do nothing;
  end if;

  -- insert-once draft
  if p_draft is not null then
    insert into public.drafts (request_id, tenant_id, subject, body)
    values (p_request_id, p_tenant_id, p_draft->>'subject', p_draft->>'body')
    on conflict (request_id) do nothing;
  end if;

  -- first-writer-wins status flip: only a row still 'processing' for THIS tenant transitions
  update public.quote_requests
    set status = p_status, escalation_reason = p_escalation_reason, injection_flag = p_injection_flag
    where id = p_request_id and tenant_id = p_tenant_id and status = 'processing';

  if found then
    v_transitioned := true;
    -- usage logged atomically with (and only on) the winning transition → exactly one row per run,
    -- no "terminal request with no audit row" gap, even if the worker crashes right after.
    insert into public.audit_log
      (tenant_id, request_id, event, model, input_tokens, output_tokens, est_cost_usd, injection_flag)
    values
      (p_tenant_id, p_request_id,
       case p_status when 'awaiting_review' then 'quote' else 'escalate' end,
       p_usage->>'model', (p_usage->>'input_tokens')::int, (p_usage->>'output_tokens')::int,
       (p_usage->>'est_cost_usd')::numeric, p_injection_flag);
  end if;

  return v_transitioned;
end;
$$;

revoke all on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb) from public;
grant execute on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb) to service_role;

-- ── P2-d: DB-monotonic cursor advance ────────────────────────────────────────────────────────────
-- setCursor previously upserted unconditionally; overlapping poll runs could write an older cursor
-- after a newer one and regress poll_state.cursor (re-processing mail). ISO-8601 sorts lexicographically
-- = chronologically, so greatest(text, text) is a time-max: the cursor can only ever move forward.
create or replace function public.advance_poll_cursor(
  p_tenant_id uuid,
  p_mailbox   text,
  p_cursor    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.poll_state (tenant_id, mailbox, cursor, updated_at)
  values (p_tenant_id, p_mailbox, p_cursor, now())
  on conflict (tenant_id, mailbox)
  do update set cursor = greatest(public.poll_state.cursor, excluded.cursor), updated_at = now();
end;
$$;

revoke all on function public.advance_poll_cursor(uuid, text, text) from public;
grant execute on function public.advance_poll_cursor(uuid, text, text) to service_role;
