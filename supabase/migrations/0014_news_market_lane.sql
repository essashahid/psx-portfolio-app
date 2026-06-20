-- ---------------------------------------------------------------------------
-- News market lane
--
-- Until now news_articles only held holding-specific stories (every row was
-- tied to one ticker and discarded if it didn't match a holding). This adds a
-- second "market" lane for macro / policy / sector / international news that
-- moves the PSX even when it isn't about a single holding, plus the wider
-- category taxonomy and "interesting" flag the feed now uses.
-- ---------------------------------------------------------------------------

alter table public.news_articles
  -- 'portfolio' = about a specific holding | 'market' = macro/sector/index/world
  add column if not exists scope text not null default 'portfolio',
  -- holdings a market story plausibly touches (e.g. an oil-price move -> OGDC, PSO)
  add column if not exists impact_tickers text[],
  -- editor's-pick style flag for genuinely notable / unusual stories
  add column if not exists is_interesting boolean not null default false;

-- category now spans: company | earnings | dividend | policy | economy |
-- commodity | market | international | corporate_announcement | general
-- (kept as free text — no enum — so the classifier can evolve without a migration)

create index if not exists news_scope_idx on public.news_articles (user_id, scope, created_at desc);
create index if not exists news_interesting_idx on public.news_articles (user_id, is_interesting) where is_interesting;
