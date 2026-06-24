-- Onboarding + personalization fields on profiles
-- ---------------------------------------------------------------------------
-- Drives the post-signup onboarding wizard and the experience-based tab
-- personalization. All columns have defaults so the existing handle_new_user()
-- trigger and existing rows keep working without backfill.

alter table public.profiles
  add column if not exists onboarded boolean not null default false,
  add column if not exists experience_level text not null default 'intermediate',
  add column if not exists risk_profile text,
  add column if not exists objective text,
  add column if not exists extra_features text[] not null default '{}',
  add column if not exists hidden_features text[] not null default '{}';

-- Guard against unexpected values from older clients.
alter table public.profiles
  drop constraint if exists profiles_experience_level_check;
alter table public.profiles
  add constraint profiles_experience_level_check
  check (experience_level in ('beginner', 'intermediate', 'advanced'));
