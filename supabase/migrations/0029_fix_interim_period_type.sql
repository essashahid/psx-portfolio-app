-- ---------------------------------------------------------------------------
-- Fix interim results mis-tagged as annual.
--
-- The financials ingest only distinguished "annual" vs "quarterly", so nine-
-- month (9M) and half-year (H1) cumulative results were sometimes stored with
-- period_type 'annual'. The earnings/financials workspaces classify by
-- period_type, so those rows rendered as a duplicate FY bar (e.g. two "FY2025"
-- columns) and skewed the year-over-year comparison.
--
-- This normalises period_type to match the specific fiscal_period. Where an
-- interim period exists under more than one period_type tag, we keep the most
-- complete row (a real reported_date + source link + higher confidence) and
-- drop the rest so the unique constraint still holds after the re-tag.
-- ---------------------------------------------------------------------------

begin;

-- 1. Collapse duplicate (ticker, fiscal_year, fiscal_period, statement_type)
--    groups that differ only by period_type, keeping the best-sourced row.
delete from public.company_financials c
using (
  select id,
         row_number() over (
           partition by ticker, fiscal_year, upper(fiscal_period), statement_type
           order by (reported_date is not null) desc,
                    (source_url is not null) desc,
                    coalesce(confidence, 0) desc,
                    updated_at desc nulls last
         ) as rn
  from public.company_financials
  where upper(coalesce(fiscal_period, '')) in ('Q1', 'Q2', 'Q3', 'Q4', 'H1', '9M')
) dups
where c.id = dups.id
  and dups.rn > 1;

-- 2. Re-tag the surviving interim rows to the canonical period_type.
update public.company_financials
set period_type = 'quarterly'
where upper(coalesce(fiscal_period, '')) in ('Q1', 'Q2', 'Q3', 'Q4')
  and period_type <> 'quarterly';

update public.company_financials
set period_type = 'cumulative'
where upper(coalesce(fiscal_period, '')) in ('H1', '9M')
  and period_type <> 'cumulative';

commit;
