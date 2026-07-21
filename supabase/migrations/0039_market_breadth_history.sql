-- ---------------------------------------------------------------------------
-- market_breadth_history
--
-- Daily market breadth reconstructed from constituent EOD prices.
--
-- Kept separate from market_snapshots on purpose. That table is a live capture
-- of one session as the platform observed it, including fields that cannot be
-- recovered after the fact (most-active ticker, value traded, freshness of the
-- feed at the time). This table is derived: every column here is recomputed
-- from company_price_history, so it can be rebuilt from scratch at any time and
-- extends back as far as the price panel does rather than as far as our own
-- capture history does.
--
-- Market data, not user-scoped: one shared row per trading day, written by the
-- service-role client and readable by any signed-in user.
-- ---------------------------------------------------------------------------

create table if not exists public.market_breadth_history (
  trade_date date primary key,

  -- Participation. `counted` is how many symbols had a usable close on both
  -- this day and the previous one, which is the denominator for every share
  -- below and varies as listings come and go.
  counted integer not null,
  advancers integer not null,
  decliners integer not null,
  unchanged integer not null,

  -- Share of counted symbols that rose, 0-1. Stored rather than derived so
  -- callers cannot accidentally divide by a different denominator.
  advance_share numeric,

  -- Trend participation: share of symbols trading above their own moving
  -- average. These say how broad a move is in a way the index cannot, since a
  -- cap-weighted index can rise on a handful of large names.
  pct_above_ma50 numeric,
  pct_above_ma200 numeric,

  -- Extremes over a rolling 52-week window.
  new_highs_52w integer,
  new_lows_52w integer,

  -- Cross-sectional shape of the day's returns. Dispersion separates a broad
  -- drift from a day where a few names moved violently in both directions.
  median_return numeric,
  return_dispersion numeric,

  -- Volume behind the direction, for confirmation.
  up_volume numeric,
  down_volume numeric,

  source text not null default 'computed-from-eod',
  computed_at timestamptz not null default now()
);

create index if not exists market_breadth_history_date_idx
  on public.market_breadth_history (trade_date desc);

alter table public.market_breadth_history enable row level security;

-- Shared market data: any signed-in user may read; writes go through the
-- service-role client, which bypasses RLS.
create policy "market_breadth_history_read"
  on public.market_breadth_history for select to authenticated using (true);
