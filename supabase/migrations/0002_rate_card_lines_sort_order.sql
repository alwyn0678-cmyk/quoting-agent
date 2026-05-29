-- 0002 (1B.3): add sort_order to rate_card_lines.
-- The SupabaseTable adapter emits RateQuote.surcharges / per_shipment_fees as ORDERED arrays; a SQL
-- SELECT has no inherent row order, so without a stable key the adapter's output order (and AC-3's
-- "identical RateQuote" assertion) would be nondeterministic. sort_order pins the per-kind order to
-- match the Phase 0 StaticCard. Append-only migration (0001 already applied).
alter table public.rate_card_lines add column if not exists sort_order smallint not null default 0;
