# Phases 3 to 5: trust, product shape, beta readiness

Ran 6 September 2026, after the product direction was reset around a
self-directed, non-professional PSX investor. Complex underneath, simple
above; explain first. This file records what changed, what was applied to
production, and what still needs a hand.

## Migrations

| File | What | Applied |
|---|---|---|
| `0042_feature_keys.sql` | Feature CHECK to `feature_keys` table + trigger | Yes, 6 Sep |
| `0043_phase2_integrity.sql` | Unique keys, payout identity key, updated_at triggers, FK, source CHECKs | Yes, 6 Sep (preflight: 0 duplicates on every key) |
| `0044_drop_eod_history.sql` | Drops the superseded table | Yes, 6 Sep, after `create table eod_history_backup_20260906 as select *` (115,035 rows). Drop the backup once a week has passed without anyone asking for it. |
| `0045_price_truth_and_job_runs.sql` | `latest_closes()` and `job_runs` | Yes, 6 Sep |
| `0046_beta_telemetry.sql` | `app_events`, `client_errors`, `request_counters`, `bump_counter()` | Yes, 6 Sep |
| `0047_news_default.sql` | `/news` joins the default feature list, existing profiles updated | Yes, 6 Sep (6 of 6 profiles) |

## Trust foundation (Phase 3)

**One price truth.** `lib/portfolio/effective-price.ts` is the rule: the
user's own price (manual or from a statement) if at least as new as the
market, else the shared quote, else the latest close, else a legacy row.
`resolveEffectivePrices` loads the three candidates in three round trips.
`getPortfolio`, `getQuote` (the company header, given the user), the phone's
company route and every portfolio route go through it. The per-user
`prices` table no longer receives provider prices; the daily job and the
refresh button refresh the shared `market_quotes` row through
`refreshQuotesForTickers`. The snapshot fallback that lived only in the
mobile home route is gone, because the rule now lives below every route.

**Contested figures are withheld.** `lib/engine/contested.ts` reads open
`financial_statement_conflicts` and marks a filed field contested when two
readings differ by 10% or more on a headline line (EPS, revenue, profit,
equity, assets, borrowings, operating cash flow). `computeRatios` blanks
every ratio whose inputs come from a contested row of the periods it
actually used, with `missing` starting "Contested:". `getFundamentals`
drops the year and reports it in `contested`. 197 tickers carry open
conflicts; only those whose current valuation rows are disputed are
affected.

**Filings from the store.** `getCompanyFilings(ticker, n, { supabase })`
reads `market_events` first and asks the portal only when the store holds
fewer than eight rows for the company, writing the answer back.

**Payouts daily.** `/api/cron/market/payouts` sweeps every active equity
(463 today) least-recently-fetched first inside a 240 second budget.
Schedule 13:00 UTC weekdays.

**Corporate actions.** `packages/shared/src/market/adjust.ts` is the one
back-adjustment (a single-session move beyond 1.4x or below 0.6x is a
bonus or split). Applied in the technicals engine, the signals engine, the
chart-data route the phone draws from, the Copilot price chart and the
report chart. Not applied to the 60-session header strip. An alert rule
tells a holder when a bonus or right was announced for a stock they hold
and no matching transaction exists.

**Cash reconciled.** `npm run check:cash <statement.pdf> <user-id>` parses
an AKD statement and compares its stated closing balance with the ledger
rule in `lib/portfolio/cash.ts` as of the statement date. Owner's account,
statement to 22 June 2026: statement 10,265.88, app 10,265.92, difference
0.04 PKR over 78 cash movements and 123 transactions.

**Jobs are recorded.** Every cron handler is wrapped in `runCron`, which
writes a `job_runs` row at start and end. `lib/ops/job-health.ts` knows the
schedule and judges the day at the end of the data-health cron; problems go
to `OWNER_ALERT_WEBHOOK_URL` when set, and always to `/admin/jobs`.

## Manual steps that remain

- Set `OWNER_ALERT_WEBHOOK_URL` in Vercel to receive the daily job report.
- Set `NEXT_PUBLIC_SITE_URL` to the production origin and add
  `https://<origin>/auth/callback` to Supabase Auth redirect URLs, or invite
  and reset links will point at the wrong host.
- Delete `public.eod_history_backup_20260906` after a week.
