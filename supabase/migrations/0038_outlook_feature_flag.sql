-- Add /outlook (PSX Market Outlook) to the known-features list.
--
-- profiles_enabled_features_known (migration 0024) is a closed allowlist: any
-- href not listed there is rejected by the database, not just the app. The
-- admin panel's "Feature access" toggle for PSX Market Outlook was failing
-- with a generic "something went wrong" because the constraint predates the
-- /outlook tab and Postgres was rejecting the update at the DB layer.

alter table public.profiles
  drop constraint if exists profiles_enabled_features_known;

alter table public.profiles
  add constraint profiles_enabled_features_known
  check (
    enabled_features <@ array[
      '/dashboard',
      '/holdings',
      '/dividends',
      '/performance',
      '/research',
      '/stocks',
      '/market',
      '/outlook',
      '/bulls-bears',
      '/news',
      '/chat',
      '/goals',
      '/allocation',
      '/journal',
      '/alerts',
      '/import',
      '/coverage',
      '/settings',
      'company_enrichment',
      'company_reports'
    ]::text[]
  );
