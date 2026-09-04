# Stock Research — build handoff

Static HTML of the Stock Research screener and one company page per PSX sector.
Open `screener.html` in a browser; every row links to its company page.
Nothing here needs a build step or a network call — the pages are plain HTML plus
eight token stylesheets and about 30 lines of vanilla JS for tab / metric / filing
switching.

## Files

```
docs/design/handoff/
  screener.html            Stock Research — the whole board
  company/<TICKER>.html    15 company pages, one per sector (see table)
  mobile/                  the ten phone screens (see mobile/README.md)
  tokens/*.css             design tokens, copied verbatim from the design system
```

| Ticker | Company | Sector | Header hue |
|---|---|---|---|
| ENGRO | Engro Corporation | Fertiliser | `#5e7d16` |
| MCB | MCB Bank | Commercial Banks | `#3450c8` |
| MARI | Mari Petroleum | Oil & Gas Exploration Companies | `#cd5b2e` |
| LUCK | Lucky Cement | Cement | `#8a7a66` |
| SYS | Systems Limited | Technology & Communication | `#6a4fd0` |
| TRG | TRG Pakistan | Technology & Communication | `#6a4fd0` |
| SEARL | The Searle Company | Pharmaceuticals | `#0f8a8a` |
| PSO | Pakistan State Oil | Oil & Gas Marketing Companies | `#cd5b2e` |
| HUBC | Hub Power Company | Power Generation & Distribution | `#c79a1e` |
| INDU | Indus Motor Company | Automobile Assemblers | `#4a6fa5` |
| ATRL | Attock Refinery | Refinery | `#b5532a` |
| AICL | Adamjee Insurance | Insurance | `#8f3fae` |
| NML | Nishat Mills | Textile Composite | `#c23a6b` |
| EPCL | Engro Polymer & Chemicals | Chemicals | `#0f7e96` |
| GHGL | Ghani Glass | Glass & Ceramics | `#2f9e8f` |

Chosen so every rendering path is represented: **MARI/ENGRO/MCB/LUCK/SEARL** are
in the book or on the watchlist (owned pill in the header), **TRG** is loss-making
(P/E reads "—", "loss-making period"), **SEARL** has no verified DPS (dividend tab
shows the no-payout statement and no yield is quoted anywhere on the page).

## How the page is built

**1. The header is sector-coloured.** `SectorColor(sector)` from the design system
returns a fixed Spectrum hex per PSX sector — indigo for banks, terracotta for
exploration, stone for cement. That one value drives four things and nothing else:

- the band tint: `background: color-mix(in oklab, <hue> 12%, var(--surface-page))`
- the 44px rule above the ticker
- the active tab underline
- the price track line, its area fill and the last-price dot, and the selected
  Fundamentals cell (band shading at 10% `fill-opacity`, 2px left edge)

Never use the hue for text or for direction. Gains stay `var(--text-up)`, losses
`var(--text-down)`.

**2. The header shows the shape, not just the level.** Right of the identity block
sits a 60-session price track: a `<svg viewBox="0 0 460 104" preserveAspectRatio="none">`
with two dashed hairlines at the 52-week high and low, an area fill of the hue at
12%, the line at 2px `vector-effect="non-scaling-stroke"`, and a 3.5px dot at the
last price. Scale the y-axis to the 52-week range, not to the series min/max — that
is what makes the rails meaningful. Below it, the percentage of range in words.

**3. Six tabs, each a different shape.** Overview (prose + key signals),
Fundamentals (small multiples), Earnings (surprise bars + ledger), Dividends
(announcement ledger), Technicals (indicators), Filings & news (dated spine).
Tab state swaps `hidden` on `[data-panel]`; there is no routing.

**4. Fundamentals is the centrepiece.** A 3×2 grid with `gap:1px` on a
`background: var(--rule)` parent — that is where the hairlines come from, not
borders. Each cell is a button carrying:

- FY2025 value, and the change on FY2024 coloured by whether the direction is
  *good for that metric* — a falling debt/equity is green
- a five-year line over a shaded rect spanning the company's own FY2021–FY2025
  min/max, plus the sector median as a dashed `var(--ink-3)` hairline
- both reference figures spelled out in words underneath

Click swaps the detail pair below: years with annual change, a one-line note on
what to read the metric against, and the sector ranking as a bar list with the
company in its own hue. Peer figures come from the same generator as the
company's, so the ranking is a true comparison.

**5. The filings spine.** Chips filter by event type; entries hang off a
continuous 1px column in a `grid-template-columns: 104px 1px minmax(0,1fr)`
(the middle column *is* the spine, so it never breaks between rows), with a 9px
node dot at `left:-4px`. Every entry names **the one figure it moved** in a
ruled band. Announcements that changed nothing say so in words instead.

## Wiring it to real data

Everything on a company page derives from one row of the universe:
`{ ticker, name, sector, price, day, vol, cap, pe, eps, low52, high52 }`.
In this export the five-year fundamentals, quarterly surprises and filings are
generated deterministically from that row so the demo is self-consistent. Replace
those generators with your own queries; keep the rule that **no figure appears
twice from two sources** — the header P/E and the Fundamentals EPS must be the
same number, and the filings entry for 1H FY2026 margin must be measured against
the FY2025 margin the Fundamentals cell shows.

Formatting to keep: `toLocaleString("en-PK")`, a true minus (−) not a hyphen,
one decimal for portfolio-level moves and two for prices, tabular figures
everywhere (`.figure`), and PKR spelled out — never Rs. or ₨.
