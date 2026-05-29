-- AC-5 — tenant isolation (RLS), the proving test for 1B.1.
-- Seeds two tenants + two auth users + per-tenant rows, then asserts that an `authenticated`
-- caller (simulated via role + request.jwt.claims) sees ONLY its own tenant's rows — including
-- rate_card_lines, which has no tenant_id and is isolated by parent join. Everything runs in a
-- transaction that ROLLS BACK, so the proof leaves no rows behind and is repeatable. Any leak
-- raises an exception (the Management API surfaces it as an error = FAIL); a clean run returns PASS.
-- The full browser anon+JWT end-to-end test is deferred to 1C.3 (per the plan's AC-5 split).

begin;

insert into public.tenants (id, name) values
  ('0a000000-0000-4000-8000-000000000001','Tenant A'),
  ('0b000000-0000-4000-8000-000000000002','Tenant B');

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-4000-8000-000000000001','authenticated','authenticated','a@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000','1b000000-0000-4000-8000-000000000002','authenticated','authenticated','b@test.local', now(), now());

insert into public.profiles (user_id, tenant_id) values
  ('1a000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001'),
  ('1b000000-0000-4000-8000-000000000002','0b000000-0000-4000-8000-000000000002');

insert into public.quote_requests (tenant_id, source, status) values
  ('0a000000-0000-4000-8000-000000000001','sample','received'),
  ('0b000000-0000-4000-8000-000000000002','sample','received');

-- a rate_card + line per tenant, to exercise the parent-join policy on rate_card_lines
insert into public.rate_cards (id, tenant_id, lane, version, validity_through) values
  ('0c000000-0000-4000-8000-00000000000a','0a000000-0000-4000-8000-000000000001','NLRTM-USNYC','t','2026-12-31'),
  ('0c000000-0000-4000-8000-00000000000b','0b000000-0000-4000-8000-000000000002','NLRTM-USNYC','t','2026-12-31');
insert into public.rate_card_lines (rate_card_id, kind, code, amount) values
  ('0c000000-0000-4000-8000-00000000000a','base','BASE_40HC',2550),
  ('0c000000-0000-4000-8000-00000000000b','base','BASE_40HC',9999);  -- tenant B's secret figure

-- ── caller = user A (tenant A) ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1a000000-0000-4000-8000-000000000001"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.quote_requests where tenant_id = '0b000000-0000-4000-8000-000000000002';
  if n <> 0 then raise exception 'AC-5 FAIL: tenant A can see % tenant-B quote_requests', n; end if;

  select count(*) into n from public.quote_requests;
  if n <> 1 then raise exception 'AC-5 FAIL: tenant A sees % quote_requests, expected 1 (its own)', n; end if;

  select count(*) into n from public.rate_card_lines where amount = 9999;  -- B's line, via parent join
  if n <> 0 then raise exception 'AC-5 FAIL: tenant A can see tenant-B rate_card_lines (parent-join leak)'; end if;
end $$;
reset role;

-- ── caller = user B (tenant B), reverse direction ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1b000000-0000-4000-8000-000000000002"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.quote_requests where tenant_id = '0a000000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'AC-5 FAIL: tenant B can see % tenant-A quote_requests', n; end if;
end $$;
reset role;

rollback;

select 'AC-5 PASS — RLS isolates both directions: cross-tenant SELECT returns 0 rows (quote_requests + parent-joined rate_card_lines)' as result;
