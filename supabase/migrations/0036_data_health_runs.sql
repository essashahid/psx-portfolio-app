-- Data-health audit history.
--
-- The checks in lib/engine/data-health.ts test relationships BETWEEN stored
-- rows (does the trailing-12m chain have its prior-year leg, do two fiscal
-- years carry identical figures, does the annual agree with the interim on
-- share count). Each row can be individually valid while the relationship is
-- broken, so write-time validation cannot catch them.
--
-- Storing each run makes regressions visible as a trend rather than a
-- snapshot: a jump in NO_COMPARATIVE right after a results season means the
-- newly filed statements extracted badly, which is worth knowing in a day
-- rather than discovering by hand a quarter later.

create table if not exists public.data_health_runs (
  id                   bigserial primary key,
  ran_at               timestamptz not null default now(),
  checked              integer     not null,
  clean_companies      integer     not null,
  clean_market_cap     numeric,
  clean_market_cap_pct numeric,
  -- { "NO_COMPARATIVE": { "companies": 12, "marketCap": 1.2e11 }, ... }
  summary              jsonb       not null default '{}'::jsonb,
  duration_ms          integer
);

create index if not exists data_health_runs_ran_at_idx
  on public.data_health_runs (ran_at desc);

alter table public.data_health_runs enable row level security;

-- Written by the cron using the service role, which bypasses RLS. Any
-- authenticated user may read the history so it can be surfaced in the admin
-- data-coverage view.
drop policy if exists "data_health_runs readable by authenticated" on public.data_health_runs;
create policy "data_health_runs readable by authenticated"
  on public.data_health_runs for select
  to authenticated
  using (true);
