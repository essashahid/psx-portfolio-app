# `data/`

Files on disk that are not source code. Everything here is read by path or by
`@/data/...` import, always relative to the repository root.

| Directory | What lives there | Committed? | Lifecycle |
|---|---|---|---|
| `reference/` | Canonical inputs the application and scripts depend on. | Yes | Changed deliberately, by a script or by hand, and reviewed |
| `external/` | Snapshots of third-party data, kept verbatim. | Yes | Refreshed from the vendor; never hand-edited |
| `queues/` | Work lists for operational scripts: which tickers still need a pass. | Yes | Edited freely as work progresses; no consumer beyond the scripts |
| `generated/` | Output of audit and evaluation scripts. | Yes | Overwritten by re-running the producing script |
| `private/` | Real personal financial documents used as a local input. | Yes — see the warning below | Replaced by the owner |
| `filings-cache/` | Downloaded filing PDFs. Git-ignored (`.cache/filings/`). | No | Rebuildable from `reference/filings-inventory.json` |

## `reference/`

| File | Produced by | Read by |
|---|---|---|
| `verified-tickers.json` | `scripts/maintenance/promote-auto-verified.ts` | `lib/engine/verified.ts`, `lib/engine/registry-health.ts` |
| `sarmaaya-snapshots.json` | `scripts/data/import-sarmaaya-snapshots.ts` | `lib/engine/data-health.ts`, `lib/engine/registry-health.ts`, several scripts |
| `filings-inventory.json` | `scripts/data/build-filings-inventory.ts` | `scripts/maintenance/agent-reconcile.ts`; records each cached filing's source URL and fetch date |
| `outlook-phase3-evaluation.json` | `scripts/evaluations/eval-outlook-forecast.ts` | `lib/engine/outlook/read.ts`, `lib/engine/outlook/refresh.ts`, `app/(app)/outlook/research/page.tsx` |
| `outlook-experimental.json` | `scripts/evaluations/eval-outlook-forecast.ts` | `app/(app)/outlook/research/page.tsx` |

The two outlook files are generated but committed on purpose: the application
imports them at build time, so the walk-forward evaluation they carry has to be
in the repository, not regenerated at request time.

## `external/sarmaya/stocks/`

848 files, one `.csv` and one `.json` per PSX ticker, named by ticker in
uppercase (`ABOT.json`, `LUCK.csv`). Uppercase ticker filenames are a
deliberate exception to the repository's kebab-case rule: the filename *is* the
ticker.

- **Provenance**: company snapshots from Sarmaaya, a Pakistani market-data site.
- **Purpose**: an independent reference used to validate this project's own
  ratio engine (EPS, P/E, P/B). It is not a source of truth for the app.
- **Refresh**: the files are collected outside this repository, then loaded into
  `reference/sarmaaya-snapshots.json` with
  `npx tsx scripts/data/import-sarmaaya-snapshots.ts`. Nothing in `app/` or
  `lib/` reads this directory directly.
- **Do not hand-edit.** A divergence between these files and our computed
  figures is the signal the reconciliation scripts look for. Corrections belong
  in the financial data, not here.

Where Sarmaaya reports a group (consolidated) figure and this project computes
the unconsolidated figure to match PSX, `basis: "consolidated"` records that,
so an EPS gap there is expected rather than a defect.

## `queues/`

Plain ticker lists (`wave1.txt`, `retry-queue.txt`, `extraction-queue.txt`, …)
passed to scripts that accept `--from-file`, plus `remediation-progress.json`,
which `scripts/maintenance/fix-divergent-universe.ts` uses to resume. These are
scratch work-tracking files with no schema and no application consumer.

## `private/` — real personal data, never committed

Holds **real financial documents belonging to the repository owner**: an AKD
Securities account statement and a CDC holdings export, with actual holdings,
trades, and cash balances.

The directory is git-ignored. Nothing in it should ever be added to a commit.

`lib/engine/performance.ts` can read a statement as a local development
fallback when none has been uploaded to Supabase Storage, but only from the path
in the `AKD_LEDGER_PDF_PATH` environment variable. It no longer falls back to a
hard-coded path inside this directory, so the feature no longer depends on a
personal document sitting in the working tree. Point that variable at a copy
outside the repository.

### Still outstanding: the Git history

These files were tracked until 2 August 2026 and **remain in the repository
history**. Untracking them stops future commits from carrying them; it does not
remove the existing blobs. Anyone with a clone, and anyone who gains access to
one later, can still recover them.

Clearing that requires a history rewrite (`git filter-repo --path data/private
--invert-paths`) followed by a force push, which rewrites every commit hash and
invalidates existing clones. Until that is done, treat this repository as
private and do not publish it or grant read access.
