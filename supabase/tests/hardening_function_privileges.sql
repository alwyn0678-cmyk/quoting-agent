-- Function-privilege lint: every function in `public` (excluding extension members) must match an
-- explicit EXECUTE matrix. Supabase's default privileges grant EXECUTE on every NEW public function
-- directly to anon + authenticated, and `revoke ... from public` does NOT remove those direct
-- grants — so a SECURITY DEFINER worker RPC would be callable with the browser's public anon key.
-- A function missing from the matrix fails this test, forcing an explicit decision for each new one.
do $$
declare
  r record;
  expected record;
  v_fail text := '';
begin
  create temp table expected_exec (fn text primary key, anon boolean, authn boolean, svc boolean) on commit drop;
  insert into expected_exec values
    -- RLS helper: evaluated inside policies for every role.
    ('auth_tenant_id',           true,  true,  true),
    -- trigger function: never called directly.
    ('enforce_sent_via_approve', false, false, false),
    ('log_request_transition',   false, false, false),
    ('clear_extraction_on_requeue', false, false, false),
    -- human reviewer actions: authenticated users only (a worker must never approve or requeue).
    ('approve_request',          false, true,  false),
    ('archive_request',          false, true,  false),
    ('unarchive_request',        false, true,  false),
    ('requeue_request',          false, true,  false),
    -- trusted worker RPCs (service_role only).
    ('persist_run_outcome',      false, false, true),
    ('advance_poll_cursor',      false, false, true),
    ('claim_for_send',           false, false, true),
    ('finalize_send',            false, false, true),
    ('match_knowledge',          false, false, true),
    ('claim_request',            false, false, true),
    ('mark_run_error',           false, false, true),
    ('get_rate_card',            false, false, true);

  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    select * into expected from expected_exec where fn = r.proname;
    if not found then
      v_fail := v_fail || format(E'\n  %s: not in the privilege matrix', r.proname);
      continue;
    end if;
    if has_function_privilege('anon', r.oid, 'EXECUTE') is distinct from expected.anon
       or has_function_privilege('authenticated', r.oid, 'EXECUTE') is distinct from expected.authn
       or has_function_privilege('service_role', r.oid, 'EXECUTE') is distinct from expected.svc then
      v_fail := v_fail || format(E'\n  %s: anon=%s authenticated=%s service_role=%s (expected %s/%s/%s)',
        r.proname,
        has_function_privilege('anon', r.oid, 'EXECUTE'),
        has_function_privilege('authenticated', r.oid, 'EXECUTE'),
        has_function_privilege('service_role', r.oid, 'EXECUTE'),
        expected.anon, expected.authn, expected.svc);
    end if;
  end loop;

  -- Every application function must be owned by postgres (the migration role whose default
  -- privileges 0017/0018 harden) — a function created by another role would inherit that role's
  -- defaults, which may grant anon/authenticated.
  for r in
    select p.proname, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and pg_get_userbyid(p.proowner) <> 'postgres'
  loop
    v_fail := v_fail || format(E'\n  %s: owned by %s (expected postgres)', r.proname, r.owner);
  end loop;

  -- postgres's default privileges in public must grant EXECUTE to no API role.
  if exists (
    select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace,
           aclexplode(d.defaclacl) a
     where d.defaclrole = 'postgres'::regrole and n.nspname = 'public' and d.defaclobjtype = 'f'
       and a.privilege_type = 'EXECUTE'
       and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
  ) then
    v_fail := v_fail || E'\n  default privileges: postgres still grants EXECUTE on new public functions to an API role';
  end if;

  if v_fail <> '' then
    raise exception 'FUNCTION-PRIVILEGES FAIL:%', v_fail;
  end if;
end $$;
select 'PASS: function privileges match the matrix' as result;
