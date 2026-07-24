# Repository structure

How this repository is laid out and where a new file belongs. The rules in
`CONTRIBUTING.md` are the short version; this document explains the reasoning
and the boundaries between layers.

## Tree

Generated directories (`node_modules/`, `.next/`, `.cache/`, `.vercel/`,
`reports/`) are omitted. They are not part of the architecture.

```
app/                        Next.js App Router. Routes, layouts, route handlers.
  (app)/                    Signed-in application shell (dashboard, holdings, stocks, …)
  admin/                    Admin-only pages
  api/                      Route handlers, including api/cron/* driven by vercel.json
  login/  onboarding/       Unauthenticated entry points
  layout.tsx  page.tsx  globals.css  manifest.ts  sw.ts

components/
  ui/                       Presentation primitives. No app or domain knowledge.
  shared/                   Cross-feature application components (sidebar, charts, …)
  features/<domain>/        UI owned by one feature: outlook, market, stocks, chat,
                            dividends, allocation, technicals, dashboard, holdings,
                            performance, news, import, settings, alerts, goals,
                            journal, onboarding, coverage

lib/
  <domain>/                 Domain logic: services, parsing, calculations, validation
    alerts  chat  company  dashboard  demo  dividends  engine  import
    market  news  portfolio  user
  engine/                   The heavier computation layer: financials, ratios,
                            outlook, allocation, performance, benchmarks
  ai/                       Model definitions and provider calls
  market-data/  providers/  External data adapters (PSX, Twelve Data, PBS, Tavily)
  supabase/                 Client factories: browser, server, admin
  admin/                    Admin authorisation guard
  config/                   Static application configuration (navigation, feature flags)
  shared/                   Cross-cutting: types, formatting, sector colours,
                            route-handler helpers

__tests__/                  Jest suites, mirroring lib/ by domain
types/                      Ambient declarations and types not owned by one domain
scripts/                    Operator-run scripts. See scripts/README.md
data/                       Reference, external, queue, generated, and private data.
                            See data/README.md
samples/                    Sanitised import fixtures. See samples/README.md
supabase/                   migrations/ (numbered, append-only) and seed.sql
public/                     Static assets served at the site root
docs/                       architecture/ development/ operations/ research/ design/
proxy.ts                    Framework-level request proxy (auth + feature gating)
```

## Layer boundaries

The dependency direction is one-way:

```
app/  →  components/  →  lib/  →  lib/supabase, lib/providers, lib/market-data
```

- **`app/` may import from anywhere.** Routes should stay thin: fetch, authorise,
  compose components. Business rules do not belong in `page.tsx`.
- **`components/` may import from `lib/`.** It must not be imported *by* `lib/`.
- **`lib/` must not import from `components/` or `app/`.** A domain module that
  needs a React type is a sign the logic is in the wrong layer.
- **`components/ui/` imports nothing from `lib/` except `lib/shared/`.** A
  primitive that knows about holdings or tickers is not a primitive; it belongs
  in `components/shared/` or under `components/features/`.
- **`components/features/<a>/` should not import from `components/features/<b>/`.**
  If two features need the same component, it moves to `components/shared/`.
  There is one accepted exception today: the holdings table opens the stocks
  feature's `GenerateReportDialog`, because generating a company report from a
  row is genuinely a stocks capability rather than a shared one.
- **`scripts/` may import from `lib/` via the `@/` alias.** Nothing in `app/` or
  `lib/` may import from `scripts/`.

## Client and server

- `lib/supabase/server.ts` and `lib/supabase/admin.ts` are **server-only**.
  `admin.ts` uses the service-role key, which bypasses row-level security and
  must never reach the browser. `lib/supabase/client.ts` is the browser client.
- A file with `"use client"` at the top ships to the browser along with
  everything it imports. Check what a module pulls in transitively before
  importing it from a client component.
- Route handlers under `app/api/` and Server Components are the right place for
  service-role work, secrets, and filesystem reads.
- Files read from disk at runtime (for example the local statement fallback in
  `lib/engine/performance.ts`) resolve against `process.cwd()`, which is the
  repository root.

## Where new files go

| You are adding | It goes in |
|---|---|
| A new page at a new URL | `app/(app)/<route>/page.tsx` |
| A loading state for that page | `app/(app)/<route>/loading.tsx` |
| A new API endpoint | `app/api/<path>/route.ts` |
| A button, badge, or layout primitive | `components/ui/` |
| A component two or more features use | `components/shared/` |
| A component one feature uses | `components/features/<domain>/` |
| A calculation, parser, or service | `lib/<domain>/` |
| A type used by more than one domain | `lib/shared/types.ts` |
| A type used by one domain | that domain's directory |
| A formatter or class-name helper | `lib/shared/format.ts` |
| A new external data provider | `lib/providers/` or `lib/market-data/` |
| A test | `__tests__/<domain>/<subject>.test.ts` |
| A one-off or operational script | `scripts/<category>/` — see `scripts/README.md` |
| A database change | a new numbered file in `supabase/migrations/` |
| A committed dataset the app reads | `data/reference/` |
| A vendor snapshot | `data/external/<vendor>/` |
| Script output | `data/generated/` or `reports/` (git-ignored) |

## Things that must not change casually

- **Route URLs.** Directory names under `app/` are the public URLs.
- **Framework filenames.** `page.tsx`, `layout.tsx`, `loading.tsx`,
  `template.tsx`, `route.ts`, `[ticker]`, `(app)`, and the root `proxy.ts` all
  carry meaning to Next.js. They are exempt from naming conventions.
- **Cron paths.** `vercel.json` maps schedules to `/api/cron/*` URLs. Moving one
  of those route handlers silently disables a scheduled job.
- **Migration filenames and order.** Migrations are append-only. Applied files
  are never renamed or edited.
- **Environment variable names.** Referenced from `.env.example`, deployment
  configuration, and scripts.
- **`public/` paths.** These are live URLs.
