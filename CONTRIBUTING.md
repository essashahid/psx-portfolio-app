# Contributing

## Before you open a change

```bash
npm run validate      # lint + typecheck + check:shared + mobile:typecheck + tests
npm run build         # catches Server/Client boundary errors nothing else does
```

`npm run validate` chains five checks, cheapest first so the slow one runs last:

| Step | What it covers |
|---|---|
| `npm run lint` | ESLint over the repository |
| `npm run typecheck` | `tsc --noEmit` for the web app |
| `npm run check:shared` | `packages/shared` imports no platform code, and typechecks |
| `npm run mobile:typecheck` | `tsc --noEmit` for the Expo app in `mobile/` |
| `npm test` | Jest, about a minute |

Both commands must be run for anything that touches `app/`, `components/`,
`lib/`, `packages/shared/` or `mobile/`.

**`npm run validate` currently fails, and it is not your change.** `npm run
lint` reports 71 pre-existing problems, 32 of them errors, mostly
`no-explicit-any` in `types/chart-engine-adapter.ts` and several files under
`scripts/`. Because the chain stops at the first failure, nothing after lint
runs. Until that debt is cleared, run the stages separately to check your own
work:

```bash
npm run lint            # compare the count, do not add to it
npm run typecheck       # passes
npm run check:shared    # passes
npm run mobile:typecheck # passes
npm test                # passes
```

Do not add new lint errors, and do not "fix" the existing ones by widening the
ESLint configuration.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Directories | `kebab-case` | `lib/market-data/` |
| `.ts` / `.tsx` / `.mjs` files | `kebab-case` | `dividend-forecast.ts` |
| React component exports | `PascalCase` | `export function HoldingsTable()` |
| Functions, variables | `camelCase` | `summarizeDividends` |
| Module-level constants | `SCREAMING_SNAKE_CASE` | `DEMO_THREAD_COUNT` |
| Tests | `<subject>.test.ts(x)` | `__tests__/market/technicals.test.ts` |
| Hooks | `use-` prefix | `use-market-snapshot.ts` |
| Scripts | `kebab-case`, verb first | `backfill-universe-eod.ts` |
| Migrations | `NNNN_snake_case.sql`, next number | `0041_add_payout_calendar.sql` |

Exempt from all of the above:

- **Next.js filenames**: `page.tsx`, `layout.tsx`, `loading.tsx`, `template.tsx`,
  `route.ts`, `[ticker]`, `(app)`, `proxy.ts`. Keep the framework spelling.
- **Ticker-named external data**: `data/external/sarmaya/stocks/LUCK.json`. The
  filename is the ticker, so uppercase is correct.

Avoid `new`, `final`, `temp`, `misc`, `stuff`, numbered suffixes, and leading
underscores. `data.ts`, `types.ts`, and `service.ts` are fine **inside** a scoped
domain directory (`lib/chat/data.ts`) and not at the root of `lib/`.

Do not add barrel (`index.ts`) files unless they define a genuine public
boundary for a module. `lib/engine/allocation/index.ts` is one. A barrel that
only re-exports siblings adds an import cycle risk for no benefit.

## Where things belong

The full table is in
[docs/architecture/repository-structure.md](docs/architecture/repository-structure.md).
The short version:

- **New URL** → `app/(app)/<route>/page.tsx`. The directory name is the URL.
- **New API endpoint** → `app/api/<path>/route.ts`.
- **Presentation primitive** (no domain knowledge) → `components/ui/`.
- **Component used by two or more features** → `components/shared/`.
- **Component used by one feature** → `components/features/<domain>/`.
- **Calculation, parser, service, repository** → `lib/<domain>/`.
- **Test** → `__tests__/<domain>/<subject>.test.ts`.
- **Operational script** → `scripts/<category>/`, per
  [scripts/README.md](scripts/README.md). Add a header comment saying what it
  does, whether it writes, and how to run it.
- **Migration** → a new numbered file in `supabase/migrations/`. Never edit or
  rename an applied one.
- **Committed dataset** → `data/`, per [data/README.md](data/README.md).
- **Import fixture** → `samples/`, sanitised only.

## Directory ownership

- `lib/` must never import from `components/` or `app/`.
- `components/ui/` must not import domain logic; `lib/shared/` is the only `lib`
  import it should need.
- `scripts/` may import from `lib/` with the `@/` alias. Nothing in the
  application may import from `scripts/`.
- Scripts run from the repository root. Resolve data paths relative to
  `process.cwd()`, not `__dirname`.

## Generated files

Build output, caches, and audit reports are not committed: `.next/`, `out/`,
`node_modules/`, `.cache/filings/`, `reports/`, `*.tsbuildinfo`, `tree.txt`.
If you generate something new that is reproducible, add it to `.gitignore` in
the same change.

Two generated files *are* committed on purpose —
`data/reference/outlook-phase3-evaluation.json` and
`data/reference/outlook-experimental.json` — because the application imports
them at build time. `data/README.md` explains why.

## Things that break silently

- Renaming a directory under `app/` changes a public URL.
- Moving a handler under `app/api/cron/` breaks the schedule in `vercel.json`,
  and nothing fails loudly.
- Importing a server-only module (`lib/supabase/admin.ts`) from a client
  component leaks the service-role key. `npm run build` is what catches this.
- `data/private/` holds real personal financial documents and is git-ignored.
  Never force-add anything from it: a commit there is not recoverable from,
  short of rewriting history.
