-- ===========================================================================
-- 0010_company_payouts.sql — market-wide dividend / payout history
--
-- The existing `dividends` and `dividend_events` tables are user-scoped (per
-- import / per user). The ratios engine needs a ticker-scoped, market-wide
-- dividend source so trailing-12-month yield / payout / cover can be computed
-- for EVERY company, independent of any user. Populated from the official PSX
-- payouts feed (POST /payouts) by background jobs.
-- ===========================================================================

create table if not exists public.company_payouts (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text,
  kind text not null default 'cash',          -- cash | bonus | right
  term text,                                   -- interim | final | special
  percentage numeric,                          -- % of face value as announced
  face_value numeric,                          -- assumed 10 when not known
  dividend_per_share numeric,                  -- cash DPS in PKR (null for bonus)
  announcement_date date,
  announced_at text,                           -- raw announcement timestamp text
  book_closure_start date,
  book_closure_end date,
  raw text,                                    -- raw "20%(i) (D)" string
  source text not null default 'psx-payouts',
  updated_at timestamptz not null default now(),
  unique (ticker, raw, announcement_date)
);
create index if not exists company_payouts_ticker_idx on public.company_payouts (ticker, announcement_date desc);

alter table public.company_payouts enable row level security;
create policy "company_payouts_read" on public.company_payouts for select to authenticated using (true);
