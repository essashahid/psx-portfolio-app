-- Product feedback for demo and private users.
-- Feedback identity is browser-scoped through visitor_id, so multiple people
-- using one shared demo account can still be reviewed separately.

create table if not exists public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  visitor_id text not null,
  session_id text,
  kind text not null default 'general',
  rating smallint,
  message text not null,
  contact text,
  page_path text not null default '/',
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_feedback_kind_check check (kind in ('bug', 'confusing', 'idea', 'missing', 'general')),
  constraint product_feedback_status_check check (status in ('new', 'reviewed', 'closed')),
  constraint product_feedback_rating_check check (rating is null or rating between 1 and 5),
  constraint product_feedback_message_check check (char_length(btrim(message)) between 5 and 2000),
  constraint product_feedback_contact_check check (contact is null or char_length(contact) <= 160),
  constraint product_feedback_visitor_check check (char_length(visitor_id) between 8 and 120),
  constraint product_feedback_session_check check (session_id is null or char_length(session_id) <= 120),
  constraint product_feedback_path_check check (char_length(page_path) between 1 and 300)
);

create index if not exists product_feedback_created_idx
  on public.product_feedback (created_at desc);
create index if not exists product_feedback_status_idx
  on public.product_feedback (status, created_at desc);
create index if not exists product_feedback_visitor_idx
  on public.product_feedback (visitor_id, created_at desc);

alter table public.product_feedback enable row level security;

drop policy if exists "product_feedback_owner_insert" on public.product_feedback;
create policy "product_feedback_owner_insert" on public.product_feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "product_feedback_admin_all" on public.product_feedback;
create policy "product_feedback_admin_all" on public.product_feedback
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
