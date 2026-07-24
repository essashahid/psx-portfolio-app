# PortfolioOS PK

A private, AI-assisted **PSX portfolio and research workspace**. Import AKD/CDC
statements (CSV / Excel / PDF), track holdings, dividends and performance
against a KSE-100 benchmark, research companies from their own filings, follow
market news, and ask a research copilot questions about your actual portfolio,
all behind your own Supabase project with Row Level Security.

> **For personal portfolio tracking and research support only. It is not financial advice.**
> It never asks for AKD, CDC, bank or brokerage credentials, and it never places orders.

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Supabase (Postgres, Auth, Storage, RLS) · Jest · Recharts, Vega-Lite and
KLineCharts · TanStack Table · Zod · Papaparse · XLSX · pdf-parse ·
Anthropic and OpenAI-compatible model APIs · Serwist (PWA)

## Prerequisites

- Node.js 20 or newer (`@types/node` is pinned to 20)
- npm
- A Supabase project, or the Supabase CLI for a local one

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com), then apply the schema
in order:

- `supabase/migrations/*.sql`, numbered and append-only. `0001_init.sql` creates
  the tables, RLS policies, the `statements` storage bucket, and the signup
  trigger; later files build on it.
- `supabase/seed.sql`, PSX ticker and sector reference data used to enrich imports.

With the CLI: `supabase db push`, then run the seed.

For local testing, disabling "Confirm email" under **Authentication → Providers
→ Email** makes signup log you straight in.

### 2. Environment

```bash
cp .env.example .env.local
```

Required:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin work. Bypasses RLS, never sent to the browser |

Optional, each enabling a specific surface:

| Variable | Enables |
|---|---|
| `CLAUDE_API_KEY` | Claude models in the Research Copilot and the news Analyst Brief |
| `TASKS_API_KEY` / `DEEP_SEEK_API_KEY` / `DEEPSEEK_API_KEY` | The DeepSeek model path, filing extraction, background AI tasks |
| `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL` | Vision extraction from scanned filing PDFs |
| `OPENROUTER_API_KEY` | OpenRouter-hosted models |
| `TAVILY_API_KEY`, `NEWS_ENABLE_TAVILY` | Per-holding deep news search |
| `NEWS_ENABLE_MARKET`, `NEWS_ENABLE_GDELT`, `NEWS_ENABLE_PSX_ANNOUNCEMENTS`, `GDELT_REQUEST_DELAY_MS` | The three no-key news lanes: Pakistani business wires, GDELT, official PSX announcements |
| `MARKET_DATA_PROVIDER` (`psx`, `twelve-data`, `manual`), `TWELVE_DATA_API_KEY`, `MARKET_DATA_API_KEY` | Price provider selection |
| `FOREIGN_FLOWS_PROVIDER`, `NCCPL_FLOWS_URL` | FIPI/LIPI foreign-flow ingestion |
| `PSX_TERMINAL_ENABLED`, `PSX_TERMINAL_BASE_URL` | The PSX terminal data source |
| `CRON_SECRET` | Authenticates the scheduled `/api/cron/*` handlers |
| `DEMO_ACCOUNT_EMAIL`, `DEMO_ACCOUNT_PASSWORD` | The read-only demo login |
| `AKD_LEDGER_PDF_PATH` | Overrides the local AKD statement the performance page falls back to |
| `AI_DISABLED`, `CHAT_DISABLED`, `TASKS_DISABLED`, `VISION_DISABLED`, `FILINGS_OCR_DISABLED`, `CHAT_DEADLINE_MS` | Kill switches and timeouts |

The app degrades gracefully: with no model or Tavily keys, manual prices, PSX
announcements, and GDELT discovery still work where reachable.

`.env.example` still lists `GEMINI_API_KEY` and `GEMINI_MODEL`. Nothing in
`app/` or `lib/` reads them any more.

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign up, then either click **Load demo data** or
import `samples/sample-holdings-akd.csv`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (`eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest suite in `__tests__/` |
| `npm run validate` | lint, typecheck, and tests |
| `npm run check:registry` | Verified-ticker drift and freshness gates |
| `npm run eval:chat`, `eval:chat:live`, `eval:signals`, `eval:forecast` | Model and engine evaluations |
| `npm run audit:outlook` | Outlook data audit |
| `npm run backfill:index` | Backfill KSE-100 index history |

Operational scripts beyond these live in `scripts/` and are documented in
[scripts/README.md](scripts/README.md).

## Project map

```
app/               routes, layouts, and API handlers (URLs come from directory names)
  (app)/           dashboard, holdings, dividends, performance, stocks, market,
                   news, chat, outlook, allocation, goals, journal, alerts,
                   import, research, settings, coverage, bulls-bears
  api/             route handlers, including api/cron/* scheduled by vercel.json
components/
  ui/              presentation primitives
  shared/          cross-feature components (sidebar, charts, command palette)
  features/        UI owned by one feature, one directory per domain
lib/
  <domain>/        domain logic: portfolio, dividends, company, market, news,
                   chat, import, alerts, demo, dashboard, user
  engine/          financials, ratios, performance, benchmarks, outlook, allocation
  ai/              model definitions and provider calls
  market-data/     price and macro data adapters
  providers/       external service adapters
  supabase/        browser, server, and admin clients
  config/          navigation and feature flags
  shared/          shared types, formatting, sector colours, route helpers
__tests__/         Jest suites, mirroring lib/ by domain
scripts/           operator-run scripts, by category, see scripts/README.md
data/              reference, external, queue, generated, private data, see data/README.md
samples/           sanitised import fixtures, see samples/README.md
supabase/          migrations/ (append-only) and seed.sql
docs/              architecture, development, operations, research, design
proxy.ts           request proxy: auth and per-account feature gating
```

Full detail, including layer boundaries and where a new file belongs:
[docs/architecture/repository-structure.md](docs/architecture/repository-structure.md).

## Import semantics

- **Holdings snapshot** sets positions to the statement's quantity and average
  cost. No trade history is invented. Prices on the statement are captured into
  the prices table.
- **Trade history** stores transactions and rebuilds holdings with
  **weighted-average cost**, computing realised P/L on sells.
- **Dividend and cash** rows link dividends to tickers where possible; the rest
  become cash movements.
- **Duplicate protection** uses a SHA-256 file hash plus a per-row hash, so
  re-importing the same file or an overlapping statement never double-counts.
- **Uncertain rows are never silently applied.** They are flagged, can be
  excluded in the preview step, and rejected rows stay stored for review.
- Original files go to a private Supabase Storage bucket scoped to your user id.

## Prices without a market-data API

`lib/market-data/adapter.ts` defines the price provider interface. The `manual`
provider reads the `prices` table, which is fed by edits in **Settings → Latest
prices**, bulk CSV upload (`ticker,price[,date]`, see
`samples/sample-prices.csv`), and prices found on imported statements. To add a
provider, implement the interface and set `MARKET_DATA_PROVIDER`. Nothing else
in the app changes.

## Security and privacy

- Every user-owned table has `user_id` and RLS policies (`auth.uid() = user_id`),
  and storage objects are path-scoped per user.
- The service-role key is server-only. All user reads and writes go through the
  RLS-enforced client.
- No brokerage credentials, no order placement, no trading integrations.
- **`data/private/` holds real personal financial documents** and is tracked in
  Git. See [data/README.md](data/README.md). Keep this repository private.
- Do not commit API keys. `.env*` is git-ignored, and `.env.example` should hold
  placeholders only.

## Documentation

- [docs/architecture/repository-structure.md](docs/architecture/repository-structure.md) — layout, boundaries, where new files go
- [CONTRIBUTING.md](CONTRIBUTING.md) — naming rules and required checks
- [scripts/README.md](scripts/README.md) — every operational script, and whether it writes
- [data/README.md](data/README.md) — data provenance and lifecycle
- [docs/operations/launch-disabled-features.md](docs/operations/launch-disabled-features.md) — surfaces hidden for launch and how to restore them
- [docs/development/](docs/development/) — a sample of the generated company-report PDF
- [docs/research/](docs/research/) — product notes not yet built
- [docs/design/](docs/design/) — design references

## Notes and limitations

- PDF parsing is best-effort against the text layer. For scanned statements,
  export CSV or XLSX from the broker portal instead. The preview step always
  shows what was understood before anything is committed.
- Demo prices are illustrative, not live quotes.
- News refresh is bounded per run to keep provider usage sane.
