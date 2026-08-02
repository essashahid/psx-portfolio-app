import type { SupabaseClient } from "@supabase/supabase-js";
import { saveManualStatements } from "@/lib/engine/financials";

/**
 * Turn the cumulative periods a PSX company actually files into the discrete
 * quarters nobody publishes.
 *
 * PSX interims are cumulative: a company files 3M, 6M and 9M, then a full
 * year. It never files Q2, Q3 or Q4 standalone, so three of every four
 * quarters exist in no document and have to be differenced out:
 *
 *   Q1 = 3M          Q2 = 6M − 3M
 *   Q3 = 9M − 6M     Q4 = FY − 9M
 *
 * This lives here rather than in the backfill script because it has to run on
 * a schedule. The one-off backfill built five years of history; without this
 * on the cron, the next set of results lands as another cumulative row and the
 * history simply stops growing.
 *
 * Deliberately refuses more than it computes. A quarter is only written when
 * the two cumulative rows agree on reporting basis, neither mixes columns, and
 * no directly-reported quarter already exists for that slot. Everything it
 * declines to do is returned in `gaps` rather than swallowed.
 */

/** Income-statement figures that accumulate through a fiscal year, so they subtract. */
const FLOW_KEYS = [
  "revenue", "cost_of_sales", "gross_profit", "operating_expenses", "operating_profit",
  "finance_cost", "profit_before_tax", "tax", "profit_after_tax", "eps",
] as const;

const CUMULATIVE_PERIODS = ["Q1", "H1", "9M", "FY"];

/** Q1 is already a standalone quarter; the other three are differences. */
const RECIPES = [
  { quarter: "Q2", cumulative: "H1", prior: "Q1" },
  { quarter: "Q3", cumulative: "9M", prior: "H1" },
  { quarter: "Q4", cumulative: "FY", prior: "9M" },
] as const;

/**
 * How far an implied share count may sit from the company's own median before
 * the row is treated as mixing columns. Bonus issues and splits move the real
 * count, so this is loose enough not to fire on a genuine corporate action.
 */
const SHARE_TOLERANCE = 0.1;

interface StoredRow {
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_type: string | null;
  statement_type: string | null;
  source_url: string | null;
  source_type: string | null;
  reporting_basis: string | null;
  reported_date: string | null;
  updated_at: string | null;
  data: Record<string, unknown> | null;
}

export interface DerivationResult {
  ticker: string;
  written: number;
  needsReview: number;
  bleedRepaired: number;
  bleedQuarantined: number;
  /** Quarters deliberately not derived, each with the reason. */
  gaps: string[];
  /** Derived quarters compared against a directly-reported one; `material` marks a real disagreement. */
  crossChecks: { period: string; reported: number; derived: number; offPct: number; material: boolean }[];
}

const num = (d: Record<string, unknown> | null, k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const dateMs = (d: string | null): number => {
  const n = d ? Date.parse(d) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Profit after tax, to the rupee, as a row's fingerprint.
 *
 * A mislabelled comparative is a verbatim copy of a row some other filing
 * already reported for the year it was really about, and two fiscal periods of
 * genuine trading never post the same profit to the rupee. Revenue is
 * deliberately not part of this: OGDC's December 2023 half-year produced a Q2
 * carrying that year's revenue beside the PRIOR year's profit, the model
 * having read the two figures from different columns, and matching on revenue
 * as well would have missed it.
 */
const fingerprint = (d: Record<string, unknown> | null): string | null => {
  const pat = num(d, "profit_after_tax");
  return pat === null ? null : String(pat);
};

async function loadPublishedIncome(db: SupabaseClient, ticker: string): Promise<StoredRow[]> {
  const { data } = await db
    .from("company_financials")
    .select(
      "fiscal_year, fiscal_period, period_type, statement_type, source_url, source_type, reporting_basis, reported_date, updated_at, data"
    )
    .eq("ticker", ticker)
    .eq("statement_type", "income_statement")
    .eq("review_status", "published");
  return (data ?? []) as StoredRow[];
}

/**
 * Repair rows whose figures are a verbatim copy of another fiscal year's.
 *
 * Every interim filing prints the current period beside the same period a year
 * earlier, and the extractor sometimes assigns the two years the wrong way
 * round. Nothing errors: both figures are real, both are plausible, and the
 * wrong one is a year stale. Where the correct column is also in the
 * observation ledger under the wrong year the labels are swapped back;
 * otherwise the row is quarantined rather than served.
 */
async function repairComparativeBleed(
  db: SupabaseClient,
  ticker: string,
  stored: StoredRow[]
): Promise<{ repaired: number; quarantined: number }> {
  const out = { repaired: 0, quarantined: 0 };

  const bled: { fy: number; period: string; url: string | null; fp: string }[] = [];
  for (const r of stored) {
    const fp = fingerprint(r.data);
    if (!fp || r.fiscal_year === null) continue;
    const twin = stored.find(
      (o) =>
        o.fiscal_period === r.fiscal_period &&
        o.fiscal_year !== r.fiscal_year &&
        o.source_url !== r.source_url &&
        fingerprint(o.data) === fp
    );
    if (!twin) continue;
    // The filing that reported the period FIRST is reporting it as current;
    // the later one is repeating it as a comparative and has mislabelled it.
    if (dateMs(r.reported_date) <= dateMs(twin.reported_date)) continue;
    bled.push({ fy: r.fiscal_year, period: String(r.fiscal_period), url: r.source_url, fp });
  }

  for (const b of bled) {
    const quarantine = () =>
      db
        .from("company_financials")
        .update({ review_status: "needs_review" })
        .eq("ticker", ticker)
        .eq("statement_type", "income_statement")
        .eq("fiscal_year", b.fy)
        .eq("fiscal_period", b.period)
        .eq("source_url", b.url);

    // The same filing's other reading of this period, under a year no other
    // filing corroborates, is the column that was actually current.
    const { data: siblings } = await db
      .from("financial_statement_observations")
      .select("fiscal_year, fiscal_period, data")
      .eq("ticker", ticker)
      .eq("statement_type", "income_statement")
      .eq("fiscal_period", b.period)
      .eq("source_url", b.url);

    const replacement = (siblings ?? []).find((s) => {
      const fp = fingerprint(s.data as Record<string, unknown> | null);
      return fp !== null && fp !== b.fp;
    });

    await quarantine();

    if (replacement) {
      const d = (replacement.data ?? {}) as Record<string, unknown>;
      const figures: Record<string, number | null> = {};
      for (const k of FLOW_KEYS) {
        const v = num(d, k);
        if (v !== null) figures[k] = v;
      }
      await saveManualStatements(
        ticker,
        { url: b.url, date: null, sourceType: "psx-filing", extractor: "comparative-swap-repair" },
        [
          {
            fiscal_year: b.fy,
            fiscal_period: b.period,
            statement_type: "income_statement",
            basis: "unconsolidated",
            data: figures,
            confidence: 0.9,
          },
        ]
      );
      out.repaired++;
    } else {
      out.quarantined++;
    }
  }

  return out;
}

/**
 * Repair, then difference, one company's cumulative rows into discrete
 * quarters. Safe to run repeatedly: a slot that already holds a
 * directly-reported quarter is never overwritten, and re-derivation of an
 * unchanged period upserts the same figures.
 *
 * `years` bounds how far back to look, counted from the newest fiscal year the
 * company has actually filed rather than from today: a June year-end company
 * is in the next fiscal year every July but files nothing for it until October.
 */
export async function deriveQuarters(
  db: SupabaseClient,
  ticker: string,
  opts: { years?: number } = {}
): Promise<DerivationResult> {
  const t = ticker.toUpperCase();
  const years = opts.years ?? 5;
  const result: DerivationResult = {
    ticker: t,
    written: 0,
    needsReview: 0,
    bleedRepaired: 0,
    bleedQuarantined: 0,
    gaps: [],
    crossChecks: [],
  };

  let stored = await loadPublishedIncome(db, t);
  if (stored.length === 0) return result;

  const bleed = await repairComparativeBleed(db, t, stored);
  result.bleedRepaired = bleed.repaired;
  result.bleedQuarantined = bleed.quarantined;
  if (bleed.repaired || bleed.quarantined) stored = await loadPublishedIncome(db, t);

  // Cumulative rows keyed by year+period+basis. Basis is part of the key, not
  // collapsed away: a company can hold an unconsolidated reading from its own
  // filing and an unlabelled one from the portal for the same period, and which
  // of the two is subtracted decides whether the answer means anything.
  type CumRow = { data: Record<string, unknown>; basis: string };
  const cumulative = new Map<string, CumRow[]>();
  for (const r of [...stored].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))) {
    const p = r.fiscal_period;
    if (!p || !CUMULATIVE_PERIODS.includes(p)) continue;
    const basis = r.reporting_basis ?? "unlabelled";
    const list = cumulative.get(`${r.fiscal_year}-${p}`) ?? [];
    const row: CumRow = { data: (r.data ?? {}) as Record<string, unknown>, basis };
    const at = list.findIndex((x) => x.basis === basis);
    if (at >= 0) list[at] = row;
    else list.push(row);
    cumulative.set(`${r.fiscal_year}-${p}`, list);
  }

  /**
   * The two rows to subtract, preferring a matched pair. Subtracting a
   * consolidated cumulative from an unconsolidated one describes no entity at
   * all, so a definite mismatch is refused. "unlabelled" is not a competing
   * claim, only the portal declining to say, so it pairs with anything and the
   * caller is told that it happened.
   */
  const pickPair = (cum: CumRow[], prior: CumRow[]): { cum: CumRow; prior: CumRow; mixed: boolean } | null => {
    for (const c of cum) {
      const p = prior.find((x) => x.basis === c.basis);
      if (p) return { cum: c, prior: p, mixed: false };
    }
    for (const c of cum) {
      const p = prior.find((x) => x.basis === "unlabelled" || c.basis === "unlabelled");
      if (p) return { cum: c, prior: p, mixed: true };
    }
    return null;
  };

  /**
   * Rows whose EPS and profit come from different columns of one table.
   *
   * Profit divided by EPS is the share count, and it barely moves between
   * periods, so a row implying a wildly different count is mixing columns and
   * subtracting it produces a quarter that never happened. FCCL's H1 FY2026
   * carried profit of 7,316,529 against EPS of 1.64, the quarter's EPS rather
   * than the half year's. Such rows are excluded from the arithmetic and
   * reported, never corrected: a bonus issue moves the real count too, and this
   * cannot tell which explanation applies.
   */
  const impliedShares = (d: Record<string, unknown>): number | null => {
    const pat = num(d, "profit_after_tax");
    const eps = num(d, "eps");
    if (pat === null || eps === null || Math.abs(eps) < 0.01) return null;
    return pat / eps;
  };
  const counts = stored
    .map((r) => impliedShares((r.data ?? {}) as Record<string, unknown>))
    .filter((n): n is number => n !== null && n > 0)
    .sort((a, b) => a - b);
  const medianShares = counts.length ? counts[Math.floor(counts.length / 2)] : null;
  const columnMixed = (d: Record<string, unknown>): boolean => {
    if (medianShares === null) return false;
    const s = impliedShares(d);
    if (s === null || s <= 0) return false;
    return Math.abs(s / medianShares - 1) > SHARE_TOLERANCE;
  };

  // Keyed by basis too: a company filing both a consolidated and an
  // unconsolidated set would otherwise have a derived unconsolidated quarter
  // checked against whichever consolidated row was read last.
  const publishedQuarters = new Map<string, Record<string, unknown>>();
  for (const r of stored) {
    if (r.period_type === "quarterly" && /^Q[1-4]$/.test(String(r.fiscal_period))) {
      publishedQuarters.set(
        `${r.fiscal_year}-${r.fiscal_period}-${r.reporting_basis ?? "unlabelled"}`,
        (r.data ?? {}) as Record<string, unknown>
      );
    }
  }
  const reportedQuarter = (fy: number, q: string, basis: string | null): Record<string, unknown> | null =>
    publishedQuarters.get(`${fy}-${q}-${basis ?? "unlabelled"}`) ??
    publishedQuarters.get(`${fy}-${q}-unlabelled`) ??
    null;

  const filedYears = [...cumulative.keys()]
    .map((k) => Number(k.split("-")[0]))
    .filter((n) => Number.isFinite(n));
  if (filedYears.length === 0) return result;
  const currentFy = Math.max(...filedYears);
  const oldestFy = currentFy - years + 1;

  for (let fy = oldestFy; fy <= currentFy; fy++) {
    for (const recipe of RECIPES) {
      const cumRows = cumulative.get(`${fy}-${recipe.cumulative}`);
      const priorRows = cumulative.get(`${fy}-${recipe.prior}`);
      if (!cumRows?.length || !priorRows?.length) {
        if (cumRows?.length || priorRows?.length) {
          result.gaps.push(
            `FY${fy} ${recipe.quarter}: needs ${recipe.cumulative} and ${recipe.prior}, have only ${cumRows?.length ? recipe.cumulative : recipe.prior}`
          );
        }
        continue;
      }
      const pair = pickPair(cumRows, priorRows);
      if (!pair) {
        result.gaps.push(
          `FY${fy} ${recipe.quarter}: ${recipe.cumulative} is ${cumRows.map((r) => r.basis).join("/")}, ${recipe.prior} is ${priorRows.map((r) => r.basis).join("/")} — refusing to subtract across bases`
        );
        continue;
      }
      const { cum, prior, mixed } = pair;

      if (columnMixed(cum.data) || columnMixed(prior.data)) {
        const which = columnMixed(cum.data) ? recipe.cumulative : recipe.prior;
        const bad = columnMixed(cum.data) ? cum.data : prior.data;
        result.gaps.push(
          `FY${fy} ${recipe.quarter}: ${which} FY${fy} implies ${(impliedShares(bad)! / 1000).toFixed(0)}m shares against a median of ${(medianShares! / 1000).toFixed(0)}m — its EPS and profit come from different columns, not subtracting it`
        );
        continue;
      }

      const data: Record<string, number | null> = {};
      let any = false;
      for (const k of FLOW_KEYS) {
        const a = num(cum.data, k);
        const b = num(prior.data, k);
        if (a === null || b === null) continue;
        data[k] = k === "eps" ? Number((a - b).toFixed(2)) : Math.round(a - b);
        any = true;
      }
      if (!any || data.eps === undefined) {
        result.gaps.push(`FY${fy} ${recipe.quarter}: ${recipe.cumulative} or ${recipe.prior} carries no comparable EPS`);
        continue;
      }

      const existing = reportedQuarter(fy, recipe.quarter, mixed ? null : cum.basis);
      if (existing) {
        // PSX publishes some discrete quarters directly. Where it does, that is
        // an independent check on the arithmetic, not something to overwrite.
        const theirs = num(existing, "eps");
        const ours = data.eps;
        if (theirs !== null && ours !== null) {
          const offPct = Math.abs(theirs) > 0.01 ? Math.abs((ours - theirs) / theirs) * 100 : Math.abs(ours - theirs);
          // Material both proportionally and absolutely. EPS publishes to two
          // decimals, so 0.62 against a stored 0.64 is one rounding step apart
          // and scores 3%; chasing those buries the real ones.
          result.crossChecks.push({
            period: `FY${fy} ${recipe.quarter}`,
            reported: theirs,
            derived: ours,
            offPct,
            material: offPct > 2 && Math.abs(ours - theirs) >= 0.05,
          });
        }
        continue;
      }

      const res = await saveManualStatements(
        t,
        { url: null, date: null, sourceType: "derived-quarter", extractor: "cumulative-difference" },
        [
          {
            fiscal_year: fy,
            fiscal_period: recipe.quarter,
            statement_type: "income_statement",
            basis: mixed ? null : cum.basis,
            data: {
              ...data,
              _derived_from: `${recipe.cumulative} FY${fy} (${cum.basis}) minus ${recipe.prior} FY${fy} (${prior.basis})`,
            } as unknown as Record<string, number | null>,
            // Arithmetic on two published filings, not a reading. A pair whose
            // bases did not match is the same arithmetic on a weaker premise.
            confidence: mixed ? 0.8 : 0.95,
          },
        ]
      );
      result.written += res.saved;
      result.needsReview += res.needsReview;
    }
  }

  return result;
}
