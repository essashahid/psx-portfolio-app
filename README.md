# PortfolioOS PK

A private, AI-powered **PSX portfolio command center**. Import AKD/CDC statements (CSV / Excel / PDF), track holdings and targets, write investment theses, monitor news with Tavily, generate AI briefings with OpenAI, keep an investment journal, and get rule-based alerts — all behind your own Supabase project with Row Level Security.

> **This platform is for personal portfolio tracking and research support only. It is not financial advice.**
> It never asks for AKD, CDC, bank or brokerage credentials, and it never places orders.

---

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Storage, RLS) · OpenAI · Tavily · Recharts · TanStack Table · Zod · Papaparse · XLSX · pdf-parse · date-fns

## Quick start

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run, in order:
   - `supabase/migrations/0001_init.sql` — all tables, RLS policies, the `statements` storage bucket, and the signup trigger.
   - `supabase/seed.sql` — PSX ticker/sector reference data (used to enrich imports).
3. (Optional, recommended for local testing) In **Authentication → Providers → Email**, disable "Confirm email" so signup logs you in immediately.

Alternatively, with the Supabase CLI: `supabase db push` against this repo's `supabase/` folder, then run the seed.

### 2. Configure environment

```bash
cp .env.example .env.local
```

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase project (Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-side admin tasks (never sent to the browser) |
| `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, default `gpt-4o-mini`) | for AI features | briefings, thesis checks, news analysis, journal analysis |
| `TAVILY_API_KEY` | for news | News Center refresh |
| `MARKET_DATA_PROVIDER` | no | `manual` (default) works with zero external APIs |
| `MARKET_DATA_API_KEY`, `APP_BASE_URL` | no | reserved for a future price provider / deployment |

The app **degrades gracefully**: with no OpenAI/Tavily keys, everything except AI/news still works, and those buttons explain what is missing.

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign up, and either click **Load demo data** or import `samples/sample_holdings_akd.csv`.

## The core loop

1. **Sign in** → empty-state dashboard.
2. **Import Center** → upload an AKD/CDC statement (CSV/XLSX/PDF) → the engine detects the statement type (holdings snapshot / trade history / dividends-cash / generic), normalizes headers via synonyms, validates rows with Zod, and stages everything.
3. **Preview** → fix column mapping if needed, exclude rows, see exactly what will change → **Confirm**.
4. Dashboard, Holdings, Goals populate. Set **target price / allocation / review level** per holding, write a **thesis** (why bought, expectations, risks, sell/add conditions, confidence, status, review date).
5. **News Center → Refresh** searches Tavily per holding (+sector), and OpenAI scores each article for sentiment, relevance, and thesis impact.
6. **AI Briefings** — daily / weekly / risk / news-only / dividend / thesis review, generated from your actual data, stored permanently.
7. **Journal** decisions; run **pattern analysis** over your own entries.
8. **Alerts** recompute on every import/price/news change: missing thesis, review due, allocation drift (±5pp), price above target / below review level, concentration (>25% stock, >40% sector), negative news, dividend/result announcements, import issues.

## Import semantics (important)

- **Holdings snapshot** → positions are set to the statement's quantity/avg-cost (`source: statement_snapshot`). No fake trade history is invented. Market prices on the statement are captured into the prices table.
- **Trade history** → transactions stored, holdings rebuilt with **weighted-average cost**; realized P/L computed on sells; dividends inside trade files are also recorded.
- **Dividend/cash** → dividends linked to tickers where possible; other rows become cash movements.
- **Duplicate protection** → SHA-256 file hash + per-row hash. Re-importing the same file or overlapping statements never double-counts.
- **Uncertain rows** are never silently applied — they are flagged with warnings, can be excluded, and rejected rows stay stored for review.
- Original files are kept in a **private** Supabase Storage bucket scoped to your user id.

## Prices without a market-data API

`lib/market-data/adapter.ts` defines `getLatestPrice / getHistoricalPrices / refreshPortfolioPrices`. The default `manual` provider reads the `prices` table, which is fed by:

- manual edits in **Settings → Latest prices**,
- bulk CSV upload (`ticker,price[,date]` — see `samples/sample_prices.csv`),
- market prices found on imported statements.

To add a real provider later, implement the interface in the adapter and set `MARKET_DATA_PROVIDER` — nothing else in the app changes.

## Security & privacy model

- Every user-owned table has `user_id` + **RLS policies** (`auth.uid() = user_id`) for select/insert/update/delete; storage objects are path-scoped per user.
- The service-role key is server-only; all user reads/writes go through the RLS-enforced client.
- No brokerage credentials, no order placement, no trading integrations — by design.
- AI is guard-railed: it never says buy/sell/hold as a recommendation, cites news URLs, states missing data, and every briefing ends with a research-support disclaimer.

## Project map

```
supabase/migrations/0001_init.sql   schema + RLS + storage bucket
supabase/seed.sql                   PSX ticker reference data
lib/import/                         parse (csv/xlsx/pdf) → normalize → validate → commit
lib/portfolio.ts                    valuation, weighted-average rebuild, snapshots
lib/market-data/adapter.ts          pluggable price provider interface
lib/alerts.ts                       alert rule engine
lib/ai/                             OpenAI guardrails, news analysis, briefing generators
lib/tavily.ts                       news search
lib/demo.ts                         demo dataset load/clear
app/api/                            import, news, ai, prices, alerts, demo, export, reset
app/(app)/                          dashboard, import, holdings, stocks/[ticker], news,
                                    briefings, goals, journal, alerts, settings
samples/                            test statements + price CSV
scripts/test-import.ts              import-engine sanity tests (npx tsx scripts/test-import.ts)
```

## Sample files

- `samples/sample_holdings_akd.csv` — holdings snapshot (with a title line, like real exports)
- `samples/sample_trades_akd.csv` — buys + one sell (exercises weighted-average + realized P/L)
- `samples/sample_dividends_cdc.csv` — dividends, a fee, and a deposit
- `samples/sample_prices.csv` — bulk price upload format

## Notes & limitations

- PDF parsing is best-effort (text-layer tables). For scanned PDFs, export CSV/XLSX from the broker portal instead; the preview step always shows what was understood before anything is committed.
- Demo prices are illustrative, not live quotes.
- One Tavily news refresh covers up to 12 holdings per run to keep API usage sane.
- Do not commit real API keys: `.env*` is git-ignored, but `.env.example` should only ever contain placeholders.
