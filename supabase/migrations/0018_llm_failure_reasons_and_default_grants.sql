-- 0018 — (a) escalation reasons for terminal LLM failures; (b) explicit-only function grants.
--
-- (a) A model refusal or unusable model output now escalates to a human with a named reason
--     (packages/ingest/src/run.ts) instead of being retried as an infrastructure error.
-- (b) Codex review of 0017: default privileges are per creator role. For functions created by this
--     migration role (postgres) in public, revoke the default EXECUTE from service_role too, so every
--     function's grants are explicit. supabase_admin's defaults are platform-managed and cannot be
--     altered by postgres; hardening_function_privileges.sql therefore also asserts that every
--     non-extension function in public is owned by postgres (and is in the explicit matrix).
alter table public.quote_requests
  drop constraint if exists quote_requests_reason_enum;
alter table public.quote_requests
  add constraint quote_requests_reason_enum
    check (escalation_reason is null or escalation_reason in
      ('missing_required_field','out_of_scope_lane','out_of_scope_mode','out_of_scope_container',
       'rate_expired','model_refused','model_output_invalid',
       'ambiguous_request','low_confidence','guard_violation'));

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
