-- Admin role + admin-override RLS
-- ---------------------------------------------------------------------------
-- Adds an `is_admin` flag to profiles and a SECURITY DEFINER helper that lets
-- RLS policies recognise admins. Admins can read and write every user's rows
-- (the owner sees only their own; an admin sees all). Account-level operations
-- (create / delete / password / ban) run through the Supabase Auth admin API
-- server-side with the service-role key — this migration only governs table
-- access. Admin status itself is gated so a user can never make themselves an
-- admin: the profiles UPDATE check forbids changing is_admin unless you already
-- are one.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- is_admin() — true when the current session belongs to an admin.
-- SECURITY DEFINER so the lookup bypasses RLS on profiles (otherwise the
-- profiles policies below would recurse). search_path pinned for safety.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- profiles: admins can see and edit every profile. The owner keeps the
-- existing self-scoped policies from 0001. The admin UPDATE check still holds
-- (an admin may flip is_admin on anyone); a non-admin can never reach here.
drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select" on public.profiles
  for select using (public.is_admin());

drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- A normal user must not be able to escalate themselves to admin. Replace the
-- self-update policy from 0001 with one that forbids changing is_admin unless
-- the caller is already an admin.
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
  );

-- Admin-override policies on every user-owned table. Mirrors the owner-policy
-- loop in 0001: each table gains an `<t>_admin_all` policy granting full
-- access to admins, alongside the existing per-owner policies.
do $$
declare
  t text;
begin
  foreach t in array array[
    'broker_accounts','uploaded_statements','import_batches','import_rows',
    'holdings','transactions','dividends','cash_movements','prices',
    'portfolio_snapshots','targets','theses','journal_entries','news_articles',
    'ai_briefings','alerts','import_mappings','agent_runs'
  ]
  loop
    execute format('drop policy if exists "%s_admin_all" on public.%I', t, t);
    execute format(
      'create policy "%s_admin_all" on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t, t);
  end loop;
end $$;

-- Storage: let admins read every uploaded statement (owners keep their own
-- path-scoped policies from 0001).
drop policy if exists "statements_admin_read" on storage.objects;
create policy "statements_admin_read" on storage.objects
  for select using (bucket_id = 'statements' and public.is_admin());

-- Bootstrap the first admin. Update the email below if the owner account
-- differs. Idempotent: re-running just re-asserts the flag.
update public.profiles
set is_admin = true
where id in (select id from auth.users where lower(email) = lower('eessobhai@gmail.com'));
