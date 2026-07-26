# Data pipeline: what is missing and what it costs us

Measured against the live database on **26 July 2026**. Every figure here was
counted, not estimated. The queries are described at the end so this can be
re-run and the numbers moved.

The short version: **prices are healthy, fundamentals are not.** Price history
covers the traded universe and is current to the session. Filed accounts cover
roughly half the universe, reach about four years at best, and are missing the
balance sheet three times out of four. Almost every gap in the company page
traces back to that.

---

## 1. Freshness

| Feed | Latest row | Age | Verdict |
|---|---|---|---|
| Price history | 2026-07-24 | 2 days | Current (last trading day) |
| Market snapshot | 2026-07-24 | 2 days | Current |
| Macro assets (BTC, gold, USD/PKR, T-bill) | 2026-07-24 | 2 days | Current |
| Financial extractions | 2026-07-25 | 1 day | Actively running |
| Company payouts | 2026-06-29 | **27 days** | Stale |
| Alerts | 2026-07-06 | **19 days** | Stale |

Price staleness across all 500 tickers with history: **every one is within 3
days**. There is no long tail of dead tickers in the price feed.

The two stale feeds matter for different reasons. Payouts drive the dividend
yield shown in the company header and the payout calendar; 27 days means a
declared dividend can sit unrecorded for most of a month. Alerts at 19 days
means the bell count on the header is not describing the present.

---

## 2. Coverage

| Layer | Count | Notes |
|---|---|---|
| `stock_master` rows | 1,068 | The full registry, including dead and non-equity lines |
| Tickers in the latest snapshot | 505 | The realistic live universe |
| Tickers with price history | 500 | Effectively complete |
| Tickers with published annual accounts | 522 | Includes some no longer trading |
| Tickers with announced payouts | 235 | **47%** of the live universe |

Judge coverage against roughly 500 live companies, not the 1,068 registry rows.

### Financial rows by shape

Of 9,520 rows in `company_financials`:

- **8,965 published**, 555 `needs_review` — a backlog that is invisible to the app
- 6,100 income statements, 1,714 balance sheets, 1,706 cash flow statements
- 3,580 annual, 3,592 quarterly, 2,348 cumulative

That income-statement skew is the single most consequential fact in this
document.

---

## 3. The statement gap

A fiscal year is only complete once all three statements are extracted. Across
**1,967 published annual ticker-years**:

| Completeness | Count | Share |
|---|---|---|
| All three statements | 406 | **21%** |
| Income statement only | 1,441 | 73% |
| Missing balance sheet | 1,475 | **75%** |
| Missing cash flow | 1,527 | **78%** |

Everything that needs a balance sheet or a cash flow statement is therefore
unavailable for three companies in four. This is not a extraction-quality
problem — those statements are simply not being pulled.

**If one thing gets fixed, make it this.** It unblocks more of the design than
any other change.

---

## 4. What the design asks for, and what we can actually track

The handoff's Fundamentals grid specifies six metrics over five filed years,
each against a sector median. Measured per metric, by number of companies with
at least N filed years:

| Metric | Needs | ≥2 yrs | ≥3 yrs | ≥4 yrs | ≥5 yrs | Trackable today |
|---|---|---|---|---|---|---|
| Revenue | Income statement | 449 | 409 | 386 | 9 | **Yes** |
| EPS | Income statement | 490 | 463 | 447 | 7 | **Yes** |
| Net margin | Income statement | 419 | 382 | 360 | 9 | **Yes** |
| Gross margin | Income statement | — | — | — | — | **Yes** (380 of 522 companies file it) |
| Return on equity | + Balance sheet | 149 | 47 | 9 | 4 | Thin |
| Cash conversion | + Cash flow | 160 | 48 | 2 | 2 | Thin |
| Debt to equity | + Balance sheet | 99 | 25 | 3 | 0 | **No** |

Two structural conclusions:

**The five-year design cannot be built.** Depth collapses between four years and
five (revenue: 386 → 9). The backfill reaches about four years. The grid was
built to draw whatever exists, so this degrades rather than breaks, but the
"FY2021–FY2025 range" the design describes is not available for anyone.

**Three of the six designed metrics are effectively unavailable.** Debt to
equity reaches three years for 25 companies out of 522. The company page
backfills with derived income-statement metrics (revenue growth, gross margin,
EPS growth) to avoid a grid of blanks — that is a workaround for this gap, and
it should be removed once balance sheets land.

### Sector medians

A median needs at least five contributing companies to mean anything. Of **37
sectors** with any filer:

| Metric | Sectors with ≥5 filers |
|---|---|
| Revenue / EPS | 27 |
| Net margin | 26 |
| Gross margin | 23 |
| Return on equity | 18 |
| Cash conversion | 16 |
| Debt to equity | **10** |

So even where a metric exists for a company, the sector comparison often cannot
be drawn. Oil & Gas Exploration has only four companies with priced earnings, so
Mari shows no sector P/E at all.

---

## 5. Integrity problems

Ranked by how much damage each can do to a number someone acts on.

### 5.1 Conflicting extractions with no provenance

**471 cases** where the same ticker, year and statement has more than one
extraction. **66 of those disagree by more than 10%** on a headline figure:

```
LUCK   2025 income_statement  eps: 22.59 vs 52.53     (2.3x apart)
SYS    2024 income_statement  eps: 5.41 vs 4.19
FFC    2025 income_statement  eps: 51.69 vs 58.44 vs 51.69
DINT   2023 income_statement  eps: -16.53 vs 65.63    (sign flip)
FATIMA 2025 income_statement  eps: 14.51 vs 20.03
```

The reader is currently shown the most recently updated row and told nothing.
There is no restatement marker, no way to see the superseded value, and no
signal that a figure is contested. A Lucky Cement EPS that is either 22.59 or
52.53 changes its P/E by a factor of two.

**This is the most dangerous item in this document**, because the number looks
authoritative either way.

### 5.2 Units are per-row and can be absent

Money is filed in thousands of rupees, declared in each row's own `_units`
field. **2 published annual rows declare nothing.** The loader now refuses those
rather than assuming, because assuming is a 1000x error that still looks like a
number — this was found when Mari's revenue read as 177 million instead of 177
billion.

Two rows is small today. It is a silent, high-blast-radius failure that scales
with the pipeline, so units should be validated at write time rather than
defended against at read time.

### 5.3 Values that are arithmetically fine and economically meaningless

Holding companies book minimal standalone revenue against large associate
income, so `profit ÷ revenue` explodes. TRG produced a net margin of
**201,436%** with a filed range of −1,204,063% to 201,436%.

The company page now drops values outside a believable band per metric. That is
a display guard, not a fix — the underlying extraction is arguably correct and
the metric is simply wrong for that company type. Banks and insurers have the
same problem with different ratios, which is why the ratio engine already
carries bank-specific measures (ADR, cost-to-income, markup income).

**Company type should be a first-class field** driving which metrics are
computed at all.

### 5.4 A review backlog nothing surfaces

**555 rows sit at `needs_review`.** They are excluded from every read path, so
they are invisible: no queue, no count, no page. Whatever is wrong with them is
not being worked off, and their absence looks identical to data that was never
fetched.

### 5.5 No history depth beyond about four years

Independent of the statement gap, nothing reaches five years. Any feature that
wants a cycle — a five-year range, a CAGR, a through-cycle margin — cannot be
built. The `/outlook` engine already hit this as a five-year data ceiling.

---

## 6. Suggested order of work

1. **Balance sheets and cash flow statements.** Unblocks ROE, debt to equity and
   cash conversion — half the designed grid — and their sector medians. Nothing
   else changes as much per unit of effort.
2. **Extraction conflict resolution.** Decide a winner deterministically, record
   why, keep the superseded value, and mark restated figures in the UI. 66 known
   conflicts today, growing with volume.
3. **Payout freshness.** 27 days stale on 47% coverage, and it drives a headline
   yield. A daily announcement sweep would fix both.
4. **Units validated at write time**, rejecting or quarantining undeclared rows
   at the source rather than at every reader.
5. **Company-type classification**, so holding companies, banks and insurers get
   metrics that mean something instead of a plausibility filter hiding the ones
   that do not.
6. **Work off the 555-row review backlog**, and give it a visible queue so it
   cannot silently regrow.
7. **History depth to five-plus years**, which makes the design's grid buildable
   as drawn and lets the backfilled derived metrics be retired.

---

## 7. Re-measuring

Every number above comes from `company_financials`, `stock_master`,
`company_price_history`, `company_payouts` and `market_snapshot_items`, read
with the service-role client. The method that matters:

- **Merge statement types before judging a year.** A metric spanning two
  statements (cash conversion needs operating cash flow and profit after tax)
  is found far less often if rows are read individually. Counting per row
  understates coverage badly.
- **Filter to `review_status = 'published'`**, or the 555-row backlog inflates
  every count.
- **Scale money by the row's `_units`** before comparing anything across
  companies.
- **Judge coverage against ~500 live tickers**, not the 1,068 registry rows.

A throwaway script under `scripts/verification/` reproducing these counts is the
quickest way to check progress; none is committed, since the numbers are meant
to change.
