-- 0017 — close the function-EXECUTE hole on fresh installs (CRITICAL).
--
-- Supabase's default privileges grant EXECUTE on every new `public` function DIRECTLY to anon,
-- authenticated and service_role. Earlier migrations only ran `revoke all ... from public`, which
-- does not remove those direct grants. On a fresh database every SECURITY DEFINER worker RPC was
-- therefore callable with the browser's public anon key: persist_run_outcome (write quotes into any
-- tenant), finalize_send (forge a real send), claim_for_send (steal send leases) and
-- advance_poll_cursor (skip or replay mail). 0015 fixed this for match_knowledge only.
--
-- This migration states the full matrix explicitly and stops future functions inheriting the
-- grant. supabase/tests/hardening_function_privileges.sql is the proving test; it also fails for
-- any NEW function that is not added to its matrix.

-- 1. Future functions created by this migration role get no implicit EXECUTE for API roles.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 2. Trusted worker RPCs: service_role only.
revoke all on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_run_outcome(uuid, uuid, text, text, boolean, jsonb, jsonb, jsonb)
  to service_role;

revoke all on function public.advance_poll_cursor(uuid, text, text) from public, anon, authenticated;
grant execute on function public.advance_poll_cursor(uuid, text, text) to service_role;

revoke all on function public.claim_for_send(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_for_send(uuid, int) to service_role;

revoke all on function public.finalize_send(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.finalize_send(uuid, uuid, boolean) to service_role;

revoke all on function public.match_knowledge(vector, uuid, int) from public, anon, authenticated;
grant execute on function public.match_knowledge(vector, uuid, int) to service_role;

-- 3. Human reviewer actions: authenticated only. Not anon, and not service_role, so no worker or
--    leaked service key can approve, archive or requeue on a human's behalf.
revoke all on function public.approve_request(uuid)   from public, anon, service_role;
grant execute on function public.approve_request(uuid)   to authenticated;
revoke all on function public.archive_request(uuid)   from public, anon, service_role;
grant execute on function public.archive_request(uuid)   to authenticated;
revoke all on function public.unarchive_request(uuid) from public, anon, service_role;
grant execute on function public.unarchive_request(uuid) to authenticated;
revoke all on function public.requeue_request(uuid)   from public, anon, service_role;
grant execute on function public.requeue_request(uuid)   to authenticated;

-- 4. Trigger function: never invoked directly by any API role.
revoke all on function public.enforce_sent_via_approve() from public, anon, authenticated, service_role;
