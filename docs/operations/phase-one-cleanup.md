# Phase 1: cleanup and consistency

What the September 2026 cleanup phase changed, what it deliberately did not,
and what the next person needs to know before starting the data work.

Phase 1 was about making the repository honest: one design system, no dead
code, every surface typechecked, docs that match the code. It changed no data
behaviour. The ingestion rebuild is Phase 2 and has not started.

## Done

| Area | Outcome |
|---|---|
| Repository hygiene | Design material moved under `docs/design/`; scratch logs and Supabase CLI metadata untracked; `supabase/config.toml` added |
| Scripts and CI | `mobile:*` scripts fixed, `mobile:ios` added, `validate` extended to five checks, registry check wired into deploy as advisory |
| Dead code | ~4,700 lines removed across two passes; `@tanstack/react-table` and `klinecharts` dropped |
| Design tokens | Every shadcn-era class replaced with the editorial vocabulary; live source is at zero |
| Metrics | One `Metric` primitive behind the dashboard, screener, cockpit and `StatCard` |
| Tables | `reader` variant added; seven tables moved onto the shared primitive; sorting extracted to `use-sortable-table` |
| Charts | `AXIS_TICK` now follows the theme instead of a pinned light-mode hex |
| Route states | `loading.tsx`, `error.tsx` and `not-found.tsx` added; there were none |
| Price refresh | Ten minutes as documented, paused when hidden or the market is shut |
| Gating | Two identical access lists collapsed to one; 11 tests added where there were none |
| Mobile | Dark mode declared, three routes contract-typed, README corrected |
| Tests | 227 to 280, covering cost basis, realised P/L, the AKD importer and gating |

## Deliberately not done

**Shared design tokens (`packages/shared/src/tokens.json`).** Deferred. The
generator would have to emit 167 root variables, 32 dark overrides, 32 more
under `[data-theme]`, 21 `color-mix()` expressions and 41 `@theme` mappings,
then splice them into a 1,015-line stylesheet containing 130 hand-written
classes, and separately flatten the same values for React Native, which has no
cascade. One wrong variable breaks the theme everywhere, and no authenticated
page can be viewed from this environment to catch it. The drift it prevents is
real but slow: the two palettes were transcribed once and have not moved. It
wants a session that can run both apps side by side.

**Migration 0042 is written but not applied.** It swaps the closed feature
CHECK for a `feature_keys` table so adding a tab stops requiring a migration.
It is not destructive and the reversal is in the file, but it is a production
schema change and belongs with the Phase 2 migration work. Until it is applied
the old CHECK is in force and behaviour is unchanged.

**bulls-bears still holds ~20 hardcoded palette colours.** It is admin-only and
was flagged for possible deletion. Tokenising it means choosing replacements
for emerald, zinc and amber, which is a design decision, not a rename.

**Two charts keep bespoke axis colours.** `price-chart` uses `#475467` and
`financials-workspace` used `#344054`; the latter is gone with the file, the
former remains. Dark slate on a near-black ground is very likely invisible, but
fixing it changes light mode too.

**Sixteen tables stay hand-rolled.** The reasons are recorded in
`components/ui/table.tsx` at the point someone would go looking, along with the
rule for adding a third variant: it has to earn more than one caller.

**No jsdom.** Adding a browser test environment to a node-only Jest setup is a
change to the infrastructure, not a test.

## Things worth knowing

**Nothing in the app was ever seen rendered.** Every page except `/login`
requires an account and no demo account is configured locally, so verification
leaned on typecheck, the compiled stylesheet, class-set comparison, property
tests against the code being replaced, and route status codes. Where a change
could be proven exactly it was: 30,000 randomised sorts for the holdings
migration, 40,000 for the screener, 360 access decisions for the gating
consolidation, and a byte-identical `/login` screenshot across all four token
commits.

**`npm run validate` is green and should stay that way.** It was failing on 71
lint problems at the start of the phase. Four React-compiler rules are
suppressed at four call sites, each with its reason on the line above; the
convention is written in `CONTRIBUTING.md`.

**The legacy CSS aliases in `globals.css` are load-bearing.** No component uses
`bg-card` or `text-muted-foreground` any more, and the `@theme` mappings that
generated them are gone, but the variables behind them stay: 23 rules in that
file read them directly, including the body background.

## Next

Phase 2 is data integrity, and it is where the real problems are. The review
found duplicate-row risk on `transactions` and `cash_movements`, a
`company_payouts` unique key defeated by nulls, no `updated_at` triggers
anywhere, and macro series that are hardcoded arrays rather than fetched. Apply
0042 alongside that work.
