-- Waitlist + read-only demo account guard
-- ---------------------------------------------------------------------------
-- Public launch flow is closed signup + waitlist. Demo visitors use a shared
-- authenticated demo account so the existing RLS read paths continue to work,
-- but demo_mode accounts must not mutate their own data.

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  note text,
  source text not null default 'login',
  status text not null default 'new',
  admin_notes text,
  contacted_at timestamptz,
  invited_at timestamptz,
  converted_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_contact_required check (
    nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  ),
  constraint waitlist_status_check check (status in ('new', 'contacted', 'invited', 'rejected', 'converted'))
);

create index if not exists waitlist_entries_created_idx
  on public.waitlist_entries (created_at desc);
create index if not exists waitlist_entries_status_idx
  on public.waitlist_entries (status, created_at desc);
create unique index if not exists waitlist_entries_email_unique
  on public.waitlist_entries (lower(email))
  where email is not null and btrim(email) <> '';

alter table public.waitlist_entries enable row level security;

drop policy if exists "waitlist_admin_all" on public.waitlist_entries;
create policy "waitlist_admin_all" on public.waitlist_entries
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.is_demo_account(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.demo_mode from public.profiles p where p.id = uid),
    false
  );
$$;

revoke all on function public.is_demo_account(uuid) from public;
grant execute on function public.is_demo_account(uuid) to authenticated;

-- A normal profile owner can edit their profile only when it is not the shared
-- read-only demo account. Admins keep the admin update policy from 0021.
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id and not public.is_demo_account(auth.uid()))
  with check (
    auth.uid() = id
    and not public.is_demo_account(auth.uid())
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
  );

-- Replace self-owner write policies so demo accounts retain read access but
-- cannot insert/update/delete user-owned rows. Service-role/admin writes are
-- still available for seeding and account management.
do $$
declare
  t text;
begin
  foreach t in array array[
    'broker_accounts','uploaded_statements','import_batches','import_rows',
    'holdings','transactions','dividends','cash_movements','prices',
    'portfolio_snapshots','targets','theses','journal_entries','news_articles',
    'ai_briefings','alerts','import_mappings','agent_runs',
    'tax_settings','dividend_events','benchmark_series',
    'reconciliation_checkpoints','company_report_jobs','allocation_forecasts',
    'portfolio_changelog'
  ]
  loop
    execute format('drop policy if exists "%s_owner_insert" on public.%I', t, t);
    execute format('drop policy if exists "%s_owner_update" on public.%I', t, t);
    execute format('drop policy if exists "%s_owner_delete" on public.%I', t, t);
    execute format(
      'create policy "%s_owner_insert" on public.%I for insert with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()))',
      t, t
    );
    execute format(
      'create policy "%s_owner_update" on public.%I for update using (auth.uid() = user_id and not public.is_demo_account(auth.uid())) with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()))',
      t, t
    );
    execute format(
      'create policy "%s_owner_delete" on public.%I for delete using (auth.uid() = user_id and not public.is_demo_account(auth.uid()))',
      t, t
    );
  end loop;
end $$;

drop policy if exists "stock_watchlist_rw" on public.stock_watchlist;
drop policy if exists "stock_watchlist_owner_select" on public.stock_watchlist;
drop policy if exists "stock_watchlist_owner_insert" on public.stock_watchlist;
drop policy if exists "stock_watchlist_owner_update" on public.stock_watchlist;
drop policy if exists "stock_watchlist_owner_delete" on public.stock_watchlist;
create policy "stock_watchlist_owner_select" on public.stock_watchlist
  for select using (auth.uid() = user_id);
create policy "stock_watchlist_owner_insert" on public.stock_watchlist
  for insert with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()));
create policy "stock_watchlist_owner_update" on public.stock_watchlist
  for update using (auth.uid() = user_id and not public.is_demo_account(auth.uid()))
  with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()));
create policy "stock_watchlist_owner_delete" on public.stock_watchlist
  for delete using (auth.uid() = user_id and not public.is_demo_account(auth.uid()));

drop policy if exists "chat_threads_owner_insert" on public.chat_threads;
drop policy if exists "chat_threads_owner_update" on public.chat_threads;
drop policy if exists "chat_threads_owner_delete" on public.chat_threads;
create policy "chat_threads_owner_insert" on public.chat_threads
  for insert with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()));
create policy "chat_threads_owner_update" on public.chat_threads
  for update using (auth.uid() = user_id and not public.is_demo_account(auth.uid()))
  with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()));
create policy "chat_threads_owner_delete" on public.chat_threads
  for delete using (auth.uid() = user_id and not public.is_demo_account(auth.uid()));

drop policy if exists "chat_messages_owner_insert" on public.chat_messages;
drop policy if exists "chat_messages_owner_update" on public.chat_messages;
drop policy if exists "chat_messages_owner_delete" on public.chat_messages;
create policy "chat_messages_owner_insert" on public.chat_messages
  for insert with check (
    auth.uid() = user_id
    and not public.is_demo_account(auth.uid())
    and exists (
      select 1
      from public.chat_threads t
      where t.id = thread_id
        and t.user_id = auth.uid()
    )
  );
create policy "chat_messages_owner_update" on public.chat_messages
  for update using (auth.uid() = user_id and not public.is_demo_account(auth.uid()))
  with check (auth.uid() = user_id and not public.is_demo_account(auth.uid()));
create policy "chat_messages_owner_delete" on public.chat_messages
  for delete using (auth.uid() = user_id and not public.is_demo_account(auth.uid()));
