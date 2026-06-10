-- ---------------------------------------------------------------------------
-- Dividend Forecast & Receivables Engine
-- ---------------------------------------------------------------------------

-- Per-user tax profile (Pakistan filer / ATL by default)
create table public.tax_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  taxpayer_status text not null default 'filer',           -- filer | non-filer
  country text not null default 'PK',
  tax_year text not null default '2025-26',
  dividend_tax_rate numeric not null default 0.15,         -- listed-company cash dividends, filer/ATL
  default_payment_window_days int not null default 30,     -- working days after book closure / announcement
  default_face_value numeric not null default 10,
  source_note text default 'Default: 15% WHT for ATL filers on listed-company cash dividends (ITO 2001 s.150). Edit if FBR rules change.',
  show_forecasts_in_review boolean not null default true,
  auto_create_confirmed boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- Dividend receivable / forecast events
create table public.dividend_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  company_name text,
  event_type text not null default 'announcement',         -- announcement | forecast | manual
  source_type text,                                        -- psx-announcement | history | manual | web
  source_url text,
  source_title text,
  source_quality text default 'high',                      -- high | medium | low
  announcement_date date,
  board_meeting_date date,
  ex_date date,
  book_closure_start date,
  book_closure_end date,
  payment_date date,
  estimated_payment_start date,
  estimated_payment_end date,
  dividend_type text not null default 'cash',              -- cash | bonus | right | other
  announced_value_raw text,
  dividend_percentage numeric,
  face_value numeric,
  face_value_assumed boolean not null default false,
  dividend_per_share numeric,
  quantity_basis text default 'current_holding',           -- current_holding | transactions | manual
  eligible_quantity numeric,
  eligibility_status text not null default 'unknown',      -- eligible | likely_eligible | not_eligible | unknown | needs_confirmation
  eligibility_notes text,
  gross_expected numeric,
  taxpayer_status text,
  tax_rate numeric,
  tax_rate_configured boolean not null default true,
  needs_tax_review boolean not null default false,
  estimated_tax numeric,
  net_expected numeric,
  received_date date,
  gross_received numeric,
  tax_deducted_actual numeric,
  actual_tax_rate numeric,
  net_received numeric,
  variance_amount numeric,
  status text not null default 'announced',                -- announced | expected | received | overdue | not_eligible | ignored | needs_review | forecasted
  confidence_level text not null default 'medium',         -- high | medium | low
  forecast_basis text,
  -- forecast ranges (per-share and totals)
  dps_low numeric,
  dps_high numeric,
  gross_low numeric,
  gross_high numeric,
  net_low numeric,
  net_high numeric,
  is_forecast boolean not null default false,
  is_confirmed boolean not null default false,
  is_reconciled boolean not null default false,
  notes text,
  dedupe_key text not null,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index dividend_events_user_idx on public.dividend_events (user_id, status, ticker);
create index dividend_events_window_idx on public.dividend_events (user_id, estimated_payment_end);

-- Face value lives on the shared symbol reference table
alter table public.stock_master add column if not exists face_value numeric;

-- RLS
do $$
declare
  t text;
begin
  foreach t in array array['tax_settings', 'dividend_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s_owner_select" on public.%I for select using (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_owner_insert" on public.%I for insert with check (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_owner_update" on public.%I for update using (auth.uid() = user_id)', t, t);
    execute format(
      'create policy "%s_owner_delete" on public.%I for delete using (auth.uid() = user_id)', t, t);
  end loop;
end $$;
