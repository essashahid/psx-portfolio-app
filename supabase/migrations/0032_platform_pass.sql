-- ---------------------------------------------------------------------------
-- Platform pass: persisted news clusters + profile prefs
--
--   news_event_clusters  = one row per de-duplicated news event (event_key),
--                          so the dashboard, stock page and news feed can read
--                          a shared, compressed "N articles about one story"
--                          view instead of re-clustering per request.
--   profiles.prefs       = jsonb bag for lightweight per-user UI state:
--                          dismissed dashboard checks, per-surface last-seen
--                          timestamps. Kept out of dedicated columns because it
--                          is small, sparse and only read by the owner.
-- ---------------------------------------------------------------------------

create table if not exists public.news_event_clusters (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  category text,
  ticker text,
  title text not null,
  url text,
  materiality_score integer not null default 0,
  article_count integer not null default 1,
  impact_tickers text[],
  scope text not null default 'market',
  first_published_at timestamptz,
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists news_clusters_recent_idx on public.news_event_clusters (last_published_at desc nulls last);
create index if not exists news_clusters_ticker_idx on public.news_event_clusters (ticker) where ticker is not null;
create index if not exists news_clusters_category_idx on public.news_event_clusters (category, last_published_at desc nulls last);

alter table public.news_event_clusters enable row level security;

drop policy if exists "news_clusters_authenticated_select" on public.news_event_clusters;
create policy "news_clusters_authenticated_select" on public.news_event_clusters
  for select using (auth.role() = 'authenticated');

drop policy if exists "news_clusters_admin_all" on public.news_event_clusters;
create policy "news_clusters_admin_all" on public.news_event_clusters
  for all using (public.is_admin()) with check (public.is_admin());

-- Recompute clusters from the shared article store in a single statement. Runs
-- once per refresh cycle (cron and user-triggered), not per user, so article
-- counts stay correct without incremental double-counting. Idempotent by
-- event_key; safe to call repeatedly and from the backfill script.
create or replace function public.sync_news_clusters(p_since timestamptz default now() - interval '45 days')
returns integer
language sql
security definer
set search_path = public
as $$
  with agg as (
    select
      event_key,
      (array_agg(category order by coalesce(published_at, created_at) desc))[1] as category,
      (array_agg(title order by coalesce(published_at, created_at) desc))[1] as title,
      (array_agg(url order by coalesce(published_at, created_at) desc))[1] as url,
      (array_agg(scope order by coalesce(published_at, created_at) desc))[1] as scope,
      -- Representative ticker: the newest row's first impact ticker. Aggregating
      -- the array column directly yields a 2D array, so pull the scalar first.
      (array_agg((impact_tickers)[1] order by coalesce(published_at, created_at) desc)
        filter (where impact_tickers is not null and (impact_tickers)[1] is not null))[1] as ticker,
      (array_agg(distinct (impact_tickers)[1])
        filter (where impact_tickers is not null and (impact_tickers)[1] is not null)) as impact_tickers,
      max(coalesce(materiality_score, 0)) as materiality_score,
      count(*)::int as article_count,
      min(published_at) as first_published_at,
      max(published_at) as last_published_at
    from public.global_news_articles
    where event_key is not null
      and coalesce(published_at, created_at) >= p_since
    group by event_key
  ), upserted as (
    insert into public.news_event_clusters as c
      (event_key, category, ticker, title, url, materiality_score, article_count,
       impact_tickers, scope, first_published_at, last_published_at, updated_at)
    select
      event_key, category, ticker,
      title, url, materiality_score, article_count, impact_tickers,
      coalesce(scope, 'market'), first_published_at, last_published_at, now()
    from agg
    on conflict (event_key) do update set
      category = excluded.category,
      ticker = excluded.ticker,
      title = excluded.title,
      url = excluded.url,
      materiality_score = greatest(c.materiality_score, excluded.materiality_score),
      article_count = excluded.article_count,
      impact_tickers = excluded.impact_tickers,
      scope = excluded.scope,
      first_published_at = least(coalesce(c.first_published_at, excluded.first_published_at), excluded.first_published_at),
      last_published_at = greatest(coalesce(c.last_published_at, excluded.last_published_at), excluded.last_published_at),
      updated_at = now()
    returning 1
  )
  select count(*)::int from upserted;
$$;

grant execute on function public.sync_news_clusters(timestamptz) to authenticated, service_role;

-- Per-user UI preferences. Owner reads/writes only; demo account is read-only
-- and simply never persists, matching the other profile-scoped policies.
alter table public.profiles
  add column if not exists prefs jsonb not null default '{}'::jsonb;
