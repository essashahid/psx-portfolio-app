-- ---------------------------------------------------------------------------
-- reconciliation_checkpoints
-- A trusted snapshot of the broker statement's closing Inventory Position,
-- captured when the ledger is backfilled/imported. The Performance page
-- compares DB-derived holdings to the latest checkpoint to decide whether the
-- portfolio is fully "reconciled to the AKD statement" (vs. drifting), and to
-- show a confident reconciled state instead of an incomplete-data warning.
--
-- data jsonb shape:
--   { "items": [ { "ticker": "MEBL", "quantity": 556, "closingRate": 512.98 } ],
--     "totalShares": 11656, "ledgerBalance": 10265.88, "netWorth": 1196641.60 }
-- ---------------------------------------------------------------------------
create table public.reconciliation_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  as_of date not null,
  source text not null default 'akd_statement',
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, as_of, source)
);

create index reconciliation_checkpoints_user_idx on public.reconciliation_checkpoints (user_id, as_of desc);

alter table public.reconciliation_checkpoints enable row level security;
create policy "reconciliation_checkpoints_owner_select" on public.reconciliation_checkpoints for select using (auth.uid() = user_id);
create policy "reconciliation_checkpoints_owner_insert" on public.reconciliation_checkpoints for insert with check (auth.uid() = user_id);
create policy "reconciliation_checkpoints_owner_update" on public.reconciliation_checkpoints for update using (auth.uid() = user_id);
create policy "reconciliation_checkpoints_owner_delete" on public.reconciliation_checkpoints for delete using (auth.uid() = user_id);
