-- /news joins the launch default.
--
-- Why
-- ---
-- News is no longer a primary tab, but Home and Market link into it for the
-- developments behind a holding. Every account therefore needs it enabled, and
-- a fresh signup must get it without an admin toggle.
--
-- What this does
-- --------------
-- 1. Appends '/news' to profiles.enabled_features (text[]) on every profile
--    that does not already carry it. '/news' has been a row in
--    public.feature_keys since 0042, so the validate_enabled_features trigger
--    accepts the write.
-- 2. Adds '/news' to the column default. handle_new_user (0001) inserts only
--    id and full_name, so a new profile takes the column default and gets the
--    new list with no further step.
--
-- Idempotent: rerunning appends nothing and resets the same default.

update public.profiles
   set enabled_features = array_append(enabled_features, '/news')
 where enabled_features is not null
   and not ('/news' = any(enabled_features));

alter table public.profiles
  alter column enabled_features set default array[
    '/dashboard',
    '/holdings',
    '/dividends',
    '/stocks',
    '/market',
    '/chat',
    '/news'
  ]::text[];

-- To reverse:
--   update public.profiles
--      set enabled_features = array_remove(enabled_features, '/news')
--    where '/news' = any(enabled_features);
--   alter table public.profiles
--     alter column enabled_features set default array[
--       '/dashboard', '/holdings', '/dividends', '/stocks', '/market', '/chat'
--     ]::text[];
