-- Feature flags: replace the closed CHECK allowlist with a lookup table.
--
-- Why
-- ---
-- profiles.enabled_features has been validated by profiles_enabled_features_known,
-- a CHECK holding a hardcoded array of every valid href. Adding a tab therefore
-- meant shipping a migration, and forgetting to meant the admin panel's toggle
-- failed with a generic "something went wrong" while Postgres rejected the write
-- underneath. Migration 0038 exists solely because /outlook hit exactly that.
--
-- A lookup table keeps the same guarantee, that a typo cannot be stored, while
-- letting a new feature be a row rather than a schema change.
--
-- Risk
-- ----
-- Not destructive: no column is dropped and no row is rewritten. The CHECK is
-- swapped for a trigger enforcing the same rule against feature_keys, seeded
-- with exactly the twenty values the CHECK allowed today, so every existing
-- profiles row stays valid. The reversal is at the bottom of this file.
--
-- The one behaviour change is deliberate: an unknown href now raises a named
-- error naming the key, instead of a bare constraint violation.

create table if not exists public.feature_keys (
  key         text primary key,
  label       text not null,
  kind        text not null default 'route' check (kind in ('route', 'capability')),
  created_at  timestamptz not null default now()
);

comment on table public.feature_keys is
  'Valid values for profiles.enabled_features. Add a row to add a feature; no migration needed.';

insert into public.feature_keys (key, label, kind) values
  ('/dashboard',          'Dashboard',            'route'),
  ('/holdings',           'Holdings',             'route'),
  ('/dividends',          'Dividends',            'route'),
  ('/performance',        'Performance',          'route'),
  ('/research',           'Saved Reports',        'route'),
  ('/stocks',             'Stock Research',       'route'),
  ('/market',             'Market Pulse',         'route'),
  ('/outlook',            'PSX Market Outlook',   'route'),
  ('/bulls-bears',        'Bulls & Bears',        'route'),
  ('/news',               'News Center',          'route'),
  ('/chat',               'Research Copilot',     'route'),
  ('/goals',              'Goals & Targets',      'route'),
  ('/allocation',         'Capital Allocation',   'route'),
  ('/journal',            'Journal',              'route'),
  ('/alerts',             'Alerts',               'route'),
  ('/import',             'Import Center',        'route'),
  ('/coverage',           'Data Engine',          'route'),
  ('/settings',           'Settings',             'route'),
  ('company_enrichment',  'Company enrichment',   'capability'),
  ('company_reports',     'Company reports',      'capability')
on conflict (key) do nothing;

-- Readable by any signed-in user: the admin panel lists these to build its
-- toggles. Writes stay with the service role.
alter table public.feature_keys enable row level security;

drop policy if exists feature_keys_read on public.feature_keys;
create policy feature_keys_read on public.feature_keys
  for select to authenticated using (true);

-- A CHECK cannot reference another table, so the rule moves to a trigger.
create or replace function public.validate_enabled_features()
returns trigger
language plpgsql
as $$
declare
  unknown_key text;
begin
  if new.enabled_features is null then
    return new;
  end if;

  select f
    into unknown_key
    from unnest(new.enabled_features) as f
   where not exists (select 1 from public.feature_keys k where k.key = f)
   limit 1;

  if unknown_key is not null then
    raise exception 'unknown feature key: %', unknown_key
      using hint = 'Add it to public.feature_keys first.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_validate_enabled_features on public.profiles;
create trigger profiles_validate_enabled_features
  before insert or update of enabled_features on public.profiles
  for each row execute function public.validate_enabled_features();

-- The old allowlist is now the trigger's job. The separate CHECK that every
-- profile keeps /dashboard is untouched: it encodes a different rule.
alter table public.profiles
  drop constraint if exists profiles_enabled_features_known;

-- To reverse:
--   drop trigger profiles_validate_enabled_features on public.profiles;
--   drop function public.validate_enabled_features();
--   alter table public.profiles add constraint profiles_enabled_features_known
--     check (enabled_features <@ (select array_agg(key) from public.feature_keys));
--   -- (or paste back the literal array from migration 0038)
--   drop table public.feature_keys;
