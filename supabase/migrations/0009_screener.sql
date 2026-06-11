-- ===========================================================================
-- 0009_screener.sql — universe-wide data for the Stock Research screener
--
-- Adds a compact sparkline series to company_technicals so the screener can
-- render a price trend for every stock from a single small column (the full
-- candle history in data->history is too heavy to read across the whole
-- universe). Populated whenever technicals are computed; the backfill cron
-- walks the universe so it fills in for all stocks over time.
-- ===========================================================================

alter table public.company_technicals
  add column if not exists spark jsonb;          -- number[] of ~40 recent closes (downsampled)

-- Find stale/missing technicals fast for the rotating backfill (oldest first).
create index if not exists company_technicals_updated_idx
  on public.company_technicals (updated_at asc nulls first);
