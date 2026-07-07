-- 0015 — audit hardening: seven defects found in the 0001-0014 security audit, each closed as an
-- append-only fix in its own section below. Nothing here changes intended behavior — every section
-- makes the DB enforce an invariant the earlier migrations only ASSUMED (a default privilege, a
-- write ordering, a trigger event, an expression, a uniqueness). Idempotent; safe to re-run.
--
--   1  poll_state + knowledge_chunks writable by browser roles (hosted default privileges)   HIGH
--   2  match_knowledge never revoked from PUBLIC                                             MEDIUM
--   3  persist_run_outcome inserts BEFORE the first-writer flip → orphan quote/draft         HIGH
--   4  enforce-sent trigger is UPDATE-only → INSERT born-'sent' bypasses the gate            MEDIUM
--   5  claim_for_send returns drafts.body, dropping the reviewer's edited_body               MEDIUM
--   6  requeue_request leaves a stale send_claimed_at lease → re-approved row never sends    LOW
--   7  nothing prevents two ACTIVE rate cards per (tenant, lane, mode) → engine picks one    MEDIUM
--      nondeterministically (created_at DESC)

-- ── 1. Close the browser-writable post-0003 tables (HIGH) ────────────────────────────────────────
-- 0003 revoked INSERT/UPDATE/DELETE from `authenticated` on all tables THAT EXISTED THEN. But hosted
-- Supabase's default privileges grant ALL on every NEW public table to anon/authenticated — so
-- poll_state (0007) and knowledge_chunks (0010) were re-opened at creation, despite 0010's comment
-- claiming the browser "gets NO grants here". A signed-in tenant user could therefore POISON the RAG
-- corpus (knowledge_chunks content is fed to the draft prompt — a prompt-injection channel) or move
-- poll_state.cursor (skipping / re-processing inbound mail). Every consumer of both tables runs as
-- service_role (packages/ingest/src/supabase-store.ts, packages/agents/src/knowledge-retriever.ts,
-- scripts/index_knowledge.ts); the dashboard reads NEITHER — so the browser roles need nothing at
-- all, including the SELECT 0007 granted. RLS + the tenant policies stay on (defense-in-depth, D-15).
revoke all on table public.poll_state       from anon, authenticated;
revoke all on table public.knowledge_chunks from anon, authenticated;

-- ── 2. match_knowledge: revoke PUBLIC EXECUTE (MEDIUM) ───────────────────────────────────────────
-- Every other function in the repo is `revoke all ... from public` + narrow grant; 0010 granted
-- match_knowledge to service_role but never revoked PUBLIC — and Postgres grants EXECUTE on new
-- functions to PUBLIC by default, so any authenticated caller could run tenant-filtered similarity
-- search over the corpus. Revoke PUBLIC — and, belt-and-braces, anon/authenticated too, since hosted
-- default privileges can also grant new FUNCTIONS to those roles directly (same mechanism as §1's
-- tables), and a role-specific grant survives a PUBLIC-only revoke. Re-assert the service_role
-- grant (idempotent).
revoke all on function public.match_knowledge(vector, uuid, int) from public, anon, authenticated;
grant execute on function public.match_knowledge(vector, uuid, int) to service_role;

-- ── 3. persist_run_outcome: flip FIRST, then insert (HIGH) ───────────────────────────────────────
-- In 0009 the quote/draft INSERTs ran BEFORE the first-writer status flip. A divergent retry that
-- LOSES the flip (first run escalated; the nondeterministic retry produced a quote) had already
-- committed its quote + draft — an orphan pair attached to an 'escalated' request, which the reviewer
-- UI then renders as if it were a real outcome. Reorder: win the flip first; every insert is gated on
-- having won. Signature, return semantics (true iff THIS call transitioned), SECURITY DEFINER,
-- search_path pinning, and the insert-once bodies are verbatim from 0009. advance_poll_cursor
-- (0009's other half, the monotonic cursor) is untouched.
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
begin
  if p_status not in ('awaiting_review', 'escalated') then
    raise exception 'persist_run_outcome: invalid status %', p_status;
  end if;

  -- FLIP FIRST (the 0015 reorder): first-writer-wins — only a row still 'processing' for THIS
  -- tenant transitions. A losing divergent retry stops HERE, before any insert, so it can no
  -- longer attach an orphan quote/draft to an already-terminal (e.g. escalated) request.
  update public.quote_requests
    set status = p_status, escalation_reason = p_escalation_reason, injection_flag = p_injection_flag
    where id = p_request_id and tenant_id = p_tenant_id and status = 'processing';

  if not found then
    return false;  -- retry-after-success / lost race: clean no-op, NOTHING written
  end if;

  -- insert-once quote (a retry never overwrites the immutable snapshot — AC-4 / P-1C.2),
  -- now reachable ONLY by the call that won the flip
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

  -- usage logged atomically with (and only on) the winning transition → exactly one row per run,
  -- no "terminal request with no audit row" gap, even if the worker crashes right after.
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

revoke all on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb) from public;
grant execute on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb) to service_role;

-- ── 4. Close the 'sent' INSERT bypass (MEDIUM) ───────────────────────────────────────────────────
-- 0006's gate was BEFORE UPDATE only, so `insert ... status = 'sent'` (any role with INSERT — e.g.
-- service_role, which bypasses RLS) skipped the trigger entirely and minted a 'sent' request that
-- never passed the HITL approve → finalize path. Handle TG_OP = 'INSERT' (a row BORN 'sent' is
-- always a transition into 'sent'; there is no OLD row to consult — and OLD must not be referenced
-- on INSERT) and fire on BEFORE INSERT OR UPDATE. The one-shot GUC escape hatch is unchanged:
-- 'sent' remains reachable only inside finalize_send's set_config('quoteagent.allow_sent','on',true)
-- … set_config(…,'off',true) window (0011; approve_request only claims to 'sending').
create or replace function public.enforce_sent_via_approve()
returns trigger
language plpgsql
as $$
declare
  v_into_sent boolean := false;
begin
  if new.status = 'sent' then
    if tg_op = 'INSERT' then
      v_into_sent := true;
    elsif old.status is distinct from 'sent' then
      v_into_sent := true;
    end if;
  end if;
  if v_into_sent and current_setting('quoteagent.allow_sent', true) is distinct from 'on' then
    raise exception 'quote_requests.status -> sent is only allowed via approve_request()'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_sent_via_approve on public.quote_requests;
create trigger trg_enforce_sent_via_approve
  before insert or update on public.quote_requests
  for each row execute function public.enforce_sent_via_approve();

-- ── 5. claim_for_send: honor the reviewer's edit (MEDIUM) ────────────────────────────────────────
-- 0001 created drafts.edited_body precisely so a human reviewer can correct the model's draft before
-- approving — but 0011's claim_for_send returned d.body unconditionally, silently sending the
-- UN-edited draft. One-expression change: coalesce(d.edited_body, d.body). Everything else
-- (lease semantics, FOR UPDATE SKIP LOCKED claim, tenant scoping, grants) is verbatim from 0011.
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
  -- the reviewer's correction (edited_body) wins over the model draft (0015 fix)
  select c.id, c.from_email, d.subject, coalesce(d.edited_body, d.body)
    from claimed c
    join public.drafts d on d.request_id = c.id and d.tenant_id = p_tenant_id;
end; $$;
revoke all on function public.claim_for_send(uuid, int) from public;
grant execute on function public.claim_for_send(uuid, int) to service_role;

-- ── 6. requeue_request: clear the stale send lease (LOW) ─────────────────────────────────────────
-- 0011's requeue cleared escalation_reason / injection_flag / archived_at but NOT send_claimed_at.
-- A request that was once claimed for send and later reconciled to escalated/error would, after
-- requeue → re-run → re-approve, sit in 'sending' with a stale lease forever: claim_for_send only
-- picks rows where send_claimed_at IS NULL, and the lease is deliberately never auto-reclaimed
-- (0011's at-most-once crash rule — which stays intact; this only resets the lease on the explicit
-- human re-run path, where the prior outcome is being discarded anyway). Verbatim from 0011 plus
-- `send_claimed_at = null`.
create or replace function public.requeue_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.auth_tenant_id(); v_id uuid;
begin
  if v_tenant is null then
    raise exception 'requeue_request: caller has no tenant' using errcode = 'check_violation';
  end if;
  update public.quote_requests
     set status = 'received', escalation_reason = null, injection_flag = false, archived_at = null,
         send_claimed_at = null
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

-- ── 7. One ACTIVE rate card per (tenant, lane, mode) (MEDIUM) ────────────────────────────────────
-- The engine resolves the card as (tenant_id, mode, lane, is_active) ordered created_at DESC limit 1
-- (packages/agents/src/supabase-rate-engine.ts). Nothing prevented two active cards on the same key,
-- so which card priced a quote depended on a timestamp tie-breaker — nondeterministic pricing.
-- rate_cards.mode is 0013's `mode text not null default 'FCL'`; the lane is 0001's rate_cards.lane.
-- First DEACTIVATE any existing duplicates, keeping the newest created_at per key (id DESC as a
-- deterministic tie-break — the engine's own preference order), THEN enforce uniqueness with a
-- partial unique index so it can never recur. Inactive duplicates (superseded versions) stay legal.
with ranked as (
  select id,
         row_number() over (partition by tenant_id, lane, mode
                            order by created_at desc, id desc) as rn
    from public.rate_cards
   where is_active
)
update public.rate_cards rc
   set is_active = false
  from ranked
 where rc.id = ranked.id
   and ranked.rn > 1;

create unique index if not exists rate_cards_one_active_per_tenant_lane_mode
  on public.rate_cards (tenant_id, lane, mode)
  where is_active;
