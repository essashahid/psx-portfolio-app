-- ===========================================================================
-- Stock Data Engine — universe, provider symbol mapping, quotes, ratios,
-- provider status. Shared (ticker-keyed) caches: authenticated read,
-- service-role write, same pattern as 0006.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- stock_universe — the full PSX listing master (superset of stock_master)
-- ---------------------------------------------------------------------------
create table if not exists public.stock_universe (
  ticker text primary key,
  company_name text,
  psx_name text,
  sector text,
  industry text,
  exchange text not null default 'PSX',
  face_value numeric,
  isin text,
  website text,
  listing_status text not null default 'active',  -- active | suspended | delisted | unknown
  coverage jsonb not null default '{}'::jsonb,    -- { quote: bool, history: bool, financials: bool, ... }
  last_updated timestamptz not null default now()
);

alter table public.stock_universe enable row level security;
create policy "stock_universe_read" on public.stock_universe
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- provider_symbol_map — which symbol works on which provider for a ticker
-- ---------------------------------------------------------------------------
create table if not exists public.provider_symbol_map (
  ticker text not null,
  provider text not null,            -- psx-dps | psx-terminal | twelve-data | finnhub | alpha-vantage
  provider_symbol text,              -- the symbol string that worked, null = none found
  works boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb, -- { quote: bool, history: bool, fundamentals: bool }
  last_tested_at timestamptz,
  detail text,
  primary key (ticker, provider)
);

alter table public.provider_symbol_map enable row level security;
create policy "provider_symbol_map_read" on public.provider_symbol_map
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- market_quotes — latest normalized quote per ticker (one row, upserted)
-- ---------------------------------------------------------------------------
create table if not exists public.market_quotes (
  ticker text primary key,
  price numeric,
  prev_close numeric,
  day_change numeric,
  day_change_pct numeric,
  open numeric,
  high numeric,
  low numeric,
  volume numeric,
  market_cap numeric,
  as_of date,
  as_of_time timestamptz,
  provider text,
  provider_symbol text,
  is_realtime boolean not null default false,
  last_fetched_at timestamptz not null default now()
);

alter table public.market_quotes enable row level security;
create policy "market_quotes_read" on public.market_quotes
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- company_ratios — derived ratios with formula + inputs provenance
-- ---------------------------------------------------------------------------
create table if not exists public.company_ratios (
  ticker text not null,
  ratio_name text not null,
  ratio_value numeric,               -- null when uncomputable
  formula text not null,
  inputs jsonb not null default '{}'::jsonb,
  missing text,                      -- human reason when ratio_value is null
  source_period text,
  source text,
  computed_at timestamptz not null default now(),
  primary key (ticker, ratio_name)
);

alter table public.company_ratios enable row level security;
create policy "company_ratios_read" on public.company_ratios
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- data_provider_status — rolling health per provider
-- ---------------------------------------------------------------------------
create table if not exists public.data_provider_status (
  provider text primary key,
  configured boolean not null default false,
  healthy boolean,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  rate_limited boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.data_provider_status enable row level security;
create policy "data_provider_status_read" on public.data_provider_status
  for select to authenticated using (true);

-- Earnings convenience index on the 0006 financials table.
create index if not exists company_financials_reported_idx
  on public.company_financials (ticker, reported_date desc);
