-- ---------------------------------------------------------------------------
-- eod_history
-- Cached PSX end-of-day close history (per ticker + the KSE100 index), so the
-- live benchmark recompute on every ledger edit reads prices from the DB
-- instead of hitting the PSX portal in the hot path. Market data, not
-- user-scoped: one shared cache, refreshed from dps.psx.com.pk via the admin
-- (service-role) client.
-- ---------------------------------------------------------------------------
create table public.eod_history (
  ticker text not null,
  trade_date date not null,
  close numeric not null,
  updated_at timestamptz not null default now(),
  primary key (ticker, trade_date)
);

create index eod_history_ticker_idx on public.eod_history (ticker, trade_date);

alter table public.eod_history enable row level security;
-- Any signed-in user may read the shared market cache; writes go through the
-- service-role client which bypasses RLS.
create policy "eod_history_read" on public.eod_history for select to authenticated using (true);
