-- ===========================================================================
-- 0013_foreign_flows.sql — Foreign & local investor flows (FIPI / LIPI)
--
-- NCCPL publishes daily Foreign Investor Portfolio Investment (FIPI) and Local
-- Investor Portfolio Investment (LIPI) numbers — the single most-watched
-- "smart money" signal on PSX (are foreigners net buyers/sellers, and of which
-- sectors). There is no clean public API, so these tables are fed by either a
-- best-effort scheduled fetch (when NCCPL_FLOWS_URL is configured) or a manual
-- paste/upload by the owner — mirroring the app's "manual price" philosophy.
--
-- Like the market_* cache, every authenticated user can read; writes happen
-- through the service role (background job / manual upload route). Amounts are
-- stored in their reported unit (NCCPL reports FIPI/LIPI in USD millions);
-- `currency` records that unit so the UI can label it correctly.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- foreign_flow_days — one row per trading day: headline FIPI + LIPI net
-- ---------------------------------------------------------------------------
create table if not exists public.foreign_flow_days (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'PSX',
  flow_date date not null,
  currency text not null default 'USD',           -- reported unit (USD millions)
  fipi_net numeric,                                -- foreign net (buy − sell); + = net foreign buying
  fipi_gross_buy numeric,
  fipi_gross_sell numeric,
  lipi_net numeric,                                -- local net (mirror of fipi_net when only two sides)
  lipi_gross_buy numeric,
  lipi_gross_sell numeric,
  source_provider text not null default 'manual', -- manual | nccpl | <other>
  source_url text,
  ingested_by text not null default 'manual',     -- manual | auto
  freshness text not null default 'fresh',         -- fresh | stale
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market, flow_date)
);
create index if not exists foreign_flow_days_date_idx on public.foreign_flow_days (flow_date desc);

-- ---------------------------------------------------------------------------
-- foreign_flow_sectors — FIPI net by PSX sector for one day (the rotation read)
-- ---------------------------------------------------------------------------
create table if not exists public.foreign_flow_sectors (
  id uuid primary key default gen_random_uuid(),
  flow_date date not null,
  market text not null default 'PSX',
  sector text not null,
  net numeric,                                     -- + = foreigners net buyers of this sector
  gross_buy numeric,
  gross_sell numeric,
  created_at timestamptz not null default now(),
  unique (market, flow_date, sector)
);
create index if not exists foreign_flow_sectors_date_idx on public.foreign_flow_sectors (flow_date desc);

-- ---------------------------------------------------------------------------
-- local_flow_participants — LIPI net by investor category for one day
--   (individuals, companies, banks/DFI, mutual funds, brokers, insurance, …)
-- ---------------------------------------------------------------------------
create table if not exists public.local_flow_participants (
  id uuid primary key default gen_random_uuid(),
  flow_date date not null,
  market text not null default 'PSX',
  category text not null,                          -- normalized slug, e.g. individuals
  label text,                                      -- display label as reported
  net numeric,
  gross_buy numeric,
  gross_sell numeric,
  created_at timestamptz not null default now(),
  unique (market, flow_date, category)
);
create index if not exists local_flow_participants_date_idx on public.local_flow_participants (flow_date desc);

-- ---------------------------------------------------------------------------
-- RLS — authenticated read, service-role write (background job / upload route)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'foreign_flow_days','foreign_flow_sectors','local_flow_participants'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($p$create policy "%1$s_read" on public.%1$I for select to authenticated using (true);$p$, t);
  end loop;
end $$;
