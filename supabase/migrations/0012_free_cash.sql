alter table public.profiles
  add column if not exists free_cash numeric not null default 0;
