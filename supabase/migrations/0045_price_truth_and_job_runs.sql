-- One price truth, and a record of every scheduled job.
--
-- latest_closes(): the latest daily close per ticker from the canonical
-- company_price_history, in one round trip. It is the third candidate in
-- lib/portfolio/effective-price.ts, behind a user override and the shared
-- quote. SECURITY INVOKER: the table is readable by every authenticated user
-- already, so no privilege changes hands.
--
-- job_runs: every cron handler records a row when it starts and when it ends.
-- Nothing recorded a job's completion before, so a job that timed out looked
-- identical to one that never ran. The health check in lib/ops/job-health.ts
-- reads this table, and the admin jobs page shows it.

create or replace function public.latest_closes(p_tickers text[])
returns table (ticker text, close numeric, price_date date, source text)
language sql
stable
set search_path = public
as $$
  select distinct on (h.ticker) h.ticker, h.close, h.price_date, h.source
  from public.company_price_history h
  where h.ticker = any (p_tickers)
  order by h.ticker, h.price_date desc
$$;

grant execute on function public.latest_closes(text[]) to authenticated;
grant execute on function public.latest_closes(text[]) to service_role;

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error', 'partial')),
  summary jsonb,
  error text
);

create index if not exists job_runs_job_started_idx on public.job_runs (job, started_at desc);

alter table public.job_runs enable row level security;

-- Admins may read; only the service role writes.
drop policy if exists "job_runs admin read" on public.job_runs;
create policy "job_runs admin read" on public.job_runs
  for select to authenticated
  using (public.is_admin());

-- Rollback
-- --------
-- drop table if exists public.job_runs;
-- drop function if exists public.latest_closes(text[]);
