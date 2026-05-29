-- P-1B.2 — seed-sum / card-as-rows parity (proving test for 1B.2).
-- Reads the SEEDED Linkport card and recomputes the four golden all-in totals with the CONTEXT.md
-- formula  all_in = qty * (base[ct] + Σ surcharge_per_container) + Σ per_shipment_fee.
-- Asserts the per-container surcharge sum (860) + per-shipment fee sum (110) and all four totals
-- (6930 / 2770 / 9890 / 3520). Read-only; raises on any mismatch (Management API surfaces it = FAIL).

do $$
declare
  v_card uuid;
  v_surch int; v_fees int;
  v_base_20 int; v_base_40gp int; v_base_40hc int;
  v_total int;
begin
  select id into v_card from public.rate_cards
    where tenant_id = '11111111-1111-4111-8111-111111111111' and lane = 'NLRTM-USNYC' and is_active
    order by created_at desc limit 1;
  if v_card is null then raise exception 'P-1B.2 FAIL: no active Linkport NLRTM-USNYC card'; end if;

  select coalesce(sum(amount),0) into v_surch from public.rate_card_lines
    where rate_card_id = v_card and kind = 'surcharge_per_container';
  select coalesce(sum(amount),0) into v_fees from public.rate_card_lines
    where rate_card_id = v_card and kind = 'per_shipment_fee';
  if v_surch <> 860 then raise exception 'P-1B.2 FAIL: Σ surcharge/container = %, expected 860', v_surch; end if;
  if v_fees  <> 110 then raise exception 'P-1B.2 FAIL: Σ per-shipment fee = %, expected 110', v_fees; end if;

  select amount into v_base_20   from public.rate_card_lines where rate_card_id = v_card and kind='base' and container_type='20GP';
  select amount into v_base_40gp from public.rate_card_lines where rate_card_id = v_card and kind='base' and container_type='40GP';
  select amount into v_base_40hc from public.rate_card_lines where rate_card_id = v_card and kind='base' and container_type='40HC';

  v_total := 2 * (v_base_40hc + v_surch) + v_fees;  -- 40HC x2
  if v_total <> 6930 then raise exception 'P-1B.2 FAIL: 40HC x2 = %, expected 6930', v_total; end if;
  v_total := 1 * (v_base_20 + v_surch) + v_fees;     -- 20GP x1
  if v_total <> 2770 then raise exception 'P-1B.2 FAIL: 20GP x1 = %, expected 2770', v_total; end if;
  v_total := 3 * (v_base_40gp + v_surch) + v_fees;   -- 40GP x3
  if v_total <> 9890 then raise exception 'P-1B.2 FAIL: 40GP x3 = %, expected 9890', v_total; end if;
  v_total := 1 * (v_base_40hc + v_surch) + v_fees;   -- 40HC x1
  if v_total <> 3520 then raise exception 'P-1B.2 FAIL: 40HC x1 = %, expected 3520', v_total; end if;
end $$;

select 'P-1B.2 PASS — seeded rows recompute 6930 / 2770 / 9890 / 3520 (base + 860/container + 110/shipment)' as result;
