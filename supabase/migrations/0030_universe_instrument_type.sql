-- ---------------------------------------------------------------------------
-- 0030 — instrument_type on stock_universe
--
-- The PSX symbol directory mixes companies with government debt, TFCs, rights,
-- preference shares, ETFs and closed-end funds. The data engine used to rotate
-- through all of them, wasting its daily fetch budget on symbols that can never
-- have financial statements or payout history. This adds an instrument_type
-- column (kept current by the universe sync from the directory's isDebt/isETF
-- flags plus name patterns) and backfills it from the same patterns so the
-- engine benefits before the next sync runs.
--
--   equity | debt | etf | right | pref | modaraba | fund
-- ---------------------------------------------------------------------------

alter table public.stock_universe
  add column if not exists instrument_type text not null default 'equity';

create index if not exists stock_universe_type_status_idx
  on public.stock_universe (instrument_type, listing_status);

-- Backfill from sector + symbol/name patterns (the sync refines these weekly
-- from the directory's own flags).
update public.stock_universe set instrument_type = 'debt'
  where upper(coalesce(sector, '')) = 'BILLS AND BONDS'
     or ticker ~ '^P\d{2}'
     or ticker ~ 'TFC\d*$';

update public.stock_universe set instrument_type = 'etf'
  where instrument_type = 'equity'
    and upper(coalesce(sector, '')) = 'EXCHANGE TRADED FUNDS';

update public.stock_universe set instrument_type = 'pref'
  where instrument_type = 'equity'
    and (company_name ~* '\(.*pref' or company_name ~* '\bpreference\b');

update public.stock_universe set instrument_type = 'right'
  where instrument_type = 'equity'
    and (company_name ~* '\(right\)' or company_name ~* '\(r\d?\)' or ticker ~ 'R\d$');

update public.stock_universe set instrument_type = 'modaraba'
  where instrument_type = 'equity'
    and upper(coalesce(sector, '')) = 'MODARABAS';

update public.stock_universe set instrument_type = 'fund'
  where instrument_type = 'equity'
    and upper(coalesce(sector, '')) like 'CLOSE%MUTUAL FUND%';
