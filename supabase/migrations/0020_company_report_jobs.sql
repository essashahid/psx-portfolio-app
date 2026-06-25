-- Async company report generation jobs with live stage tracking
create table if not exists public.company_report_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  options jsonb not null default '{}',
  stages jsonb not null default '[]',
  parent_report_id uuid references public.ai_briefings(id) on delete set null,
  result_briefing_id uuid references public.ai_briefings(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index company_report_jobs_user_idx on public.company_report_jobs (user_id, created_at desc);
create index company_report_jobs_status_idx on public.company_report_jobs (user_id, status);

alter table public.company_report_jobs enable row level security;
create policy "company_report_jobs_owner_select" on public.company_report_jobs for select using (auth.uid() = user_id);
create policy "company_report_jobs_owner_insert" on public.company_report_jobs for insert with check (auth.uid() = user_id);
create policy "company_report_jobs_owner_update" on public.company_report_jobs for update using (auth.uid() = user_id);
