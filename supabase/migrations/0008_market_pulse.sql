-- ===========================================================================
-- 0008_market_pulse.sql — PSX Market Pulse
--
-- Premium market-wide dashboard backed by cached snapshots so the page never
-- depends on live API calls. Background jobs build one snapshot per trading
-- day from the official PSX market-watch + indices feeds (joined with cached
-- technicals/metadata); the page reads these tables only. All market_* tables
-- are readable by every authenticated user and written exclusively by the
-- service role (background jobs), mirroring the company_* cache pattern.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- market_snapshots — one row per market build (index level + breadth totals)
-- ---------------------------------------------------------------------------
create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  market text not null default 'PSX',
  snapshot_date date not null,
  snapshot_time timestamptz not null default now(),
  index_name text,                       -- e.g. KSE100 (null when unavailable)
  index_value numeric,
  index_change numeric,
  index_change_percent numeric,
  total_advancers integer not null default 0,
  total_decliners integer not null default 0,
  total_unchanged integer not null default 0,
  total_volume numeric not null default 0,
  total_value numeric not null default 0, -- Σ volume × price (approx; flagged in UI)
  most_active_ticker text,
  top_sector text,
  bottom_sector text,
  source_provider text not null default 'psx-dps',
  freshness text not null default 'fresh', -- fresh | stale
  item_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (market, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- market_snapshot_items — per-ticker row inside a snapshot
-- ---------------------------------------------------------------------------
create table if not exists public.market_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.market_snapshots (id) on delete cascade,
  ticker text not null,
  company_name text,
  sector text,
  price numeric,
  previous_close numeric,
  change numeric,
  change_percent numeric,
  open numeric,
  high numeric,
  low numeric,
  volume numeric,
  value_traded numeric,
  market_cap numeric,
  fifty_two_week_high numeric,
  fifty_two_week_low numeric,
  near_high boolean not null default false, -- within 3% of 52w high
  near_low boolean not null default false,  -- within 3% of 52w low
  unusual_volume boolean not null default false, -- volume ≥ 2× average
  source_provider text not null default 'psx-dps',
  last_updated timestamptz not null default now(),
  unique (snapshot_id, ticker)
);
create index if not exists market_snapshot_items_snapshot_idx on public.market_snapshot_items (snapshot_id);
create index if not exists market_snapshot_items_sector_idx on public.market_snapshot_items (snapshot_id, sector);

-- ---------------------------------------------------------------------------
-- sector_snapshots — sector aggregates for one snapshot
-- ---------------------------------------------------------------------------
create table if not exists public.sector_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.market_snapshots (id) on delete cascade,
  sector text not null,
  average_return numeric,
  median_return numeric,
  total_volume numeric not null default 0,
  total_value numeric not null default 0,
  advancers integer not null default 0,
  decliners integer not null default 0,
  unchanged integer not null default 0,
  stock_count integer not null default 0,
  top_gainer text,
  top_gainer_pct numeric,
  top_loser text,
  top_loser_pct numeric,
  unique (snapshot_id, sector)
);
create index if not exists sector_snapshots_snapshot_idx on public.sector_snapshots (snapshot_id);

-- ---------------------------------------------------------------------------
-- market_movers — precomputed ranked lists per category
-- ---------------------------------------------------------------------------
create table if not exists public.market_movers (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.market_snapshots (id) on delete cascade,
  category text not null, -- gainers | losers | active_volume | active_value | unusual_volume | near_high | near_low
  ticker text not null,
  company_name text,
  sector text,
  price numeric,
  change_percent numeric,
  volume numeric,
  value_traded numeric,
  rank integer not null,
  unique (snapshot_id, category, ticker)
);
create index if not exists market_movers_lookup_idx on public.market_movers (snapshot_id, category, rank);

-- ---------------------------------------------------------------------------
-- market_events — today's PSX/company announcements (market-wide feed cache)
-- ---------------------------------------------------------------------------
create table if not exists public.market_events (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text,
  sector text,
  event_type text not null, -- result | dividend | board_meeting | material | corporate_announcement
  title text not null,
  source_url text,
  source_quality text not null default 'high', -- high (official PSX) | medium | low
  event_date date not null,
  event_time text,
  summary text,
  created_at timestamptz not null default now(),
  unique (ticker, title, event_date)
);
create index if not exists market_events_date_idx on public.market_events (event_date desc);

-- ---------------------------------------------------------------------------
-- market_ai_briefs — one AI market brief per snapshot (cached, regenerated by job)
-- ---------------------------------------------------------------------------
create table if not exists public.market_ai_briefs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references public.market_snapshots (id) on delete cascade,
  snapshot_date date not null,
  title text,
  content text not null,
  structured_output jsonb,
  model text,
  created_at timestamptz not null default now(),
  unique (snapshot_date)
);

-- ---------------------------------------------------------------------------
-- RLS — authenticated read, service-role write (background jobs only)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'market_snapshots','market_snapshot_items','sector_snapshots',
    'market_movers','market_events','market_ai_briefs'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($p$create policy "%1$s_read" on public.%1$I for select to authenticated using (true);$p$, t);
  end loop;
end $$;
