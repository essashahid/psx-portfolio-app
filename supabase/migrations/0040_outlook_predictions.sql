-- ---------------------------------------------------------------------------
-- outlook_predictions
--
-- The live scorecard for the PSX Market Outlook.
--
-- Phase 3 established what the models do on walk-forward history. That is
-- retrospective: every fold was scored on data that already existed when the
-- harness ran. This table records what the models actually said on each live
-- session, before the outcome was knowable, and scores it once the horizon
-- matures. It is the only way to learn whether the walk-forward result holds
-- going forward, and it is what the direction model in particular needs before
-- it can be trusted.
--
-- One row per (trade_date, horizon, task, threshold). Predictions are written
-- once and never rewritten; only the outcome columns are filled in later, so a
-- forecast cannot be quietly revised after the fact.
--
-- Market data, not user-scoped: written by the service-role client, readable
-- by any signed-in user.
-- ---------------------------------------------------------------------------

create table if not exists public.outlook_predictions (
  id uuid primary key default gen_random_uuid(),

  -- The session the forecast was made on, using its close.
  trade_date date not null,
  -- Trading sessions ahead: 5, 10 or 20.
  horizon integer not null,
  -- 'direction' | 'trading-range' | 'drawdown'
  task text not null,
  -- Drawdown threshold as a negative fraction (-0.03). Real thresholds are
  -- always negative, so 0 is the sentinel for "not applicable" on the other
  -- tasks. It is not null because a nullable column cannot participate in the
  -- unique constraint that upserts target, and null never equals null there.
  threshold numeric not null default 0,

  -- Which model produced it, so a model change is attributable rather than
  -- silently blended into the running score.
  model text not null,
  model_version text not null default 'phase3',

  -- Index level at the moment of forecast, so outcomes can be recomputed.
  entry_close numeric not null,

  -- Direction: the three class probabilities.
  p_rise numeric,
  p_sideways numeric,
  p_fall numeric,
  -- The sideways band used, since it defines the classes.
  sideways_band numeric,

  -- Trading range: bounds as fractions of the entry close.
  range_lo numeric,
  range_hi numeric,

  -- Drawdown: probability of reaching the threshold.
  p_drawdown numeric,

  -- --- Outcome, written only once the horizon has fully elapsed -------------
  resolved_at timestamptz,
  -- Session the horizon landed on.
  outcome_date date,
  outcome_close numeric,
  -- Close-to-close return over the horizon.
  outcome_return numeric,
  -- Worst and best points reached inside the window.
  outcome_min numeric,
  outcome_max numeric,
  -- Realised direction class: 0 fall, 1 sideways, 2 rise.
  outcome_class integer,
  -- Whether the drawdown threshold was reached.
  outcome_hit boolean,

  created_at timestamptz not null default now()
);

-- One prediction per task, horizon, threshold and model per session.
alter table public.outlook_predictions
  drop constraint if exists outlook_predictions_unique;
alter table public.outlook_predictions
  add constraint outlook_predictions_unique
  unique (trade_date, horizon, task, threshold, model);

-- Scoring queries read unresolved rows oldest-first; the scorecard reads
-- resolved rows by task and horizon.
create index if not exists outlook_predictions_unresolved_idx
  on public.outlook_predictions (resolved_at, trade_date)
  where resolved_at is null;

create index if not exists outlook_predictions_scored_idx
  on public.outlook_predictions (task, horizon, outcome_date desc)
  where resolved_at is not null;

alter table public.outlook_predictions enable row level security;

-- Shared market data: any signed-in user may read; writes go through the
-- service-role client, which bypasses RLS.
drop policy if exists "outlook_predictions_read" on public.outlook_predictions;
create policy "outlook_predictions_read"
  on public.outlook_predictions for select to authenticated using (true);
