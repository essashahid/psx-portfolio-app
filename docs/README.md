# Documentation

| Directory | Contents |
|---|---|
| `architecture/` | How the repository is laid out, layer boundaries, where new files go |
| `development/` | Working references for developers, including sample generated output |
| `operations/` | Running the deployed app: feature gating, launch decisions |
| `research/` | Product notes and ideas that are not built yet |
| `design/` | Visual and layout references |

Files here describe what is actually in the repository. If a change makes one of
them wrong, fix it in the same change.

## Contents

- `architecture/repository-structure.md` — the directory tree, dependency
  direction, client/server rules, and a table of where each kind of new file
  belongs.
- `development/sample-company-report-fccl.pdf` — one output of the company
  report generator (FCCL, 14 pages, generated 2026-06-25). Kept as a reference
  for the PDF export layout. It is reproducible: generate a report for any
  ticker and export it as PDF. Nothing imports it.
- `operations/launch-disabled-features.md` — which app surfaces are hidden for
  launch, where the flags live, and how to restore each one.
- `research/bulls-and-bears-video-insights-idea.md` — an unbuilt idea for
  deriving Bulls & Bears content from video transcripts. Not a specification.
- `design/` — visual and layout source material: the Stock Research build
  handoff and its ten phone screens, the brand and motion assets, the News
  Centre canvas, and the outlook mock. None of it is part of the build and
  nothing imports it. See `design/README.md`, which also notes the two items
  that are load-bearing.

Other documentation lives next to what it describes: `scripts/README.md`,
`data/README.md`, `samples/README.md`, and `CONTRIBUTING.md` at the root.
