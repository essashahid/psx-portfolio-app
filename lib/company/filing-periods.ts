/**
 * Reading a PSX filing's reporting period off its own title.
 *
 * A filing's submission date does not tell you what it covers: companies file
 * late, refile after a revocation, and transmit the full report weeks after
 * the brief results notice. The title does say, because PSX titles state the
 * period end ("for the period ended March 31, 2026"). That is the filing's own
 * claim about itself, and it is the only free way to know which accounts a PDF
 * holds before paying to read it.
 *
 * Shared by the archive inventory (which needs to know what exists without
 * downloading anything) and the quarterly-history backfill (which needs to
 * pick one filing per reporting period).
 */

/** The cumulative periods a PSX company actually files. Q2/Q3/Q4 are never filed standalone. */
export type FilingPeriod = "Q1" | "H1" | "9M" | "FY";

export interface FilingTarget {
  fiscalYear: number;
  period: FilingPeriod;
}

const CUMULATIVE_MONTHS: Record<FilingPeriod, number> = { Q1: 3, H1: 6, "9M": 9, FY: 12 };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * The period-end date stated in a filing title, in any of the shapes PSX
 * titles use. Returns null when the title names no date at all, which is
 * common enough to be worth reporting rather than guessing at ("Transmission
 * of Annual Report 2019" names a year but not a year END, and for a June
 * filer those are different fiscal years).
 */
export function periodEndFromTitle(title: string): { year: number; month: number } | null {
  const out = readDate(title);
  if (!out) return null;
  // Companies typo their own filing titles and PSX serves it verbatim. HCAR
  // filed "Financial REsults for the Quarter Ended September 30, 3019", and a
  // single year a millennium out was enough to wreck the company entirely:
  // it became the newest fiscal year on record, the five-year window anchored
  // to it, and all 31 of HCAR's genuinely classified filings fell outside the
  // window and were reported as not on the portal. Reject what cannot be a
  // reporting period rather than letting one character redefine the calendar.
  const thisYear = new Date().getFullYear();
  if (out.year < 1990 || out.year > thisYear + 2) return null;
  if (out.month < 1 || out.month > 12) return null;
  return out;
}

function readDate(title: string): { year: number; month: number } | null {
  const iso = title.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };

  // Month first: "March 31, 2026".
  const monthFirst = title.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s*,?\s*(\d{4})\b/i
  );
  if (monthFirst) return { year: Number(monthFirst[2]), month: MONTHS[monthFirst[1].toLowerCase()] };

  // Day first: "31 March 2026". Both spellings are in active use across the
  // exchange and a company is consistent in its own. Handling only the
  // month-first form does not degrade gracefully: PPL writes every title day
  // first, so its entire 64-filing archive read as unclassifiable, its fiscal
  // year end could not be inferred, and the inventory reported it as having
  // nothing on the portal. A parser gap looked exactly like an absent company.
  const dayFirst = title.match(
    /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})\b/i
  );
  if (dayFirst) return { year: Number(dayFirst[2]), month: MONTHS[dayFirst[1].toLowerCase()] };

  // Day-first, the Pakistani convention: "30.06.2023" is 30 June.
  const numeric = title.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (numeric) return { year: Number(numeric[3]), month: Number(numeric[2]) };

  return null;
}

/**
 * Which cumulative period a set of accounts ending in `month` represents, for a
 * company whose fiscal year ends in `fyEndMonth`. PSX labels a fiscal year by
 * the calendar year it ENDS in, so a June filer's September 2025 quarter is
 * Q1 FY2026, not anything 2025.
 *
 * Returns null for a period end that is not a quarter boundary of this
 * company's year, which is a real thing that happens: a company changing its
 * year end files a transition period of five or fifteen months, and silently
 * rounding that to the nearest quarter would invent an accounting period.
 */
export function classifyFilingPeriod(
  end: { year: number; month: number },
  fyEndMonth: number
): FilingTarget | null {
  const elapsed = ((end.month - fyEndMonth + 12) % 12) || 12;
  const period = (Object.keys(CUMULATIVE_MONTHS) as FilingPeriod[]).find(
    (p) => CUMULATIVE_MONTHS[p] === elapsed
  );
  if (!period) return null;
  return { fiscalYear: end.month > fyEndMonth ? end.year + 1 : end.year, period };
}

/**
 * Whether a filing title denotes an actual set of financial statements.
 *
 * The exclusions are not decoration. PSX's own category is loose, and several
 * document types match on period wording while containing no statements:
 * Shariah compliance disclosures, dividend advertisements, briefing notices,
 * and filings the company itself REVOKED and refiled. Reading a revoked filing
 * means reporting figures the company has retracted.
 */
export function isReportTitle(title: string): boolean {
  const x = title.toLowerCase();
  // "Board Meeting Other Than Financial Results" contains the words "financial
  // results" and so passed the include test below, which is how board-meeting
  // notices came to be three quarters of everything the inventory could not
  // classify. Worse than noise: a notice dated on a quarter boundary can win an
  // otherwise empty reporting slot and later be sent to the extractor, paying
  // for a vision read of a one-line announcement.
  if (/board meeting|meeting of the board|bod meeting/.test(x)) return false;
  if (
    /shariah|video|briefing|presentation|clarification|notice of|proxy|agm|egm|book closure|circular|postal ballot|auditor|pattern of shareholding|advertisement|intimation|credit of|unclaim|revoked|withdrawn|cancelled|canceled/.test(
      x
    )
  ) {
    return false;
  }
  return /transmission|quarterly report|half[\s-]?year|annual report|annual account|financial result|financial statement|accounts for|condensed interim/.test(
    x
  );
}

export function isAnnualTitle(title: string): boolean {
  return /annual report|annual account|annual financial statement/i.test(title);
}

/**
 * The reporting period a filing covers, or null if its title does not say.
 *
 * This is the single decision both the inventory and the backfill make, so it
 * lives here rather than being reimplemented either side. It also handles the
 * case a bare date parse cannot: an annual report titled with nothing but a
 * year ("Transmission of Annual Report 2019"). PSX labels a fiscal year by the
 * calendar year it ends in, so for an annual filing that year IS the fiscal
 * year, and dropping those loses real audited accounts over a title style.
 * The shortcut is deliberately limited to annual titles, because for an
 * interim a bare year says nothing about which quarter.
 */
export function classifyTitle(title: string, fyEndMonth: number): FilingTarget | null {
  const end = periodEndFromTitle(title);
  if (end) return classifyFilingPeriod(end, fyEndMonth);

  if (isAnnualTitle(title)) {
    const year = title.match(/\b(19|20)\d{2}\b/);
    const thisYear = new Date().getFullYear();
    if (year && Number(year[0]) >= 1990 && Number(year[0]) <= thisYear + 2) {
      return { fiscalYear: Number(year[0]), period: "FY" };
    }
  }
  return null;
}

/**
 * Preference order when several filings cover the same period. A full report
 * carries the condensed balance sheet and cash flow; a brief "Financial
 * Results" notice is usually a one-page P&L. Both state the same EPS, but only
 * the former is worth the extraction when one is being paid for either way.
 */
export function rankReportTitle(title: string): number {
  const x = title.toLowerCase();
  if (isAnnualTitle(x)) return 0;
  if (/transmission|quarterly report|half[\s-]?year|condensed interim/.test(x)) return 1;
  return 2;
}

/**
 * A company's fiscal year end month, inferred from the period ends its own
 * ANNUAL filings state. Used when company_metadata has not recorded one yet.
 * The most frequent value wins rather than the most recent, so a single
 * mistitled filing cannot redefine the company's calendar.
 */
export function inferFiscalYearEndMonth(titles: string[]): number | null {
  // Annual-report titles first. Failing that, anything saying "year ended",
  // which states the year end just as precisely: plenty of companies file
  // their audited accounts as "Financial Results for the Year Ended 30 June
  // 2025" and never use the word "annual" at all.
  const vote = (accept: (t: string) => boolean): number | null => {
    const counts = new Map<number, number>();
    for (const t of titles) {
      if (!accept(t)) continue;
      const end = periodEndFromTitle(t);
      if (!end) continue;
      counts.set(end.month, (counts.get(end.month) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestCount = 0;
    for (const [month, n] of counts) {
      if (n > bestCount) {
        best = month;
        bestCount = n;
      }
    }
    return best;
  };

  return vote(isAnnualTitle) ?? vote((t) => /year\s+end(ed|ing)?\b/i.test(t));
}

/** Filing dates are human strings ("Apr 30, 2026"); Date.parse handles them. */
export function filingDateMs(d: string | null): number {
  const n = d ? Date.parse(d) : NaN;
  return Number.isFinite(n) ? n : 0;
}
