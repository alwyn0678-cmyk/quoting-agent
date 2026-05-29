-- 0003 (Phase 1B codex Gate-4): least-privilege grants + sort_order backfill. Append-only fix to 0001/0002.
--
-- P1/P2: 0001 granted blanket INSERT/UPDATE/DELETE on all public tables to `authenticated`. Combined
-- with profiles' own RLS, a browser user could repoint their `profiles.tenant_id` at another tenant
-- (auth_tenant_id() TRUSTS profiles) -> AC-5 escalation; and could mutate the "immutable" quote
-- snapshot via PostgREST. The browser (anon/authenticated) is READ-ONLY in 1B; profiles is never
-- writable by `authenticated`. The 1C paste/approve writes get narrow, per-operation grants then.
revoke insert, update, delete on all tables in schema public from authenticated;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (user_id = auth.uid());

-- P2: 0002 added sort_order DEFAULT 0; rows seeded BEFORE 0002 would order wrong until re-seeded.
-- The seed is authoritative + idempotent, but backfill the known Linkport lines so the migrate path
-- is robust regardless of seed timing.
update public.rate_card_lines set sort_order = case code
    when 'BASE_20GP' then 0 when 'BASE_40GP' then 1 when 'BASE_40HC' then 2
    when 'BAF' then 0 when 'THC_RTM' then 1 when 'THC_NYC' then 2 when 'ISPS' then 3
    when 'DOC' then 0 when 'EXPORT_CUSTOMS' then 1 else sort_order end
  where rate_card_id = '22222222-2222-4222-8222-222222222222';
