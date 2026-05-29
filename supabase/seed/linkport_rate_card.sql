-- Seed (1B.2): Linkport Forwarders BV + its active NLRTM-USNYC rate card, as rows.
-- Mirrors the Phase 0 StaticCard (packages/agents/src/rate-card.ts) / ASSUMPTIONS A1-A9. Every
-- amount is an INVENTED assumption, not a real freight rate. Idempotent: fixed UUIDs + the card's
-- lines are replaced on re-run. base lines carry container_type; surcharges/fees are container-agnostic.

insert into public.tenants (id, name)
values ('11111111-1111-4111-8111-111111111111', 'Linkport Forwarders BV')
on conflict (id) do update set name = excluded.name;

insert into public.rate_cards (id, tenant_id, lane, version, validity_through, is_active)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'NLRTM-USNYC', '2026-06-v1', '2026-06-30', true)
on conflict (id) do update
  set lane = excluded.lane, version = excluded.version,
      validity_through = excluded.validity_through, is_active = excluded.is_active;

delete from public.rate_card_lines where rate_card_id = '22222222-2222-4222-8222-222222222222';
insert into public.rate_card_lines (rate_card_id, kind, code, container_type, amount) values
  ('22222222-2222-4222-8222-222222222222', 'base', 'BASE_20GP', '20GP', 1800),  -- A1
  ('22222222-2222-4222-8222-222222222222', 'base', 'BASE_40GP', '40GP', 2400),  -- A2
  ('22222222-2222-4222-8222-222222222222', 'base', 'BASE_40HC', '40HC', 2550),  -- A3
  ('22222222-2222-4222-8222-222222222222', 'surcharge_per_container', 'BAF',     null, 320),  -- A4
  ('22222222-2222-4222-8222-222222222222', 'surcharge_per_container', 'THC_RTM', null, 225),  -- A5
  ('22222222-2222-4222-8222-222222222222', 'surcharge_per_container', 'THC_NYC', null, 290),  -- A6
  ('22222222-2222-4222-8222-222222222222', 'surcharge_per_container', 'ISPS',    null,  25),  -- A7
  ('22222222-2222-4222-8222-222222222222', 'per_shipment_fee', 'DOC',            null,  65),  -- A8
  ('22222222-2222-4222-8222-222222222222', 'per_shipment_fee', 'EXPORT_CUSTOMS', null,  45);  -- A9

select 'seeded Linkport card 2026-06-v1: ' || count(*)::text || ' lines' as result
from public.rate_card_lines where rate_card_id = '22222222-2222-4222-8222-222222222222';
