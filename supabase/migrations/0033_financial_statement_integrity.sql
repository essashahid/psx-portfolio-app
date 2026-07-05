-- ---------------------------------------------------------------------------
-- Financial statement integrity pass
--
-- Stops the two silent overwrite classes that corrupted fundamentals:
--   1. consolidated and unconsolidated rows now occupy distinct identities
--   2. portal and filing rows now occupy distinct identities
--
-- Also adds durable raw observations, revision history, and a fundamentals
-- conflict queue so re-extractions/restatements are reviewable instead of
-- overwriting published rows without evidence.
-- ---------------------------------------------------------------------------

begin;

alter table public.company_financials
  add column if not exists reporting_basis text,
  add column if not exists review_status text,
  add column if not exists validation_flags jsonb not null default '[]'::jsonb,
  add column if not exists selected_observation_id uuid;

update public.company_financials
set source_type = coalesce(nullif(source_type, ''), 'unknown')
where source_type is null or source_type = '';

alter table public.company_financials
  alter column source_type set default 'unknown',
  alter column source_type set not null;

update public.company_financials
set reporting_basis = case
  when lower(coalesce(data->>'_basis', '')) in ('consolidated', 'group') then 'consolidated'
  when lower(coalesce(data->>'_basis', '')) in ('unconsolidated', 'standalone', 'separate', 'separate financial statements') then 'unconsolidated'
  when lower(coalesce(data->>'_basis', '')) in ('not_applicable', 'not applicable', 'n/a') then 'not_applicable'
  else 'unlabelled'
end
where reporting_basis is null or reporting_basis = '';

update public.company_financials
set review_status = 'published'
where review_status is null or review_status = '';

alter table public.company_financials
  alter column reporting_basis set default 'unlabelled',
  alter column reporting_basis set not null,
  alter column review_status set default 'published',
  alter column review_status set not null;

do $$
declare
  old_constraint text;
begin
  select c.conname into old_constraint
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'company_financials'
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by u.ord)
      from unnest(c.conkey) with ordinality as u(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
    ) = array['ticker','period_type','fiscal_year','fiscal_period','statement_type'];

  if old_constraint is not null then
    execute format('alter table public.company_financials drop constraint %I', old_constraint);
  end if;
end $$;

alter table public.company_financials
  drop constraint if exists company_financials_basis_check,
  drop constraint if exists company_financials_review_status_check,
  drop constraint if exists company_financials_identity_key;

create table if not exists public.financial_statement_observations (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  period_type text not null,
  fiscal_year int,
  fiscal_period text,
  statement_type text not null,
  reporting_basis text not null default 'unlabelled'
    check (reporting_basis in ('consolidated', 'unconsolidated', 'unlabelled', 'not_applicable')),
  source_type text not null,
  source_url text,
  source_fingerprint text not null,
  reported_date date,
  data jsonb not null default '{}'::jsonb,
  confidence numeric,
  extractor text,
  validation_flags jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique nulls not distinct (
    ticker, period_type, fiscal_year, fiscal_period,
    statement_type, reporting_basis, source_type, source_fingerprint
  )
);

create index if not exists financial_observations_identity_idx
  on public.financial_statement_observations (
    ticker, period_type, fiscal_year, fiscal_period,
    statement_type, reporting_basis, source_type
  );

create index if not exists financial_observations_recent_idx
  on public.financial_statement_observations (ticker, observed_at desc);

alter table public.financial_statement_observations enable row level security;

drop policy if exists "financial_observations_read" on public.financial_statement_observations;
create policy "financial_observations_read" on public.financial_statement_observations
  for select to authenticated using (true);

drop policy if exists "financial_observations_admin_all" on public.financial_statement_observations;
create policy "financial_observations_admin_all" on public.financial_statement_observations
  for all using (public.is_admin()) with check (public.is_admin());

insert into public.financial_statement_observations (
  ticker, period_type, fiscal_year, fiscal_period, statement_type,
  reporting_basis, source_type, source_url, source_fingerprint,
  reported_date, data, confidence, extractor, observed_at, created_at
)
select
  ticker, period_type, fiscal_year, fiscal_period, statement_type,
  reporting_basis, source_type, source_url,
  coalesce(nullif(source_url, '') || ':legacy:' || id::text, 'legacy:' || id::text),
  reported_date, data, confidence,
  nullif(data->>'_extractor', ''),
  coalesce(updated_at, created_at, now()),
  coalesce(created_at, now())
from public.company_financials
on conflict do nothing;

update public.company_financials cf
set selected_observation_id = o.id
from public.financial_statement_observations o
where cf.selected_observation_id is null
  and o.ticker = cf.ticker
  and o.period_type = cf.period_type
  and o.fiscal_year is not distinct from cf.fiscal_year
  and o.fiscal_period is not distinct from cf.fiscal_period
  and o.statement_type = cf.statement_type
  and o.reporting_basis = cf.reporting_basis
  and o.source_type = cf.source_type
  and o.source_fingerprint = coalesce(nullif(cf.source_url, '') || ':legacy:' || cf.id::text, 'legacy:' || cf.id::text);

delete from public.company_financials c
using (
  select id,
         row_number() over (
           partition by ticker, period_type, fiscal_year, fiscal_period,
                        statement_type, reporting_basis, source_type
           order by (review_status = 'published') desc,
                    (reported_date is not null) desc,
                    (source_url is not null) desc,
                    coalesce(confidence, 0) desc,
                    updated_at desc nulls last,
                    created_at desc nulls last
         ) as rn
  from public.company_financials
) dups
where c.id = dups.id
  and dups.rn > 1;

alter table public.company_financials
  add constraint company_financials_basis_check
    check (reporting_basis in ('consolidated', 'unconsolidated', 'unlabelled', 'not_applicable')),
  add constraint company_financials_review_status_check
    check (review_status in ('published', 'needs_review', 'rejected', 'superseded')),
  add constraint company_financials_identity_key
    unique nulls not distinct (
      ticker, period_type, fiscal_year, fiscal_period,
      statement_type, reporting_basis, source_type
    );

create index if not exists company_financials_published_idx
  on public.company_financials (ticker, statement_type, fiscal_year desc, fiscal_period)
  where review_status = 'published';

create index if not exists company_financials_basis_source_idx
  on public.company_financials (ticker, reporting_basis, source_type, reported_date desc);

alter table public.company_financials
  drop constraint if exists company_financials_selected_observation_fk,
  add constraint company_financials_selected_observation_fk
    foreign key (selected_observation_id)
    references public.financial_statement_observations(id)
    on delete set null;

create table if not exists public.company_financial_revisions (
  id uuid primary key default gen_random_uuid(),
  financial_id uuid,
  ticker text not null,
  period_type text not null,
  fiscal_year int,
  fiscal_period text,
  statement_type text not null,
  reporting_basis text not null,
  source_type text not null,
  operation text not null check (operation in ('update', 'delete')),
  old_row jsonb not null,
  new_row jsonb,
  changed_at timestamptz not null default now()
);

create index if not exists company_financial_revisions_identity_idx
  on public.company_financial_revisions (ticker, statement_type, changed_at desc);

alter table public.company_financial_revisions enable row level security;

drop policy if exists "company_financial_revisions_read" on public.company_financial_revisions;
create policy "company_financial_revisions_read" on public.company_financial_revisions
  for select to authenticated using (true);

drop policy if exists "company_financial_revisions_admin_all" on public.company_financial_revisions;
create policy "company_financial_revisions_admin_all" on public.company_financial_revisions
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.record_company_financial_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(old) - 'updated_at') is distinct from (to_jsonb(new) - 'updated_at') then
      insert into public.company_financial_revisions (
        financial_id, ticker, period_type, fiscal_year, fiscal_period,
        statement_type, reporting_basis, source_type, operation, old_row, new_row
      )
      values (
        old.id, old.ticker, old.period_type, old.fiscal_year, old.fiscal_period,
        old.statement_type, old.reporting_basis, old.source_type, 'update',
        to_jsonb(old), to_jsonb(new)
      );
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.company_financial_revisions (
      financial_id, ticker, period_type, fiscal_year, fiscal_period,
      statement_type, reporting_basis, source_type, operation, old_row
    )
    values (
      old.id, old.ticker, old.period_type, old.fiscal_year, old.fiscal_period,
      old.statement_type, old.reporting_basis, old.source_type, 'delete',
      to_jsonb(old)
    );
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists company_financial_revision_audit on public.company_financials;
create trigger company_financial_revision_audit
before update or delete on public.company_financials
for each row execute function public.record_company_financial_revision();

create table if not exists public.financial_statement_conflicts (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  ticker text not null,
  period_type text not null,
  fiscal_year int,
  fiscal_period text,
  statement_type text not null,
  reporting_basis text not null,
  new_source_type text not null,
  existing_source_type text,
  new_source_url text,
  existing_source_url text,
  conflict_type text not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  differences jsonb not null default '[]'::jsonb,
  observed_row jsonb not null,
  existing_row jsonb,
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index if not exists financial_conflicts_open_idx
  on public.financial_statement_conflicts (status, severity, created_at desc);

create index if not exists financial_conflicts_ticker_idx
  on public.financial_statement_conflicts (ticker, status, created_at desc);

alter table public.financial_statement_conflicts enable row level security;

drop policy if exists "financial_conflicts_read" on public.financial_statement_conflicts;
create policy "financial_conflicts_read" on public.financial_statement_conflicts
  for select to authenticated using (true);

drop policy if exists "financial_conflicts_admin_all" on public.financial_statement_conflicts;
create policy "financial_conflicts_admin_all" on public.financial_statement_conflicts
  for all using (public.is_admin()) with check (public.is_admin());

commit;
