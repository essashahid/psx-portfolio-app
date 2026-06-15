-- Persist Research Copilot conversations so users can resume prior threads.

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists chat_threads_user_idx
  on public.chat_threads (user_id, last_message_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  thinking text,
  cards jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_thread_idx
  on public.chat_messages (thread_id, created_at asc);
create index if not exists chat_messages_user_idx
  on public.chat_messages (user_id, created_at desc);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

create policy "chat_threads_owner_select" on public.chat_threads
  for select using (auth.uid() = user_id);
create policy "chat_threads_owner_insert" on public.chat_threads
  for insert with check (auth.uid() = user_id);
create policy "chat_threads_owner_update" on public.chat_threads
  for update using (auth.uid() = user_id);
create policy "chat_threads_owner_delete" on public.chat_threads
  for delete using (auth.uid() = user_id);

create policy "chat_messages_owner_select" on public.chat_messages
  for select using (auth.uid() = user_id);
create policy "chat_messages_owner_insert" on public.chat_messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.chat_threads t
      where t.id = thread_id
        and t.user_id = auth.uid()
    )
  );
create policy "chat_messages_owner_update" on public.chat_messages
  for update using (auth.uid() = user_id);
create policy "chat_messages_owner_delete" on public.chat_messages
  for delete using (auth.uid() = user_id);
