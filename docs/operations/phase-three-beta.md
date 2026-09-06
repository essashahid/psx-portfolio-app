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

## Product shape (Phase 4)

**Navigation.** Web: Home, Portfolio, Dividends, Companies, Market, Ask;
bell and avatar in chrome; an Internal menu for admins holds every
admin-only route plus News. Phone: Home, Holdings, Market, Ask, More; More
lists only native destinations for a non-admin. News is reachable from Home,
Market, the avatar menu and the phone's More, not a tab.

**Onboarding.** Name, experience, objective, then Add what you own: ticker
search, shares, optional average cost. A known cost becomes a BUY in the
ledger; an unknown cost becomes a manual holding with cost 0 that every
surface prints as "Cost unknown" and leaves out of the return denominator.
`POST /api/holdings/quick-add` is the one write path. Skippable.

**Home.** Value, today, unrealised, dividends received, cash, then a
dividends block (this tax year, all time, next announced or expected
payout), growth chart, positions, contribution, allocation, developments.
The index-weight panel is gone from the default view.

**Company.** Three tabs on both surfaces, same order: Overview (what it
does, your position, is it growing, does it pay, is it expensive, eight key
figures with glossary hints, recent developments, Ask), Financials (the
grid, earnings, every ratio, statements, price structure), Filings. The
eight key figures come from `lib/company/key-figures.ts`, used by the page
and the phone route. Contested figures say "Contested, under review" and
why.

**Market.** Index, a one-sentence day summary computed on the server, sectors,
movers, your holdings against the market, developments; everything
analytical under More detail. The summary and index contributors are in
`MarketResponse` so the phone stops computing its own.

**Ask.** Explain mode by default. Verdict-first advice only when the profile
is `advanced` and the message asks for a view. 40 questions a day per
account. Suggestions, demo threads and eval cases rewritten. Grounding rules
unchanged.

**Hidden, not deleted.** Performance, Saved reports, Outlook, Goals,
Allocation, Journal, Import Center, Coverage, Bulls & Bears remain admin-only
(`ADMIN_ONLY_FEATURES`); Import is enabled per account from Admin.

**What if I had invested.** On the company Overview of both surfaces: an
amount and a date (one, three or five years, or any date) become the value
today, split into price gain and gross dividends, with the annual rate and
the KSE-100 over the same window. `lib/company/what-if.ts` is the arithmetic
(shares through every bonus or split, each dividend on the shares held that
day); `GET /api/stocks/[ticker]/what-if` serves both surfaces. Dividends
before the payout record are reported as not counted, never estimated.
History is read through `lib/company/history.ts`, which pages past the
1,000-row PostgREST cap that a single query silently stops at.

## Beta readiness (Phase 5)

- Invite: Admin > Waitlist > Invite, or invite by email. Supabase sends the
  link; `/auth/callback` establishes the session; `/auth/set-password` then
  onboarding. Forgot password on the login page uses the same pages.
- Telemetry: `app_events` written by `POST /api/events` from web and phone
  (page_view, onboarding_completed, holding_added with method,
  import_opened/committed, company_viewed with held, company_tab_viewed,
  chat_asked with mode, push_interest, feedback_sent). `/admin/beta` answers
  the beta questions from it.
- Errors: `client_errors` from the web error boundary and window handlers,
  and from the phone's global handler and boundary. Listed on `/admin/beta`.
- Rate limits: `lib/shared/rate-limit.ts`, database-backed; chat 10 a minute
  and 40 a day, price refresh 6 per 10 minutes, news refresh 3 per 10
  minutes, waitlist 5 an hour per address, demo 20 an hour per address.
- Feedback widget on every page for every account.
- Jobs: `/admin/jobs` and the daily webhook.

## Visual verification

Every authenticated page was rendered and inspected, which Phase 1 could
not do. Method, reusable:

- Web: `npm run dev`, a throwaway account created with the service role,
  Playwright driving system Chrome with `reduced_motion="reduce"`, through
  login, all four onboarding steps, the empty Home, Portfolio and Dividends,
  quick-add through both paths, then every default page at 1280px and the
  phone width, clipped to the viewport (the ticker tape's transform fools a
  full-page capture). Two defects found and fixed: a hydration mismatch from
  the splash on every page, and event titles hidden at phone width.
- Phone: Android 15 emulator (`psx_pixel7`, created from
  `system-images;android-35;google_apis;arm64-v8a`), debug build via
  `expo run:android`, Metro on 8081, `mobile/.env.local` pointing the app at
  `http://10.0.2.2:3000`, screens captured with `adb exec-out screencap`.
  Login, Home, Holdings, Market, Ask, More, Company (three scroll positions),
  Dividends, Alerts, Settings. Three copy defects found and fixed.
- The same account showed the same portfolio value, day move, position
  values and company figures on both surfaces.
- The throwaway account and its rows were deleted afterwards; the test
  telemetry rows were cleared.

## Not built, on purpose

The ingestion worker and queue, Realtime quotes, the instruments table,
universe-wide statement extraction, the corporate-actions table, push
notifications, mobile signup and onboarding, the Performance release,
quarterly derivation, licensed feeds. Each has a trigger in the beta
questions on `/admin/beta`.
