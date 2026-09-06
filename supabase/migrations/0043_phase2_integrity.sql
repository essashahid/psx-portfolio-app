-- Applied to production on 6 September 2026 (Phase 3): preflight showed 0 duplicates on every key.
-- Phase 2: data integrity.
--
-- Everything here is additive. No column is dropped, no row is deleted or
-- rewritten, and each section names the preflight that justified it. The
-- preflight was run against production on 6 September 2026; the counts are
-- recorded so a re-run can be compared against them.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Ledger deduplication
--
-- transactions and cash_movements carry a row_hash that import dedupes on, but
-- only with a plain index. Dedup is a read-then-insert in lib/import/commit.ts,
-- so two concurrent commits of the same statement, or one retried serverless
-- invocation, both pass the check and both insert. dividends got the database
-- constraint in migration 0003; these two never did.
--
-- Preflight: transactions 266 rows, 0 duplicate (user_id,row_hash) groups,
-- 0 null hashes. cash_movements 95 rows, 0 duplicate groups, 0 null hashes.
-- Nothing to clean up, so these constraints apply against clean data.
--
-- Note on NULL: a null row_hash does not collide under a unique constraint, so
-- manually entered rows without a hash stay unaffected.

alter table public.transactions
  add constraint transactions_user_row_hash_key unique (user_id, row_hash);

alter table public.cash_movements
  add constraint cash_movements_user_row_hash_key unique (user_id, row_hash);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. company_payouts uniqueness
--
-- The key from migration 0010 is unique (ticker, raw, announcement_date) with
-- both raw and announcement_date nullable, and default NULLS DISTINCT. Any
-- payout arriving without a parsed announcement date therefore bypasses the
-- constraint entirely, and the daily upsert in lib/market/payouts.ts would
-- accumulate a fresh copy on every run. That inflates trailing-twelve-month
-- yield, payout and cover for the affected company.
--
-- Preflight: 565 rows, 0 null announcement_date, 0 null raw, 0 duplicates under
-- either NULLS DISTINCT or NULLS NOT DISTINCT. The hole is real but has not yet
-- been fallen into, so this closes it with no rows to reconcile.

alter table public.company_payouts
  drop constraint if exists company_payouts_ticker_raw_announcement_date_key;

alter table public.company_payouts
  add constraint company_payouts_identity_key
  unique nulls not distinct (ticker, raw, announcement_date);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. updated_at maintenance
--
-- Every updated_at and last_updated column in the schema is `default now()`
-- and nothing bumps it on update, so the value is only correct when the
-- writing code remembers to set it. lib/market/payouts.ts is the proof: its
-- upsert never sets updated_at, so on conflict the column keeps its original
-- insert time. Every staleness decision built on these columns is therefore
-- unreliable.
--
-- Preflight: 25 tables carry one of the two columns; 24 have no trigger.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_last_updated()
returns trigger
language plpgsql
as $$
begin
  new.last_updated = now();
  return new;
end;
$$;

do $$
declare
  t text;
  -- Tables whose freshness column should track the last write.
  updated_at_tables text[] := array[
    'chat_threads', 'company_payouts', 'company_price_history', 'company_technicals',
    'data_provider_status', 'dividend_events', 'foreign_flow_days', 'global_news_articles',
    'journal_entries', 'macro_asset_history', 'news_article_relevance', 'news_event_clusters',
    'news_sources', 'product_feedback', 'profiles', 'targets', 'tax_settings', 'theses',
    'waitlist_entries'
  ];
  last_updated_tables text[] := array[
    'company_metadata', 'holdings', 'stock_universe'
  ];
begin
  foreach t in array updated_at_tables loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array last_updated_tables loop
    execute format('drop trigger if exists set_last_updated on public.%I', t);
    execute format(
      'create trigger set_last_updated before update on public.%I
         for each row execute function public.set_last_updated()', t);
  end loop;
end $$;

-- Deliberately excluded, and why:
--
--   company_financials     already carries the revision audit trigger from
--                          migration 0033, which compares old and new rows and
--                          explicitly ignores updated_at. A second BEFORE
--                          UPDATE trigger on the same table would fire in name
--                          order alongside it; the audit is the more valuable
--                          of the two, and it is not worth risking for a
--                          timestamp its own write path already maintains.
--   eod_history            superseded by company_price_history (see 0044).
--   market_snapshot_items  append-only. Its last_updated belongs to the
--                          snapshot that produced the row, not to a later edit.

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Referential integrity
--
-- dividend_events.duplicate_of has had a foreign key since migration 0005;
-- reconciled_dividend_id, added in the same migration two lines below it,
-- never got one.
--
-- Preflight: 1 row has reconciled_dividend_id set, 0 orphans.

alter table public.dividend_events
  add constraint dividend_events_reconciled_dividend_id_fkey
  foreign key (reconciled_dividend_id) references public.dividends(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Source enums
--
-- These columns are free text with the allowed values written only in a
-- comment, and lib/demo/seed.ts deletes demo data with .eq("source","demo"),
-- so a typo there orphans rows permanently.
--
-- Preflight found values the comments do not mention, which is exactly why the
-- constraints are built from what is actually stored rather than from the
-- documentation:
--
--   holdings         demo 8, transactions 130
--   transactions     adjustment 112, email_confirmation 21, import 129, manual 4
--   journal_entries  demo 5
--   prices           demo 112, psx-dps 5459, statement 4
--
-- A constraint written from the 0001 comments would have rejected 133
-- transactions and 5,459 prices on sight.
--
-- prices is deliberately left unconstrained. Its values are provider names, and
-- the provider list grows: psx-dps and terminal are in the code today, with
-- twelve-data, finnhub and alpha-vantage behind adapters. A closed list there
-- would be the same brittleness the feature CHECK had, and would break a price
-- refresh rather than catch a typo. Null passes every CHECK below, so rows
-- written without a source are unaffected.

alter table public.holdings
  add constraint holdings_source_check
  check (source in ('manual', 'statement_snapshot', 'transactions', 'demo'));

alter table public.transactions
  add constraint transactions_source_check
  check (source in ('import', 'manual', 'demo', 'adjustment', 'email_confirmation'));

alter table public.journal_entries
  add constraint journal_entries_source_check
  check (source in ('manual', 'ai', 'demo'));

-- ─────────────────────────────────────────────────────────────────────────
-- Rollback
--
--   alter table public.transactions    drop constraint transactions_user_row_hash_key;
--   alter table public.cash_movements  drop constraint cash_movements_user_row_hash_key;
--   alter table public.company_payouts drop constraint company_payouts_identity_key;
--   alter table public.company_payouts add constraint company_payouts_ticker_raw_announcement_date_key
--     unique (ticker, raw, announcement_date);
--   alter table public.dividend_events drop constraint dividend_events_reconciled_dividend_id_fkey;
--   alter table public.holdings        drop constraint holdings_source_check;
--   alter table public.transactions    drop constraint transactions_source_check;
--   alter table public.journal_entries drop constraint journal_entries_source_check;
--   -- then drop each set_updated_at / set_last_updated trigger and the two functions.
