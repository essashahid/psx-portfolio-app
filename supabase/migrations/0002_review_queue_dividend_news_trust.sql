-- ---------------------------------------------------------------------------
-- Dividend Tracker Lite + news trust metadata
-- ---------------------------------------------------------------------------

alter table public.dividends
  add column if not exists company_name text,
  add column if not exists announcement_date date,
  add column if not exists ex_date date,
  add column if not exists payment_date date,
  add column if not exists dividend_per_share numeric,
  add column if not exists quantity_held numeric,
  add column if not exists status text not null default 'received';

update public.dividends
set
  payment_date = coalesce(payment_date, pay_date),
  quantity_held = coalesce(quantity_held, case when dividend_per_share is not null and dividend_per_share <> 0 then amount / dividend_per_share else null end),
  status = coalesce(status, 'received')
where true;

create index if not exists dividends_status_idx on public.dividends (user_id, status);
create index if not exists dividends_payment_idx on public.dividends (user_id, payment_date desc);

alter table public.news_articles
  add column if not exists source_quality text,
  add column if not exists link_reason text,
  add column if not exists low_confidence boolean not null default false;

update public.news_articles
set
  low_confidence = coalesce(low_confidence, false) or coalesce(relevance_score, 0) <= 3,
  source_quality = coalesce(source_quality, 'unknown'),
  link_reason = coalesce(link_reason, why_it_matters)
where true;

create index if not exists news_low_confidence_idx on public.news_articles (user_id, low_confidence);
