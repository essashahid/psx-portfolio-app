# Operational scripts

Every script here is run by hand from the **repository root**, not by the
application. Nothing in `app/` or `lib/` imports from this directory.

```bash
npx tsx scripts/<category>/<script>.ts        # TypeScript
node scripts/<category>/<script>.mjs          # plain ESM
python3 scripts/data/download-akd-statements.py
```

Paths inside these scripts are resolved against the current working directory,
so **always run them from the repository root**. Running them from inside
`scripts/` will not find `data/` or `.env.local`.

## Environment

Most scripts talk to Supabase with the service-role key and load `.env.local`
themselves, either through `scripts/lib/load-env.ts` (`loadEnvLocal()`) or
`dotenv`'s `config({ path: ".env.local" })`. The variables they rely on are the
same ones the app uses, listed in `.env.example`. The ones that matter most here:

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | nearly every script |
| `TWELVE_DATA_API_KEY` | `data/build-macro-assets.ts` |
| `CLAUDE_API_KEY`, and one of `TASKS_API_KEY` / `DEEP_SEEK_API_KEY` / `DEEPSEEK_API_KEY` | the `evaluations/` scripts, extraction backfills |
| `GMAIL_PASSWORD` | `data/download-akd-statements.py` |

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. Treat anything in
`backfills/`, `maintenance/`, and most of `data/` as production-affecting.

## Categories

| Directory | Purpose | Mutates data? |
|---|---|---|
| `audits/` | Read the database and report on coverage, freshness, and quality. Some write a report file under `reports/` or `data/generated/`. | No database writes |
| `backfills/` | Fill historical gaps in existing tables (ledgers, EOD history, fundamentals, flows). | **Yes** |
| `data/` | Build, import, or seed a dataset from an external source or a local file. | **Yes** |
| `evaluations/` | Score model and engine output against fixtures or live data. Print pass/fail. | No |
| `maintenance/` | One-off corrections to stored financial data: apply a re-read filing, quarantine bad rows, re-run a computation. | **Yes** |
| `verification/` | Read-only diagnostics and parser checks used while debugging. | No |

Several scripts accept `--dry` to print what they would change without writing.
Check the header comment of the individual script; it is the authoritative
description of what that script does and how it was validated.

### `scripts/lib/`

Shared helpers for scripts only. Currently `load-env.ts`, which reads
`.env.local` into `process.env`. Scripts import it relatively
(`import { loadEnvLocal } from "../lib/load-env"`); everything else they import
from the application uses the `@/` alias.

## Scripts wired into `package.json`

These are the ones intended to be run repeatedly, and the interface CI or an
operator would use:

| Command | Script |
|---|---|
| `npm run check:registry` | `verification/check-verified-drift.ts` then `verification/check-verified-freshness.ts` |
| `npm run check:drift` | `verification/check-verified-drift.ts` |
| `npm run check:freshness` | `verification/check-verified-freshness.ts` |
| `npm run audit:outlook` | `audits/audit-outlook-data.ts` |
| `npm run eval:chat` | `evaluations/eval-chat.ts` |
| `npm run eval:chat:live` | `evaluations/eval-chat-live.ts` |
| `npm run eval:signals` | `evaluations/eval-signals.ts` |
| `npm run eval:forecast` | `evaluations/eval-outlook-forecast.ts` |
| `npm run backfill:index` | `backfills/backfill-index-history.ts` |

## Known-broken scripts

`verification/check-holdings-discrepancy.ts` and
`verification/check-holding-quantities.ts` reference a module and an export that
do not exist in this repository and have never existed. Both carry a header
comment saying so. They need repair before they will run.

## Naming

`kebab-case`, verb first, describing what the script does to what
(`backfill-universe-eod`, `check-verified-drift`, `verify-import-parsers`).
Prefixes such as `_` and opaque names such as `_re6` are not used.
