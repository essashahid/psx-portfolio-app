-- ---------------------------------------------------------------------------
-- macro_asset_history
-- Cached daily history for the non-PSX asset classes the capital-allocation
-- forecaster reasons over: Bitcoin, gold (XAU), the USD/PKR rate, and a PKR
-- T-bill / policy yield. Market data, not user-scoped: one shared cache,
-- refreshed from free public sources (CoinGecko, stooq) via the service-role
-- client. PSX equity history already lives in eod_history.
--
--   asset        'BTC' | 'GOLD' | 'USDPKR' | 'TBILL'
--   close_native native unit: BTC/GOLD in USD, USDPKR as the rate, TBILL as %/yr
--   close_pkr    PKR-denominated level where meaningful (BTC, GOLD); null for
--                USDPKR (it is itself a rate) and TBILL (it is a yield)
-- ---------------------------------------------------------------------------
create table public.macro_asset_history (
  asset text not null,
  asof_date date not null,
  close_native numeric not null,
  close_pkr numeric,
  source text not null,
  updated_at timestamptz not null default now(),
  primary key (asset, asof_date)
);

create index macro_asset_history_asset_idx on public.macro_asset_history (asset, asof_date);

alter table public.macro_asset_history enable row level security;
-- Any signed-in user may read the shared market cache; writes go through the
-- service-role client which bypasses RLS.
create policy "macro_asset_history_read" on public.macro_asset_history for select to authenticated using (true);
