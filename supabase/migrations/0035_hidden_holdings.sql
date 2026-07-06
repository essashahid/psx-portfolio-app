-- ---------------------------------------------------------------------------
-- Hidden holdings: per-position opt-out from all analysis.
--
--   holdings.hidden = true means the position (often employer-granted shares
--   like CCM, or inherited insurance stock) is kept in the ledger but excluded
--   from portfolio totals, weights, sector allocation, performance and
--   benchmark series, dividend forecasts, alerts, news lanes and Copilot
--   context. The row itself, its transactions and dividend records stay
--   untouched so the position can be unhidden at any time.
--
--   The flag lives on holdings (not a separate table) because every analysis
--   read already goes through this table; recompute upserts do not include
--   the column, so the flag survives ledger rebuilds.
-- ---------------------------------------------------------------------------

alter table public.holdings
  add column if not exists hidden boolean not null default false;
