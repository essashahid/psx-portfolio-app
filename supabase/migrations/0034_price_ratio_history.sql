-- ---------------------------------------------------------------------------
-- Price consolidation + ratio history
--
-- Canonical shared market data is now:
--   company_price_history = daily shared closes/volume for equities and KSE100
--   market_quotes         = latest/live normalized quote per ticker
--
-- public.prices remains user-scoped manual/provider override history for
-- portfolio valuation. public.eod_history is retained as legacy storage, but
-- its rows are copied into company_price_history and app readers move to the
-- canonical table.
--
-- Ratios keep the current latest-snapshot table and gain a dated history table
-- for sparklines/trend views.
-- ---------------------------------------------------------------------------

begin;

alter table public.company_price_history
  add column if not exists updated_at timestamptz not null default now();

insert into public.company_price_history (ticker, price_date, close, volume, source, created_at, updated_at)
select ticker, trade_date, close, null, 'legacy-eod-history', updated_at, updated_at
from public.eod_history
on conflict (ticker, price_date) do update set
  close = excluded.close,
  updated_at = greatest(company_price_history.updated_at, excluded.updated_at),
  source = case
    when company_price_history.source is null or company_price_history.source = ''
      then excluded.source
    else company_price_history.source
  end;

create index if not exists company_price_history_date_idx
  on public.company_price_history (price_date desc, ticker);

create table if not exists public.company_ratio_history (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  ratio_name text not null,
  as_of_date date not null default current_date,
  ratio_value numeric,
  formula text not null,
  inputs jsonb not null default '{}'::jsonb,
  missing text,
  source_period text,
  source text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique nulls not distinct (ticker, ratio_name, as_of_date, source_period)
);

create index if not exists company_ratio_history_ticker_idx
  on public.company_ratio_history (ticker, ratio_name, as_of_date desc);

create index if not exists company_ratio_history_recent_idx
  on public.company_ratio_history (ticker, as_of_date desc);

alter table public.company_ratio_history enable row level security;

drop policy if exists "company_ratio_history_read" on public.company_ratio_history;
create policy "company_ratio_history_read" on public.company_ratio_history
  for select to authenticated using (true);

drop policy if exists "company_ratio_history_admin_all" on public.company_ratio_history;
create policy "company_ratio_history_admin_all" on public.company_ratio_history
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.company_ratio_history (
  ticker, ratio_name, as_of_date, ratio_value, formula, inputs,
  missing, source_period, source, computed_at, created_at
)
select
  ticker, ratio_name, computed_at::date, ratio_value, formula, inputs,
  missing, source_period, source, computed_at, computed_at
from public.company_ratios
on conflict (ticker, ratio_name, as_of_date, source_period) do update set
  ratio_value = excluded.ratio_value,
  formula = excluded.formula,
  inputs = excluded.inputs,
  missing = excluded.missing,
  source = excluded.source,
  computed_at = excluded.computed_at;

comment on table public.company_price_history is
  'Canonical shared daily close/volume series for PSX equities and KSE100. User-specific manual prices remain in public.prices.';

comment on table public.market_quotes is
  'Canonical latest/live quote snapshot per ticker. Daily history lives in public.company_price_history.';

comment on table public.company_ratio_history is
  'Dated history of computed company ratios. public.company_ratios remains the latest snapshot.';

commit;
