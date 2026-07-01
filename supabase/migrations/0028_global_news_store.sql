-- ---------------------------------------------------------------------------
-- Global news store
--
-- Phase 2 separates market/news ingestion from per-user state:
--   news_sources              = global source registry + health metadata
--   global_news_articles      = deduplicated articles, once per URL
--   news_article_relevance    = user-specific relevance, save/hide, thesis data
--
-- The legacy news_articles table remains as a compatibility mirror for older
-- panels, alerts and briefs while the app is migrated screen by screen.
-- ---------------------------------------------------------------------------

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  source_type text not null check (source_type in ('feed', 'query')),
  name text not null,
  url text,
  query text,
  category text,
  asset_class text,
  tier text,
  jurisdiction text,
  region text,
  max_items integer not null default 5,
  enabled boolean not null default true,
  health_status text not null default 'unknown',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.global_news_articles (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  title text not null,
  source text,
  source_key text,
  source_id uuid references public.news_sources (id) on delete set null,
  published_at timestamptz,
  snippet text,
  provider text,
  scope text not null default 'market' check (scope in ('portfolio', 'market')),
  category text,
  source_quality text,
  ai_summary text,
  sentiment text,
  relevance_score integer,
  impact_tickers text[],
  is_interesting boolean not null default false,
  low_confidence boolean not null default false,
  event_key text,
  event_cluster_id text,
  materiality_score integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.news_article_relevance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null references public.global_news_articles (id) on delete cascade,
  ticker text,
  company_name text,
  sector text,
  ai_summary text,
  sentiment text,
  relevance_score integer,
  why_it_matters text,
  thesis_impact text,
  review_question text,
  link_reason text,
  low_confidence boolean not null default false,
  saved boolean not null default false,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, article_id)
);

create index if not exists global_news_published_idx on public.global_news_articles (published_at desc nulls last);
create index if not exists global_news_scope_idx on public.global_news_articles (scope, published_at desc nulls last);
create index if not exists global_news_source_key_idx on public.global_news_articles (source_key);
create index if not exists global_news_event_idx on public.global_news_articles (event_key) where event_key is not null;
create index if not exists news_relevance_user_idx on public.news_article_relevance (user_id, updated_at desc);
create index if not exists news_relevance_article_idx on public.news_article_relevance (article_id);
create index if not exists news_relevance_ticker_idx on public.news_article_relevance (user_id, ticker);

alter table public.news_sources enable row level security;
alter table public.global_news_articles enable row level security;
alter table public.news_article_relevance enable row level security;

drop policy if exists "news_sources_authenticated_select" on public.news_sources;
create policy "news_sources_authenticated_select" on public.news_sources
  for select using (auth.role() = 'authenticated');

drop policy if exists "global_news_authenticated_select" on public.global_news_articles;
create policy "global_news_authenticated_select" on public.global_news_articles
  for select using (auth.role() = 'authenticated');

drop policy if exists "news_relevance_owner_select" on public.news_article_relevance;
create policy "news_relevance_owner_select" on public.news_article_relevance
  for select using (auth.uid() = user_id);

drop policy if exists "news_relevance_owner_insert" on public.news_article_relevance;
create policy "news_relevance_owner_insert" on public.news_article_relevance
  for insert with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()));

drop policy if exists "news_relevance_owner_update" on public.news_article_relevance;
create policy "news_relevance_owner_update" on public.news_article_relevance
  for update using (auth.uid() = user_id and not public.is_demo_account(auth.uid()))
  with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()));

drop policy if exists "news_relevance_owner_delete" on public.news_article_relevance;
create policy "news_relevance_owner_delete" on public.news_article_relevance
  for delete using (auth.uid() = user_id and not public.is_demo_account(auth.uid()));

drop policy if exists "news_relevance_admin_all" on public.news_article_relevance;
create policy "news_relevance_admin_all" on public.news_article_relevance
  for all using (public.is_admin()) with check (public.is_admin());

-- Seed the DB registry with the same standing sources used by code. Runtime
-- refreshes upsert this list too, so future registry edits stay in sync.
insert into public.news_sources
  (key, source_type, name, url, query, category, asset_class, tier, jurisdiction, region, max_items)
values
  ('br-markets', 'feed', 'Business Recorder', 'https://www.brecorder.com/feeds/markets', null, 'market', 'equity', 'primary', 'PK', null, 14),
  ('br-business-finance', 'feed', 'Business Recorder', 'https://www.brecorder.com/feeds/business-finance', null, 'economy', 'macro', 'primary', 'PK', null, 12),
  ('br-pakistan', 'feed', 'Business Recorder', 'https://www.brecorder.com/feeds/pakistan', null, 'economy', 'macro', 'primary', 'PK', null, 8),
  ('br-world', 'feed', 'Business Recorder', 'https://www.brecorder.com/feeds/world', null, 'international', 'global', 'primary', 'PK', null, 6),
  ('dawn-business', 'feed', 'Dawn', 'https://www.dawn.com/feeds/business', null, 'economy', 'macro', 'primary', 'PK', null, 12),
  ('tribune-business', 'feed', 'The Express Tribune', 'https://tribune.com.pk/feed/business', null, 'market', 'equity', 'reputable', 'PK', null, 10),
  ('thenews-latest', 'feed', 'The News', 'https://www.thenews.com.pk/rss/1/1', null, 'general', 'macro', 'reputable', 'PK', null, 8),
  ('dj-markets', 'feed', 'Wall Street Journal', 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', null, 'international', 'global', 'primary', 'global', null, 6),
  ('cnbc-markets', 'feed', 'CNBC', 'https://www.cnbc.com/id/100003114/device/rss/rss.html', null, 'international', 'global', 'primary', 'global', null, 6),
  ('oilprice', 'feed', 'OilPrice', 'https://oilprice.com/rss/main', null, 'commodity', 'commodity', 'reputable', 'global', null, 6),
  ('coindesk', 'feed', 'CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/', null, 'crypto', 'crypto', 'reputable', 'global', null, 5),
  ('kse100', 'query', 'KSE-100 index', null, 'KSE-100 OR "Pakistan Stock Exchange" market', 'market', 'equity', 'aggregator', null, 'PK', 6),
  ('sbp', 'query', 'State Bank of Pakistan', null, '"State Bank of Pakistan" monetary policy OR interest rate OR policy rate', 'economy', 'macro', 'aggregator', null, 'PK', 5),
  ('inflation', 'query', 'Inflation & prices', null, 'Pakistan inflation OR CPI OR "sensitive price index"', 'economy', 'macro', 'aggregator', null, 'PK', 4),
  ('secp', 'query', 'SECP', null, 'SECP Pakistan regulation OR circular OR listing', 'regulatory', 'policy', 'aggregator', null, 'PK', 4),
  ('fbr', 'query', 'FBR / tax', null, 'FBR Pakistan tax OR revenue OR budget measures', 'regulatory', 'policy', 'aggregator', null, 'PK', 4),
  ('nepra-ogra', 'query', 'NEPRA / OGRA', null, 'NEPRA OR OGRA Pakistan tariff OR gas price OR electricity price', 'regulatory', 'policy', 'aggregator', null, 'PK', 4),
  ('imf-budget', 'query', 'IMF & budget', null, 'Pakistan IMF OR budget OR "finance bill" OR fiscal', 'policy', 'policy', 'aggregator', null, 'PK', 5),
  ('external', 'query', 'Reserves & remittances', null, 'Pakistan "forex reserves" OR remittances OR "current account"', 'economy', 'macro', 'aggregator', null, 'PK', 4),
  ('mufap', 'query', 'Mutual funds', null, 'MUFAP OR "mutual fund" Pakistan OR NAV OR "T-bill" OR "PIB auction"', 'funds', 'funds', 'aggregator', null, 'PK', 4),
  ('energy-pk', 'query', 'Energy & fuel', null, 'Pakistan petrol OR diesel OR "petroleum price" OR LNG OR gas', 'commodity', 'commodity', 'aggregator', null, 'PK', 4),
  ('gold', 'query', 'Gold & metals', null, 'gold price Pakistan OR international gold OR silver', 'commodity', 'commodity', 'aggregator', null, 'PK', 3),
  ('pkr', 'query', 'Rupee', null, 'PKR OR rupee dollar exchange rate Pakistan interbank', 'forex', 'forex', 'aggregator', null, 'PK', 3),
  ('global-macro', 'query', 'Global macro', null, 'Federal Reserve OR oil price OR global markets OR China economy', 'geopolitics', 'global', 'aggregator', null, 'global', 4)
on conflict (key) do update set
  source_type = excluded.source_type,
  name = excluded.name,
  url = excluded.url,
  query = excluded.query,
  category = excluded.category,
  asset_class = excluded.asset_class,
  tier = excluded.tier,
  jurisdiction = excluded.jurisdiction,
  region = excluded.region,
  max_items = excluded.max_items,
  updated_at = now();

-- Backfill deduped global articles from the legacy per-user rows.
insert into public.global_news_articles
  (url, title, source, published_at, snippet, provider, scope, category, source_quality,
   ai_summary, sentiment, relevance_score, impact_tickers, is_interesting, low_confidence,
   event_key, materiality_score, created_at, updated_at)
select distinct on (na.url)
  na.url,
  na.title,
  na.source,
  na.published_at,
  na.snippet,
  null,
  coalesce(na.scope, 'portfolio'),
  na.category,
  na.source_quality,
  na.ai_summary,
  na.sentiment,
  na.relevance_score,
  na.impact_tickers,
  coalesce(na.is_interesting, false),
  coalesce(na.low_confidence, false),
  lower(regexp_replace(coalesce(na.category, 'general') || ':' || left(na.title, 90), '[^a-zA-Z0-9]+', '-', 'g')),
  greatest(1, least(10, coalesce(na.relevance_score, 5))),
  na.created_at,
  now()
from public.news_articles na
where na.url is not null and na.title is not null
order by na.url, na.created_at desc
on conflict (url) do nothing;

insert into public.news_article_relevance
  (user_id, article_id, ticker, company_name, sector, ai_summary, sentiment,
   relevance_score, why_it_matters, thesis_impact, review_question, link_reason,
   low_confidence, saved, ignored, created_at, updated_at)
select
  na.user_id,
  ga.id,
  na.ticker,
  na.company_name,
  na.sector,
  na.ai_summary,
  na.sentiment,
  na.relevance_score,
  na.why_it_matters,
  na.thesis_impact,
  na.review_question,
  na.link_reason,
  coalesce(na.low_confidence, false),
  coalesce(na.saved, false),
  coalesce(na.ignored, false),
  na.created_at,
  now()
from public.news_articles na
join public.global_news_articles ga on ga.url = na.url
on conflict (user_id, article_id) do update set
  ticker = excluded.ticker,
  company_name = excluded.company_name,
  sector = excluded.sector,
  ai_summary = excluded.ai_summary,
  sentiment = excluded.sentiment,
  relevance_score = excluded.relevance_score,
  why_it_matters = excluded.why_it_matters,
  thesis_impact = excluded.thesis_impact,
  review_question = excluded.review_question,
  link_reason = excluded.link_reason,
  low_confidence = excluded.low_confidence,
  saved = public.news_article_relevance.saved or excluded.saved,
  ignored = public.news_article_relevance.ignored or excluded.ignored,
  updated_at = now();
