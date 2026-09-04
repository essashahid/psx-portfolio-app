# Plumb — motion & brand assets: implementation brief

**This brief was implemented in July 2026. It is kept as the brand
specification, not as work to do.** The motion tokens and keyframes live in
`app/globals.css`, the splash in `components/shared/plumb-splash.tsx`, and the
mark in `components/shared/plumb-mark.tsx` and `mobile/components/ui/mark.tsx`.
The SVGs beside this file are still the only vector masters, and the size table
below is what both mark implementations cite.

Original brief follows.

For an agent with write access to `essashahid/psx-portfolio-app` (branch `main`).
Everything needed is in this folder. No design tool, no new dependency.

```
docs/design/brand/
  IMPLEMENT.md          this file
  motion.css            all tokens, keyframes and state classes — paste target below
  splash.html           cold-start splash markup
  brand/
    plumb-mark.svg              64px mark, paper field
    plumb-mark-on-navy.svg      64px mark, navy field
    plumb-mark-mono.svg         single-colour, currentColor
    favicon-16.svg              16px — aperture + line, no bob
    favicon-32.svg              32px — aperture + line, no bob
    app-icon.svg                1024 iOS / PWA
    app-icon-maskable.svg       1024 Android maskable, 80% safe circle
```

---

## What this is

Seven things the product does not have yet: a real brand mark, a launch
sequence, press states that follow one rule, waiting states shaped like the
data they replace, two distinct behaviours for changing figures, three
transitions, and a single switch that turns all of it off.

**Do not treat this as decoration.** Every value below is derived from the
motion system already in `app/globals.css` — four durations, one easing curve.
The point of this brief is to stop those tokens being bypassed with ad-hoc
`transition-all duration-200` utilities, which is what most of the codebase
currently does.

---

## Order of work

Six commits. Each is independently revertable and independently shippable.

### 1 · Tokens and state classes

Append `motion.css` to `app/globals.css`. Read the top of the file first: the
four duration tokens and `--ease-out` are **already defined there** — verify the
values match and delete the duplicates from the appended block rather than
shadowing them.

Then do the removal that makes this worth doing:

```
rg 'transition-all|duration-\[|duration-(75|100|200|500|700|1000)' app components
```

Every hit is a control animating on a value outside the system. Replace with the
classes in `motion.css` (`.btn-ink`, `.btn-outline`, `.btn-ghost`, `.chip`,
`.ledger-row--interactive`, `.navslot`) or, where a bespoke transition is
genuinely needed, with `var(--dur-fast)` / `var(--dur-base)` and
`var(--ease-out)`. **No new duration values.**

Acceptance: `rg 'transition-all'` returns nothing under `app/` or `components/`.

### 2 · Brand mark

Replace the stock app icon and the `candlestick-chart` brand glyph.

| File in repo | Replace with |
|---|---|
| `public/icons/icon-512x512.png` | rasterise `brand/app-icon.svg` at 512 |
| `public/icons/icon-192x192.png` | rasterise `brand/app-icon.svg` at 192 |
| `public/apple-touch-icon.png` | rasterise `brand/app-icon.svg` at 180 |
| new: `public/icons/maskable-512.png` | rasterise `brand/app-icon-maskable.svg` at 512 |
| `app/favicon.ico` / `app/icon.svg` | `brand/favicon-32.svg` |

Add the maskable entry to the web manifest:

```json
{ "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
```

Then add a `<PlumbMark />` component (inline SVG, `currentColor` for the
aperture, `--indigo-2` for the line) and use it everywhere the sidebar and
login currently render `<CandlestickChart />` as the brand glyph. Keep
`candlestick-chart` as a *content* icon if it labels a chart somewhere — it is
only the brand use that changes.

**Size rule, and it matters:** stroke thickens as the mark shrinks, and the bob
is dropped at and below 16px, where it would close the line into a blob. Use the
provided per-size files; do not scale the 64px one down.

| Rendered size | Stroke | Bob | Inset |
|---|---|---|---|
| 64 and up | 3.55 | yes | 14 |
| 32 | 4.4 | yes | 14 |
| 24 | 5.6 | yes | 13 |
| 16 | 7.5 | **no** | 12 |

The line is the only coloured part, and it is always indigo — `--indigo-2` on
paper, `--indigo-3` on navy so it clears the field.

### 3 · Splash

Add `splash.html`'s markup as a client component mounted from the app shell.

Three rules, in priority order:

1. **Cold start only.** On a warm resume, skip it and restore the last screen.
   Gate on a module-scope flag or `performance.getEntriesByType('navigation')`,
   not on a render count.
2. **Never hold the app back.** Unmount at `max(1180ms, first screen ready)`.
   If data is ready at 400ms, the splash still finishes its 1180ms — but if data
   takes 3s, the splash does **not** extend to cover it; hand off to the
   skeleton instead.
3. **Under reduced motion,** `motion.css` already collapses the animation; the
   splash then shows its final frame for one paint and unmounts.

There is a second, separate case: **import in progress**. Paper field, line
only, no wordmark, and a status line naming the actual pipeline stage
(`parsed` → `matched` → `pricing` → `reconciling`). Those stages exist in the
import code already — surface their real names, never a generic "Loading…".

### 4 · Waiting states

Replace every spinner that sits where a *known* shape will land.

- **Ledger skeleton** — same grid template, same row min-height, same hairline
  rules as the real table, with `.sk-shimmer` on the bars. The page must not
  reflow when data arrives; if it does, the skeleton's grid does not match.
- **Spinner** (`.spin` on `loader-circle`) only where the shape is genuinely
  unknown, and inline at 15px — never a full-screen spinner.
- **Import progress** — the four named stages, with the count for each
  (`209 of 214 matched`), and the honest line: *"Five rows need your eyes —
  uncertain rows are never silently applied."*
- **Market-open pulse** — `.pulse-live`, and set
  `data-market="closed"` outside 09:30–15:30 PKT. A pulse running against a
  stale figure is a lie about freshness, so this attribute is not optional.

### 5 · Figures

Two behaviours. **Do not put both on the same figure.**

**Count-up — an entrance.** Once, on arrival, over `--dur-count` (1300ms),
eased on `--ease-out` so it decelerates into its final value instead of
stopping dead. Only on a page's single headline figure (portfolio value, XIRR,
KSE-100 level). Digits must be tabular, or the number shifts sideways as it
runs. The existing `AnimatedMoney` component is the right home for this.

```ts
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
// rAF loop over --dur-count; bail to the final value immediately if
// matchMedia('(prefers-reduced-motion: reduce)').matches
```

**Tick tint — a notification.** On every price change: `.tick` with
`data-flash="up" | "down"`, cleared after ~320ms. The tint is the directional
colour at 14%, and it releases over `--dur-base`. Colour never carries the
meaning alone — the signed percentage stays visible beside it.

**Chart draw.** `.draw-line` with `--draw-length` set from
`path.getTotalLength()` on mount, at `--dur-draw` (850ms). **First paint only** —
a chart that redraws on every filter change is exhausting. Guard it with a ref,
not a state flag that a re-render resets.

### 6 · Transitions

Three. Adding a fourth needs a conversation.

- **Tab underline** — `.tabstrip__underline`, animating `left`/`width` over
  `--dur-fast`, coloured `--tab-hue` from `SectorColor(sector)` on a company
  page. The panel below swaps with **no fade**: a cross-fade between two tables
  of figures makes both unreadable for a moment.
- **Sheet** — `.sheet` + `.scrim` over `--dur-base`. Dismiss takes the *same*
  duration; any faster reads as cancelled rather than closed.
- **The cascade** — `.rise` on the direct children of the Home page's band
  stack, **once per session** on the splash hand-off, and dropped entirely on
  coarse pointers (already handled by the `pointer: coarse` query).

---

## Sector colour — one existing bug to fix while you are here

`lib/shared/sector-colors.ts` tests `/oil.*gas/` before `/oil.*market/`, so
**"Oil & Gas Marketing Companies" resolves to exploration's terracotta
`#cd5b2e`** instead of amber `#d9920b`. Wrap the resolver — marketing checked
first, everything else delegated — and route *every* call site through the
wrapper, not just the one you are touching. One sector, one colour, app-wide.

```ts
const SECTOR_HUE: Record<string, string> = { 'Oil & Gas Marketing Companies': '#d9920b' };
export const sectorColour = (s: string) => SECTOR_HUE[s] ?? SectorColor(s);
```

---

## The rules, as acceptance criteria

Each of these is checkable, and each exists because the opposite is worse.

1. **Background shifts, opacity does not.** An opacity fade on a figure makes it
   briefly unreadable. Fills keep contrast predictable.
2. **Nothing scales or bounces under a thumb.** No `transform: scale()` on
   `:active`, anywhere. Press uses the hover fill.
3. **Motion never delays a figure.** If the number is ready, it is on screen.
   Animation fills waiting that already exists; it never manufactures any.
4. **Direction colour is never decorative.** Emerald, red and flat grey mean
   gain, loss, unchanged — nowhere else, ever. This is why a selected state is
   indigo and not emerald.
5. **One pulse in the product** (market open), and it stops at the close.
6. **The cascade runs once per session,** on the splash hand-off, never on a
   phone.
7. **One media query disables all of it.** `prefers-reduced-motion` collapses
   the duration tokens in `motion.css`. Do not add a per-component branch — if
   a component needs its own reduced-motion handling, the animation is wrong.
8. **Four durations only.** `rg 'duration-\[' ` must return nothing.

---

## Open decisions — do not invent an answer

- **Haptics.** iOS can fire a light impact on a *completed import* or a
  *confirmed transaction* — something the user did. It must never fire on a
  price change: a buzz for something you did not do is an alarm. Not
  implemented here; confirm before adding.
- **Sound.** None. Recommend keeping it that way.
- **Dark mode.** The navy is a *brand field*, not a dark theme. A true dark
  mode is a separate ramp and a separate decision — do not derive one from the
  navy tokens.
- **Offline / stale.** Intended behaviour: the pulse stops, the `AsOf` stamp
  goes amber, and figures keep their last value rather than blanking. Needs the
  real service-worker behaviour to finish; drafted in principle only.

---

## Reference

The live specimen gallery is `Motion & Assets.dc.html` in the design project —
every state in this brief is rendered there, looping, with the interactive
controls actually pressable. If a value here is ambiguous, that file is the
source of truth.
