-- Thumbnail support for the News Centre visual redesign. Populated going
-- forward from RSS media:content/media:thumbnail/enclosure tags where a
-- source publishes one (most Google News query results have none, so this
-- stays null for a large share of articles by design).
alter table global_news_articles add column if not exists image_url text;
alter table news_articles add column if not exists image_url text;
