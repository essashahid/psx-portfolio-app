-- Backfill: accounts that existed before onboarding shipped should not be
-- forced through the wizard. Mark every current profile as onboarded so only
-- brand-new signups see onboarding. Anyone can still redo it from Settings.
update public.profiles
set onboarded = true
where onboarded = false;
