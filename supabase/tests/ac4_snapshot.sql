-- AC-4 — quote reproducibility (D-16). A persisted quote carries its own breakdown_snapshot +
-- rate_card_version; editing/superseding the rate card must NOT change an existing quote. Runs in a
-- txn that ROLLs BACK (no pollution; the card edit is discarded). Uses the seeded Linkport card.
begin;

-- a request + a quote priced on the CURRENT card (40HC x2 = 6930)
insert into public.quote_requests (id, tenant_id, source, status)
values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'sample', 'awaiting_review');

insert into public.quotes
  (request_id, tenant_id, rate_card_version, container_type, container_qty, all_in_total, breakdown_snapshot, validity_through)
values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
   '2026-06-v1', '40HC', 2, 6930,
   '{"all_in_total":6930,"rate_card_version":"2026-06-v1","container_type":"40HC","container_qty":2}'::jsonb,
   '2026-06-30');

-- SUPERSEDE the card: bump a surcharge and the version (what a rate update would do)
update public.rate_card_lines set amount = 999
  where rate_card_id = '22222222-2222-4222-8222-222222222222' and code = 'BAF';
update public.rate_cards set version = '2026-07-v1'
  where id = '22222222-2222-4222-8222-222222222222';

do $$
declare
  v_total int; v_ver text; v_snap_total int;
  v_base int; v_surch int; v_fees int; v_fresh int;
begin
  -- sanity: a FRESH price off the edited card now differs (proves the edit took effect)
  select amount into v_base from public.rate_card_lines
    where rate_card_id='22222222-2222-4222-8222-222222222222' and kind='base' and container_type='40HC';
  select coalesce(sum(amount),0) into v_surch from public.rate_card_lines
    where rate_card_id='22222222-2222-4222-8222-222222222222' and kind='surcharge_per_container';
  select coalesce(sum(amount),0) into v_fees from public.rate_card_lines
    where rate_card_id='22222222-2222-4222-8222-222222222222' and kind='per_shipment_fee';
  v_fresh := 2*(v_base+v_surch)+v_fees;
  if v_fresh = 6930 then raise exception 'AC-4 inconclusive: card edit did not change the fresh price'; end if;

  -- the existing quote must be UNCHANGED (it reads its snapshot, not the live card)
  select all_in_total, rate_card_version, (breakdown_snapshot->>'all_in_total')::int
    into v_total, v_ver, v_snap_total
    from public.quotes where request_id = '33333333-3333-4333-8333-333333333333';
  if v_total <> 6930      then raise exception 'AC-4 FAIL: quote all_in_total changed to % after card edit', v_total; end if;
  if v_ver   <> '2026-06-v1' then raise exception 'AC-4 FAIL: quote rate_card_version changed to %', v_ver; end if;
  if v_snap_total <> 6930 then raise exception 'AC-4 FAIL: snapshot all_in_total changed to %', v_snap_total; end if;

  raise notice 'AC-4: fresh price off edited card = % (differs from frozen quote 6930)', v_fresh;
end $$;

rollback;
select 'AC-4 PASS — superseding the rate card did not change the existing quote (it reads its breakdown_snapshot)' as result;
