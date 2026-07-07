-- hardening: one ACTIVE rate card per (tenant, lane, mode) (migration 0015 §7). Before the partial
-- unique index, two active cards on one key made the engine's pick (created_at DESC limit 1,
-- packages/agents/src/supabase-rate-engine.ts) a timestamp coin-flip — nondeterministic pricing.
-- Proves: a second ACTIVE card on the same (tenant_id, lane, mode) raises unique_violation;
-- a different mode on the same lane is allowed (multi-modal, 0013); an INACTIVE duplicate
-- (superseded version) is allowed (the index is partial on is_active). Runs in a txn that ROLLS BACK.

begin;

insert into public.tenants (id, name) values ('0f500000-0000-4000-8000-000000000001','Card Unique Tenant');

-- the incumbent active FCL card
insert into public.rate_cards (id, tenant_id, lane, mode, version, validity_through, is_active) values
  ('0f500000-0000-4000-8000-0000000000c1','0f500000-0000-4000-8000-000000000001',
   'NLRTM-USNYC','FCL','2026-06-v1','2026-12-31', true);

do $$
begin
  -- negative: a SECOND active card on the same (tenant, lane, mode) must violate the unique index
  begin
    insert into public.rate_cards (tenant_id, lane, mode, version, validity_through, is_active) values
      ('0f500000-0000-4000-8000-000000000001','NLRTM-USNYC','FCL','2026-07-v1','2026-12-31', true);
    raise exception 'HARDENING FAIL: two ACTIVE cards accepted for one (tenant, lane, mode) — engine pick is nondeterministic again';
  exception when unique_violation then null;  -- expected: rate_cards_one_active_per_tenant_lane_mode
  end;

  -- positive: same lane, DIFFERENT mode is a distinct key (multi-modal per 0013) — allowed
  insert into public.rate_cards (tenant_id, lane, mode, version, validity_through, is_active) values
    ('0f500000-0000-4000-8000-000000000001','NLRTM-USNYC','BARGE','2026-06-v1','2026-12-31', true);

  -- positive: an INACTIVE duplicate of the same key (a superseded version) is allowed — the index
  -- is partial on is_active, so history is unconstrained
  insert into public.rate_cards (tenant_id, lane, mode, version, validity_through, is_active) values
    ('0f500000-0000-4000-8000-000000000001','NLRTM-USNYC','FCL','2026-05-v9','2026-05-31', false);
end $$;

rollback;

select 'hardening_active_card_unique PASS — second active card on one (tenant, lane, mode) raises unique_violation; different mode on the same lane and inactive duplicates are allowed' as result;
