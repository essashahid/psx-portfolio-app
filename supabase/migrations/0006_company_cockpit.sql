-- ===========================================================================
-- Company Cockpit — PSX Stock Intelligence
--
-- Shared, ticker-keyed caches (company_metadata, company_price_history,
-- company_technicals, company_financials) are readable by every authenticated
-- user and written only by the service role (background jobs / cached
-- providers), mirroring the stock_master pattern. User-scoped tables
-- (stock_watchlist) use the usual owner RLS. data_fetch_logs records every
-- provider fetch for freshness + observability.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- company_metadata — overview/profile cache (one row per ticker)
-- ---------------------------------------------------------------------------
create table if not exists public.company_metadata (
  ticker text primary key,
  company_name text,
  sector text,
  industry text,
  exchange text not null default 'PSX',
  face_value numeric,
  shares_outstanding numeric,
  market_cap numeric,
  website text,
  description text,
  business_lines text[],
  source text,                -- psx-directory | stock-master | ai | manual
  source_url text,
  confidence numeric,         -- 0..1
  last_fetched_at timestamptz,
  last_updated timestamptz not null default now()
);

alter table public.company_metadata enable row level security;
create policy "company_metadata_read" on public.company_metadata
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- company_price_history — shared EOD candles (ticker + date)
-- ---------------------------------------------------------------------------
create table if not exists public.company_price_history (
  ticker text not null,
  price_date date not null,
  close numeric not null,
  volume numeric,
  source text not null default 'psx-dps',
  created_at timestamptz not null default now(),
  primary key (ticker, price_date)
);

create index if not exists company_price_history_ticker_idx
  on public.company_price_history (ticker, price_date desc);

alter table public.company_price_history enable row level security;
create policy "company_price_history_read" on public.company_price_history
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- company_technicals — computed indicator snapshot (one row per ticker)
-- ---------------------------------------------------------------------------
create table if not exists public.company_technicals (
  ticker text primary key,
  as_of_date date,
  latest_price numeric,
  prev_close numeric,
  day_change_pct numeric,
  volume numeric,
  average_volume numeric,
  moving_average_20 numeric,
  moving_average_50 numeric,
  moving_average_100 numeric,
  moving_average_200 numeric,
  rsi numeric,
  fifty_two_week_high numeric,
  fifty_two_week_low numeric,
  volatility numeric,         -- annualized stdev of daily returns, %
  data jsonb,                 -- { history: [...], flags: {...} }
  source text not null default 'psx-dps',
  last_fetched_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.company_technicals enable row level security;
create policy "company_technicals_read" on public.company_technicals
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- company_financials — structured statements (scaffold; filled by providers
-- or manual import). data jsonb holds normalized line items.
-- ---------------------------------------------------------------------------
create table if not exists public.company_financials (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  period_type text not null,        -- annual | quarterly
  fiscal_year int,
  fiscal_period text,               -- FY | Q1 | Q2 | Q3 | Q4 | H1 | 9M
  statement_type text not null,     -- income_statement | balance_sheet | cash_flow
  reported_date date,
  source_type text,                 -- psx-filing | manual | provider
  source_url text,
  data jsonb not null default '{}'::jsonb,
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker, period_type, fiscal_year, fiscal_period, statement_type)
);

create index if not exists company_financials_ticker_idx
  on public.company_financials (ticker, statement_type, fiscal_year desc);

alter table public.company_financials enable row level security;
create policy "company_financials_read" on public.company_financials
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- stock_watchlist — user-scoped watchlist / favorites
-- ---------------------------------------------------------------------------
create table if not exists public.stock_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  status text not null default 'watching',  -- watching | researching | archived
  notes text,
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create index if not exists stock_watchlist_user_idx
  on public.stock_watchlist (user_id, created_at desc);

alter table public.stock_watchlist enable row level security;
create policy "stock_watchlist_rw" on public.stock_watchlist
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- data_fetch_logs — observability for background/section fetches
-- ---------------------------------------------------------------------------
create table if not exists public.data_fetch_logs (
  id uuid primary key default gen_random_uuid(),
  ticker text,
  section text not null,            -- metadata | technicals | filings | dividends | ...
  source text,
  status text not null,             -- ok | empty | error
  rows int,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists data_fetch_logs_ticker_idx
  on public.data_fetch_logs (ticker, created_at desc);

alter table public.data_fetch_logs enable row level security;
create policy "data_fetch_logs_read" on public.data_fetch_logs
  for select to authenticated using (true);
