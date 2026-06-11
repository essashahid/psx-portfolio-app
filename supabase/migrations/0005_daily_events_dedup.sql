-- ---------------------------------------------------------------------------
-- Daily Dividend + Events Engine: changelog + deduplication / reconciliation
-- ---------------------------------------------------------------------------

-- Deduplication / reconciliation flags on dividend events
alter table public.dividend_events
  add column if not exists is_possible_duplicate boolean not null default false;
alter table public.dividend_events
  add column if not exists duplicate_of uuid references public.dividend_events (id) on delete set null;
-- When a credited filing is matched to an already-recorded receipt in the
-- `dividends` ledger, we link it here so it is not counted as upcoming income.
alter table public.dividend_events
  add column if not exists reconciled_dividend_id uuid;

create index if not exists dividend_events_dupe_idx
  on public.dividend_events (user_id, is_possible_duplicate);

-- Daily "what changed" digest, one row per user per run date.
create table if not exists public.portfolio_changelog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_date date not null,
  -- Counts + human-readable highlights of what the daily job changed.
  summary jsonb not null default '{}',
  highlights text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, run_date)
);

create index if not exists portfolio_changelog_user_idx
  on public.portfolio_changelog (user_id, run_date desc);

-- RLS
alter table public.portfolio_changelog enable row level security;
create policy "portfolio_changelog_owner_select" on public.portfolio_changelog
  for select using (auth.uid() = user_id);
create policy "portfolio_changelog_owner_insert" on public.portfolio_changelog
  for insert with check (auth.uid() = user_id);
create policy "portfolio_changelog_owner_update" on public.portfolio_changelog
  for update using (auth.uid() = user_id);
create policy "portfolio_changelog_owner_delete" on public.portfolio_changelog
  for delete using (auth.uid() = user_id);
