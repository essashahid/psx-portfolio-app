-- Phase 2 preflight. Read-only. Re-run before applying 0043 or 0044 and
-- compare against the counts recorded in each migration's header.
--
-- Run it however you reach the database; it writes nothing.

-- 1. Ledger duplicates that unique (user_id, row_hash) would reject.
select 'transactions' as t,
       count(*) as rows,
       count(*) filter (where row_hash is null) as null_hash,
       (select coalesce(sum(c-1),0) from (
          select count(*) c from public.transactions
          where row_hash is not null group by user_id, row_hash having count(*)>1) x) as extra_rows
from public.transactions
union all
select 'cash_movements',
       count(*),
       count(*) filter (where row_hash is null),
       (select coalesce(sum(c-1),0) from (
          select count(*) c from public.cash_movements
          where row_hash is not null group by user_id, row_hash having count(*)>1) x)
from public.cash_movements;

-- 2. Payout duplicates, under both null semantics.
select count(*) as payout_rows,
       count(*) filter (where announcement_date is null) as null_date,
       count(*) filter (where raw is null) as null_raw,
       (select coalesce(sum(c-1),0) from (
          select count(*) c from public.company_payouts
          group by ticker, raw, announcement_date having count(*)>1) x) as extra_nulls_distinct,
       (select coalesce(sum(c-1),0) from (
          select count(*) c from public.company_payouts
          group by ticker, coalesce(raw,'~'), coalesce(announcement_date::text,'~')
          having count(*)>1) x) as extra_nulls_not_distinct
from public.company_payouts;

-- 3. Orphans the new foreign key would reject.
select count(*) as orphaned_reconciled_dividends
from public.dividend_events de
where de.reconciled_dividend_id is not null
  and not exists (select 1 from public.dividends d where d.id = de.reconciled_dividend_id);

-- 4. Source values the CHECK constraints must already permit.
select 'holdings' as t, source, count(*) from public.holdings group by 1,2
union all select 'transactions', source, count(*) from public.transactions group by 1,2
union all select 'journal_entries', source, count(*) from public.journal_entries group by 1,2
order by 1,2;

-- 5. Does eod_history hold anything company_price_history does not? (for 0044)
select (select count(*) from public.eod_history) as eod_rows,
       (select count(*) from public.eod_history e
          where not exists (select 1 from public.company_price_history c
                             where c.ticker = e.ticker and c.price_date = e.trade_date)) as unique_to_eod;

-- 6. Feature flags stored today must all exist in feature_keys after 0042.
select array_agg(distinct f order by f) as stored_flags
from public.profiles p, unnest(p.enabled_features) f;
