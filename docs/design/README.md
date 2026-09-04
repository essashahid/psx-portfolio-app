# Design references

Visual and layout source material. None of it is part of the build, nothing
imports it, and no route serves it. Open the HTML files directly in a browser.

These are kept because they are the written form of decisions the code only
implements: which colour a sector gets, why a figure is never printed twice from
two sources, how the mark is drawn at 16px. When the code and one of these
disagree, the code is what ships, but the disagreement is worth resolving rather
than ignoring.

| Path | What it is | Status |
|---|---|---|
| `handoff/` | Static HTML of the Stock Research screener and 15 company pages, one per PSX sector, plus the eight token stylesheets they are built on. The README is a full build specification. | Partly built. `app/(app)/stocks/` follows it; the Fundamentals grid it specifies is still ahead of what ships. |
| `handoff/mobile/` | Ten responsive phone screens with their own README covering navigation, safe areas, and which desktop graphics were redrawn rather than scaled. | Built. `mobile/app/` implements all ten. |
| `brand/` | The mark, app icons and favicons as SVG, the motion stylesheet, the splash markup, and `IMPLEMENT.md` with the per-size stroke table. | Built, and still the only vector masters. |
| `news-centre/` | Claude Design canvas artboards for the News Centre, plus an exported HTML page. | Phase 1 built. The data work behind it is not. |
| `psx-outlook-design-reference.html` | Standalone mock used while designing the outlook pages. | Built. |

## Two things here are load-bearing

**`brand/` holds the only vector sources for the app icons.** Everything shipped
is a PNG derivative: `public/icons/`, `public/apple-touch-icon.png`, and
`mobile/assets/`. Regenerating any of them at a new size starts from these SVGs.
The size table in `brand/IMPLEMENT.md` is the table
`components/shared/plumb-mark.tsx` and `mobile/components/ui/mark.tsx` cite when
they pick a stroke width, so the two implementations agree only as long as it
does.

**`handoff/` is cited from outside itself.** Its sector table is the expected
data in `__tests__/shared/sector-colors.test.ts`, its Fundamentals grid is
measured against real coverage in `docs/operations/data-pipeline-gaps.md`, and
`app/(app)/stocks/[ticker]/panels.tsx` refers to it in a comment.

## Where these came from

`handoff/`, `handoff/mobile/` and `brand/` sat at the repository root as
`handoff/`, `mobile copy/` and `handoff 3/` until September 2026. The last two
names were Finder duplicates, and `mobile copy/` had been moved out of
`handoff/mobile/`, which broke every `../tokens/*.css` link in its ten screens.
Moving all three here removed the clutter and repaired those links; nothing was
edited beyond the paths inside their own READMEs.
