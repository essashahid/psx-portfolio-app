-- Add unique constraint on (user_id, row_hash) for upsert deduplication.
-- The index already exists; convert it to a unique one.
drop index if exists public.dividends_hash_idx;
alter table public.dividends
  add constraint dividends_user_row_hash_unique unique (user_id, row_hash);
