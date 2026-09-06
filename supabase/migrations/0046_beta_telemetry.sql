-- Beta instrumentation: product events, client errors, and request counters.
--
-- app_events answers the beta questions (do users add a portfolio, manual or
-- import, web or phone, which pages, what they ask). Rows are written by the
-- server with the service role; a user may read their own, admins read all.
--
-- client_errors is first-party error reporting for web and phone. There is
-- no external error vendor in this project and none is required for a
-- 30-person beta; the admin page lists what broke and for whom.
--
-- request_counters backs a fixed-window rate limit that works across
-- serverless instances (an in-memory counter does not). bump_counter() is
-- atomic: one round trip returns the count after the increment.

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  visitor_id text,
  surface text not null check (surface in ('web', 'mobile')),
  name text not null check (char_length(name) between 2 and 64),
  path text,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_events_user_created_idx on public.app_events (user_id, created_at desc);
create index if not exists app_events_name_created_idx on public.app_events (name, created_at desc);
alter table public.app_events enable row level security;
drop policy if exists "app_events own read" on public.app_events;
create policy "app_events own read" on public.app_events for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  surface text not null check (surface in ('web', 'mobile')),
  message text not null check (char_length(message) between 1 and 2000),
  stack text,
  path text,
  user_agent text,
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
drop policy if exists "client_errors admin read" on public.client_errors;
create policy "client_errors admin read" on public.client_errors for select to authenticated
  using (public.is_admin());

create table if not exists public.request_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.request_counters enable row level security;

create or replace function public.bump_counter(p_key text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.request_counters (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.request_counters.count + 1
  returning count into v_count;
  -- Keep the table small: anything older than a day is noise.
  delete from public.request_counters where window_start < now() - interval '1 day' and random() < 0.01;
  return v_count;
end;
$$;
revoke all on function public.bump_counter(text, integer) from public;
grant execute on function public.bump_counter(text, integer) to service_role;

-- Rollback
-- --------
-- drop function if exists public.bump_counter(text, integer);
-- drop table if exists public.request_counters;
-- drop table if exists public.client_errors;
-- drop table if exists public.app_events;
