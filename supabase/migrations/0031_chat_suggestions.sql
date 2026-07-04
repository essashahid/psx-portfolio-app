-- Personalized Research Copilot suggestions, generated in the background by a
-- cheap model from the user's holdings, ledger activity, income calendar and
-- recent question history. The empty state reads this cache instantly; the
-- deterministic template pool remains the fallback when no row exists yet.

create table if not exists public.chat_suggestions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Ordered array of suggestion strings, already validated server-side.
  suggestions jsonb not null default '[]'::jsonb,
  -- Hash of the profile inputs that produced the pool, so regeneration can be
  -- skipped when nothing about the portfolio or question history changed.
  profile_hash text,
  model text,
  generated_at timestamptz not null default now(),
  constraint chat_suggestions_shape_check check (jsonb_typeof(suggestions) = 'array')
);

alter table public.chat_suggestions enable row level security;

drop policy if exists "chat_suggestions_owner_select" on public.chat_suggestions;
create policy "chat_suggestions_owner_select" on public.chat_suggestions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "chat_suggestions_owner_insert" on public.chat_suggestions;
create policy "chat_suggestions_owner_insert" on public.chat_suggestions
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "chat_suggestions_owner_update" on public.chat_suggestions;
create policy "chat_suggestions_owner_update" on public.chat_suggestions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
