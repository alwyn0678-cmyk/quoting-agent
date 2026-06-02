-- 0013 — make transport mode a first-class key on rate cards (multi-modal rate sheet).
-- Extends D-04 (one mode/one lane): a tenant can now hold cards for FCL, BARGE, RAIL, … on a lane.
-- Existing rows are FCL (the only mode before this). The active-card lookup filters on mode too
-- (code: SupabaseRateCardSource.fetchActiveCard). No new access; append-only; idempotent.
alter table public.rate_cards add column if not exists mode text not null default 'FCL';
