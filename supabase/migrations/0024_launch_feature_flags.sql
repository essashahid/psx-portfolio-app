-- Launch feature flags + account-level LLM provider access
-- ---------------------------------------------------------------------------
-- New and existing public accounts default to the launch surface:
-- Dashboard, Holdings, Dividends, Stock Research, Market Pulse, Research Copilot.
-- Import Center and other fragile / fallback-heavy areas stay hidden until an
-- admin enables them on the account. AI company enrichment/report capabilities
-- are also stored here and default off.

alter table public.profiles
  add column if not exists enabled_features text[] not null default array[
    '/dashboard',
    '/holdings',
    '/dividends',
    '/stocks',
    '/market',
    '/chat'
  ]::text[],
  add column if not exists allowed_llm_providers text[] not null default array['claude', 'deepseek']::text[];

alter table public.profiles
  alter column enabled_features set default array[
    '/dashboard',
    '/holdings',
    '/dividends',
    '/stocks',
    '/market',
    '/chat'
  ]::text[],
  alter column allowed_llm_providers set default array['claude', 'deepseek']::text[];

update public.profiles
set enabled_features = array[
  '/dashboard',
  '/holdings',
  '/dividends',
  '/stocks',
  '/market',
  '/chat'
]::text[]
where enabled_features is null;

update public.profiles
set allowed_llm_providers = array['claude', 'deepseek']::text[]
where allowed_llm_providers is null;

alter table public.profiles
  drop constraint if exists profiles_enabled_features_known,
  drop constraint if exists profiles_dashboard_enabled,
  drop constraint if exists profiles_allowed_llm_providers_known;

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
  ),
  add constraint profiles_dashboard_enabled
  check (enabled_features @> array['/dashboard']::text[]),
  add constraint profiles_allowed_llm_providers_known
  check (allowed_llm_providers <@ array['claude', 'deepseek']::text[]);

-- Existing accounts move to the launch view, except Essa Shahid's account which
-- remains fully enabled for ongoing internal work and comparison.
update public.profiles p
set enabled_features = case
  when lower(u.email) = lower('eessashahid@gmail.com') then array[
    '/dashboard',
    '/holdings',
    '/dividends',
    '/performance',
    '/research',
    '/stocks',
    '/market',
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
  else array[
    '/dashboard',
    '/holdings',
    '/dividends',
    '/stocks',
    '/market',
    '/chat'
  ]::text[]
end
from auth.users u
where p.id = u.id;
