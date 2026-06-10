-- PortfolioOS PK — initial schema
-- Every user-owned table has user_id + RLS. Users can only access their own rows.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  base_currency text not null default 'PKR',
  cost_basis_method text not null default 'weighted_average',
  manual_price_mode boolean not null default true,
  demo_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profiles_select" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- stock_master (shared reference data, readable by all authenticated users)
-- ---------------------------------------------------------------------------
create table public.stock_master (
  ticker text primary key,
  company_name text not null,
  sector text,
  created_at timestamptz not null default now()
);

alter table public.stock_master enable row level security;
create policy "stock_master_read" on public.stock_master for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- broker_accounts
-- ---------------------------------------------------------------------------
create table public.broker_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  broker_type text not null default 'OTHER', -- AKD | CDC | OTHER
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- uploaded_statements
-- ---------------------------------------------------------------------------
create table public.uploaded_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  broker_account_id uuid references public.broker_accounts (id) on delete set null,
  file_name text not null,
  file_type text not null,            -- csv | xlsx | pdf
  file_hash text not null,
  storage_path text,
  statement_type text,                -- holdings | trades | dividends | generic
  status text not null default 'uploaded', -- uploaded | previewed | committed | rejected
  created_at timestamptz not null default now()
);

create index uploaded_statements_user_idx on public.uploaded_statements (user_id);
create index uploaded_statements_hash_idx on public.uploaded_statements (user_id, file_hash);

-- ---------------------------------------------------------------------------
-- import_batches
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  statement_id uuid references public.uploaded_statements (id) on delete cascade,
  statement_type text not null default 'generic',
  status text not null default 'preview', -- preview | committed | discarded
  total_rows int not null default 0,
  accepted_rows int not null default 0,
  rejected_rows int not null default 0,
  duplicate_rows int not null default 0,
  mapping jsonb,
  summary jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create index import_batches_user_idx on public.import_batches (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- import_rows
-- ---------------------------------------------------------------------------
create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_index int not null,
  raw jsonb not null,
  normalized jsonb,
  row_hash text,
  status text not null default 'pending', -- pending | valid | warning | invalid | duplicate | committed | excluded
  issues text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index import_rows_batch_idx on public.import_rows (batch_id);
create index import_rows_user_hash_idx on public.import_rows (user_id, row_hash);

-- ---------------------------------------------------------------------------
-- holdings
-- ---------------------------------------------------------------------------
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  company_name text,
  sector text,
  quantity numeric not null default 0,
  avg_cost numeric not null default 0,
  total_cost numeric not null default 0,
  source text not null default 'manual', -- manual | statement_snapshot | transactions | demo
  notes text,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create index holdings_user_idx on public.holdings (user_id);
create index holdings_ticker_idx on public.holdings (user_id, ticker);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid references public.import_batches (id) on delete set null,
  ticker text not null,
  trade_date date,
  settlement_date date,
  type text not null default 'UNKNOWN', -- BUY SELL DIVIDEND CASH_IN CASH_OUT FEE TAX BONUS RIGHT SPLIT UNKNOWN
  quantity numeric,
  price numeric,
  gross_amount numeric,
  commission numeric,
  tax numeric,
  net_amount numeric,
  realized_pl numeric,
  row_hash text,
  source text not null default 'import', -- import | manual | demo
  notes text,
  created_at timestamptz not null default now()
);

create index transactions_user_idx on public.transactions (user_id, trade_date desc);
create index transactions_ticker_idx on public.transactions (user_id, ticker);
create index transactions_hash_idx on public.transactions (user_id, row_hash);

-- ---------------------------------------------------------------------------
-- dividends
-- ---------------------------------------------------------------------------
create table public.dividends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid references public.import_batches (id) on delete set null,
  ticker text,
  pay_date date,
  amount numeric not null,
  tax numeric,
  net_amount numeric,
  row_hash text,
  source text not null default 'import',
  notes text,
  created_at timestamptz not null default now()
);

create index dividends_user_idx on public.dividends (user_id, pay_date desc);
create index dividends_ticker_idx on public.dividends (user_id, ticker);
create index dividends_hash_idx on public.dividends (user_id, row_hash);

-- ---------------------------------------------------------------------------
-- cash_movements
-- ---------------------------------------------------------------------------
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid references public.import_batches (id) on delete set null,
  movement_date date,
  type text not null default 'UNKNOWN', -- CASH_IN | CASH_OUT | FEE | TAX | DIVIDEND
  amount numeric not null,
  description text,
  row_hash text,
  source text not null default 'import',
  created_at timestamptz not null default now()
);

create index cash_movements_user_idx on public.cash_movements (user_id, movement_date desc);
create index cash_movements_hash_idx on public.cash_movements (user_id, row_hash);

-- ---------------------------------------------------------------------------
-- prices (user-scoped so manual mode works; an external provider can upsert too)
-- ---------------------------------------------------------------------------
create table public.prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  price numeric not null,
  price_date date not null default current_date,
  source text not null default 'manual', -- manual | statement | provider | demo
  created_at timestamptz not null default now(),
  unique (user_id, ticker, price_date)
);

create index prices_user_ticker_idx on public.prices (user_id, ticker, price_date desc);

-- ---------------------------------------------------------------------------
-- portfolio_snapshots
-- ---------------------------------------------------------------------------
create table public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_date date not null default current_date,
  total_value numeric not null default 0,
  total_cost numeric not null default 0,
  unrealized_pl numeric not null default 0,
  data jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

create index portfolio_snapshots_user_idx on public.portfolio_snapshots (user_id, snapshot_date desc);

-- ---------------------------------------------------------------------------
-- targets
-- ---------------------------------------------------------------------------
create table public.targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  target_price numeric,
  target_allocation numeric, -- percent of portfolio
  review_level numeric,      -- price at/below which the position needs review
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create index targets_user_idx on public.targets (user_id, ticker);

-- ---------------------------------------------------------------------------
-- theses
-- ---------------------------------------------------------------------------
create table public.theses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  why_bought text,
  expectation text,
  time_horizon text,
  key_risks text,
  sell_conditions text,
  add_conditions text,
  confidence int check (confidence between 1 and 5),
  status text not null default 'Active', -- Active | Watch | Weakening | Broken | Closed
  review_date date,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create index theses_user_idx on public.theses (user_id, ticker);
create index theses_review_idx on public.theses (user_id, review_date);

-- ---------------------------------------------------------------------------
-- journal_entries
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text,
  entry_date date not null default current_date,
  entry_type text not null default 'general_note',
  -- buy_decision | sell_decision | hold_review | news_reaction | result_review | dividend_review | general_note
  title text not null,
  body text,
  expected_outcome text,
  risk text,
  confidence int check (confidence between 1 and 5),
  follow_up_date date,
  outcome text,
  lessons text,
  source text not null default 'manual', -- manual | ai | demo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index journal_user_idx on public.journal_entries (user_id, entry_date desc);
create index journal_ticker_idx on public.journal_entries (user_id, ticker);

-- ---------------------------------------------------------------------------
-- news_articles
-- ---------------------------------------------------------------------------
create table public.news_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text,
  company_name text,
  sector text,
  title text not null,
  url text not null,
  source text,
  published_at timestamptz,
  snippet text,
  ai_summary text,
  sentiment text,        -- positive | neutral | negative
  relevance_score int,   -- 1-10
  why_it_matters text,
  thesis_impact text,
  review_question text,
  category text,         -- dividend | result | general
  saved boolean not null default false,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create index news_user_idx on public.news_articles (user_id, created_at desc);
create index news_ticker_idx on public.news_articles (user_id, ticker);
create index news_published_idx on public.news_articles (user_id, published_at desc);

-- ---------------------------------------------------------------------------
-- ai_briefings
-- ---------------------------------------------------------------------------
create table public.ai_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  briefing_type text not null default 'daily',
  -- daily | weekly | risk_review | thesis_review | news_only | dividend_review | journal_analysis | stock_review
  ticker text,
  title text,
  content text not null,
  model text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index ai_briefings_user_idx on public.ai_briefings (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- alerts
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text,
  alert_type text not null,
  -- price_above_target | price_below_review | allocation_above_target | allocation_below_target |
  -- missing_thesis | review_due | negative_news | dividend_news | result_news | concentration_risk | import_issue
  severity text not null default 'info', -- info | warning | critical
  title text not null,
  message text,
  dedupe_key text not null,
  status text not null default 'open', -- open | dismissed | resolved
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index alerts_user_idx on public.alerts (user_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- import_mappings (saved column mappings)
-- ---------------------------------------------------------------------------
create table public.import_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  statement_type text not null default 'generic',
  mapping jsonb not null,
  created_at timestamptz not null default now()
);

create index import_mappings_user_idx on public.import_mappings (user_id);

-- ---------------------------------------------------------------------------
-- agent_runs (audit log of AI/news jobs)
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_type text not null, -- news_refresh | briefing | thesis_check | journal_analysis | stock_action | alerts_refresh
  status text not null default 'running', -- running | success | error
  input jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index agent_runs_user_idx on public.agent_runs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: owner-only policies for every user-owned table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'broker_accounts','uploaded_statements','import_batches','import_rows',
    'holdings','transactions','dividends','cash_movements','prices',
    'portfolio_snapshots','targets','theses','journal_entries','news_articles',
    'ai_briefings','alerts','import_mappings','agent_runs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s_owner_select" on public.%I for select using (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_owner_insert" on public.%I for insert with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_owner_update" on public.%I for update using (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_owner_delete" on public.%I for delete using (auth.uid() = user_id)', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for uploaded statements, path-scoped per user
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('statements', 'statements', false)
on conflict (id) do nothing;

create policy "statements_owner_read" on storage.objects
  for select using (bucket_id = 'statements' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "statements_owner_insert" on storage.objects
  for insert with check (bucket_id = 'statements' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "statements_owner_delete" on storage.objects
  for delete using (bucket_id = 'statements' and auth.uid()::text = (storage.foldername(name))[1]);
