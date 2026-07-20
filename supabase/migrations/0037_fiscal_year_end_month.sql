-- Fiscal year end, captured during extraction from the balance sheet's audited
-- comparative heading ("Audited 30 June 2025" -> 6).
--
-- Needed because it cannot be recovered afterwards. Comparative rows inherit
-- the current filing's reported_date, so one filing writes both FY2026 and
-- FY2025 with the same date, and a March close filed in June is then
-- indistinguishable from a June close filed in June. Without this, deciding
-- which fiscal year an interim belongs to is guesswork — which is exactly how
-- Q1/Q2 rows came to be labelled a year early across 111 companies.
--
-- PSX fiscal years are labelled by the calendar year they END in, so with this
-- column the rule becomes checkable: a period is in fiscal year Y when its end
-- date falls on or before the year end in calendar year Y.

alter table company_metadata
  add column if not exists fiscal_year_end_month smallint
    check (fiscal_year_end_month between 1 and 12);

comment on column company_metadata.fiscal_year_end_month is
  'Calendar month (1-12) in which the company''s financial year ends, read from the balance sheet''s audited comparative column during extraction. June (6) and December (12) dominate on the PSX; March (3) and September (9) also occur.';
