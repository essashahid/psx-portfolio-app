-- ---------------------------------------------------------------------------
-- allocation_forecasts
-- Saved capital-allocation forecasts: the full computed payload (scenarios with
-- regime probabilities, recommended mix, outcome distributions, stress results,
-- layered backtest, confidence and narrative) stored as one jsonb document per
-- run, the same generate -> persist -> render shape as ai_briefings. User-scoped.
-- ---------------------------------------------------------------------------
create table public.allocation_forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  model text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index allocation_forecasts_user_idx on public.allocation_forecasts (user_id, created_at desc);

alter table public.allocation_forecasts enable row level security;
create policy "allocation_forecasts_owner_select" on public.allocation_forecasts for select using (auth.uid() = user_id);
create policy "allocation_forecasts_owner_insert" on public.allocation_forecasts for insert with check (auth.uid() = user_id);
create policy "allocation_forecasts_owner_delete" on public.allocation_forecasts for delete using (auth.uid() = user_id);
