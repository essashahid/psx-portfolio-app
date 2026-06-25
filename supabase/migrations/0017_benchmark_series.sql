-- ---------------------------------------------------------------------------
-- benchmark_series
-- Pre-computed "growth of invested capital" lines for the dashboard benchmark
-- chart: the investor's portfolio vs a KSE-100 (total return) equivalent vs an
-- inflation-protected equivalent, all driven off the real dated contribution
-- stream. Heavy reconstruction (ledger replay + PSX EOD history + PBS CPI) runs
-- offline in scripts/build-benchmark-series.ts and writes monthly rows here so
-- the dashboard reads a small, fast table.
-- ---------------------------------------------------------------------------
create table public.benchmark_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  point_date date not null,
  contributed numeric not null default 0, -- cumulative external capital put in
  portfolio numeric not null default 0,   -- held shares at market + broker cash
  kse100 numeric not null default 0,       -- KSE-100 total-return equivalent
  inflation numeric not null default 0,    -- PBS National CPI equivalent
  cpi numeric,                             -- CPI index at point_date (real-value mode)
  created_at timestamptz not null default now(),
  unique (user_id, point_date)
);

create index benchmark_series_user_idx on public.benchmark_series (user_id, point_date);

alter table public.benchmark_series enable row level security;
create policy "benchmark_series_owner_select" on public.benchmark_series for select using (auth.uid() = user_id);
create policy "benchmark_series_owner_insert" on public.benchmark_series for insert with check (auth.uid() = user_id);
create policy "benchmark_series_owner_update" on public.benchmark_series for update using (auth.uid() = user_id);
create policy "benchmark_series_owner_delete" on public.benchmark_series for delete using (auth.uid() = user_id);
