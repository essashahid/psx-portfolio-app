# Plumb — mobile screens

Ten responsive HTML screens. Open `index.html` and click through, or open any
screen directly. No build step, no framework, no network call except the icon
mask URLs.

```
handoff/mobile/
  index.html        contents page
  login.html  home.html  holdings.html  dividends.html  performance.html
  market.html  research.html  company.html  copilot.html  more.html
  mobile.css        the shell: app column, sticky chrome, icon mask, utilities
  ../tokens/*.css   design tokens, copied verbatim from the design system
```

## This is a viewport implementation, not a 402px mock

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  on every screen — `viewport-fit=cover` is what makes the safe-area insets resolve.
- `.app` is `width:100%; max-width:480px; margin-inline:auto; min-height:100dvh`.
  Below 480px it is full-bleed; above, it centres with hairline edges so the file
  previews honestly on a desktop. `dvh` (not `vh`) so the mobile URL bar
  collapsing does not clip the sticky bar.
- The page gutter is one custom property, `--g`: 16px on a phone, 20px from
  481px up. Nothing else changes at the breakpoint.
- Sticky chrome respects the hardware: `padding-top: calc(12px + env(safe-area-inset-top))`
  on the header, `calc(10px + env(safe-area-inset-bottom))` on the tab bar.
- Every tappable row carries `.tap` (`min-height: 44px`) or its own `min-height`.
  Inputs are 16px so iOS does not zoom the viewport on focus.
- Charts are `viewBox` SVG at `width:100%` — they scale with the column while
  the type around them does not. Where a line must not distort, `vector-effect="non-scaling-stroke"`.
- Grids that hold repeated cells use `repeat(auto-fit, minmax(…, 1fr))`, so the
  company page's six small multiples are two columns at 390px and three on a
  tablet without a media query.
- `@media (pointer: coarse)` drops the backdrop blur on the tab bar, and the
  design system's own `prefers-reduced-motion` collapse disables every transition.

## Navigation

Five slots, fixed: **Home · Holdings · Market · Copilot · More**. Everything else
lives in the More sheet. Copilot is reachable from every screen — that was a
deliberate call, since it is the fastest route from a number to an explanation.

## Graphics were redrawn, not scaled

| Desktop | Phone |
|---|---|
| Allocation donut | One 12px stacked rule + legend ledger |
| Distribution histogram | Turned on its side; bands read down the page as rows of dots |
| Sector performance tiles | Ranked rows with signed bars from a centre line |
| Benchmark table | Dumbbells against a centre line |
| Six-column fundamentals grid | `auto-fit` 2-up small multiples, 160×42 charts |
| Holdings table | Two-line rows: identity + value, then cost + gain, then weight bar |
| Seven company tabs | Three (Overview / Fundamentals / Filings) |

## Icons

Lucide, via CSS mask over `unpkg.com/lucide-static@0.487.0` — the same technique
the design system's `Icon` component uses, so a glyph inherits `currentColor`.
To go offline, drop the SVGs into `icons/` and change the `--u` URL in each
`.i` element (or lift it into a per-name class in `mobile.css`).

## Wiring it to real data

Each screen derives everything from one universe row —
`{ ticker, name, sector, price, day, vol, cap, pe, eps, low52, high52 }` — plus
the user's own `{ ticker, quantity, averageCost }` rows. Sector colour resolves
through one wrapper that assigns amber to Oil & Gas Marketing before delegating
to the design system's `SectorColor`; without that, marketing collides with
exploration's terracotta. One sector, one colour, every screen.

Keep the formatting rules: `toLocaleString("en-PK")`, a true minus (−) not a
hyphen, one decimal for portfolio-level moves and two for prices, tabular figures
everywhere (`.figure`), PKR spelled out — never Rs. or ₨. And keep the rule that
no figure appears twice from two sources.
