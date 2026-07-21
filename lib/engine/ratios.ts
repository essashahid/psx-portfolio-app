import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ratio engine. Computes fundamental ratios ONLY from stored, sourced inputs
 * (extracted financials + live quote + recorded dividends). Each ratio row
 * carries its formula, the exact inputs used, and — when uncomputable — a
 * plain-English reason naming the missing input. Nothing is ever estimated.
 */

interface FinRow {
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  reported_date: string | null;
  source_type: string | null;
  source_url: string | null;
  reporting_basis: string | null;
  review_status: string | null;
  confidence: number | null;
  data: Record<string, number | null | string>;
}

// Hand-verified current shares outstanding for names where a bonus/split has
// made the filing EPS's share base stale, so price ÷ (filing EPS) mis-values
// them. Each entry is confirmed against Sarmaaya's snapshot (shares + P/E). The
// default everywhere else is the filing-derived count (PAT ÷ EPS), which is
// correct for companies with no recent corporate action. Keep this list small
// and sourced — it exists to correct real corporate actions, not to paper over
// bad extractions. When adding a name, verify shares AND that the resulting P/E
// matches Sarmaaya before committing.
const SHARE_COUNT_OVERRIDES: Record<string, number> = {
  // MTL: 100% bonus after the 9M FY2026 filing. Filing implies ~199.5M; current
  // ~399.03M (Sarmaaya). Restores P/E ~16.4 (Sarmaaya 16.41) from a false 8.2.
  MTL: 399_030_000,
  // LOADS: rights issue completed 27 Mar 2026 (+120M shares). Paid-up capital
  // in the 9M FY2026 filing = Rs 3,712,500,000 = 371.25M shares (Sarmaaya
  // agrees); the reported EPS still uses the ~272M weighted-average base.
  LOADS: 371_250_000,
};

// Companies whose market-quoted figure is the CONSOLIDATED (group) one, not
// the unconsolidated (standalone) figure PSX's own portal carries. The default
// everywhere else — and correct for the large majority, including holding
// companies like LUCK/FFC/HUBC where PSX's own quoted P/E matches our
// unconsolidated figure — is unconsolidated. Flip a company into this set only
// after an independent reference reconciles on consolidated AND fails to
// reconcile on unconsolidated; do not add on the assumption that "it's a
// group, so it must be consolidated" (LUCK is a holding company and is
// correctly unconsolidated).
//
// Effect: the annual/interim selection below excludes the PSX portal series
// (which is always unconsolidated) and unconsolidated/unlabelled filing rows,
// keeping only rows explicitly headed "consolidated" in the filing.
const CONSOLIDATED_BASIS_TICKERS = new Set<string>([
  // BAHL: filing prints both; Sarmaaya quotes the group. Consolidated TTM
  // (FY2025 29.19 + Q1 2026 6.54 - Q1 2025 9.65 = 26.08) is exact to
  // Sarmaaya's 26.08; unconsolidated (24.76) is not within tolerance.
  "BAHL",
  // MUGHAL: read directly from the primary documents (not agent-proposed).
  // Consolidated FY2025 EPS 2.50 (annual report p153); consolidated 9M 2026
  // EPS 5.10 and 9M 2025 comparative EPS 1.23 (interim filing, Directors'
  // Review p3). TTM = 2.50 + 5.10 - 1.23 = 6.37, exact to Sarmaaya's 6.37.
  // Unconsolidated TTM (7.24, using the filing's own printed unconsolidated
  // EPS figures — 5.43 FY2025, 5.76 and 1.35 for the 9M legs, all directly
  // confirmed on the interim's own P&L page 6) does not reconcile.
  "MUGHAL",
  // SEARL: FY2025 consolidated LOSS per share -2.73 (annual report p217,
  // driven by a Rs 2.18bn discontinued-operations loss on divesting
  // subsidiary Searle Pakistan Ltd). Published before a 15% bonus issued
  // during 9M FY2026, so restated to the post-bonus share base
  // (511,494,424 -> 588,218,587, both from the filings' own share-capital
  // notes) to -2.37 before combining with the interim's OWN comparative,
  // which is already restated per IAS 33: 9M 2026 consolidated EPS 3.89,
  // 9M 2025 consolidated EPS -0.55 (interim p24, p28). TTM = -2.37 + 3.89
  // - (-0.55) = 2.07, within 1.5% of Sarmaaya's 2.04. Unconsolidated TTM
  // (4.32) is not a basis difference alone -- it also carries the same
  // un-restated FY2025 annual EPS problem, compounding the gap.
  "SEARL",
  // GAL: filing prints both (99.9%-owned subsidiary Ghandhara DF); Sarmaaya
  // quotes the group. FY2025 consolidated EPS 71.85 (annual report p133),
  // 9M 2026 EPS 85.28 and 9M 2025 comparative EPS 39.89 (interim p5). TTM =
  // 71.85 + 85.28 - 39.89 = 117.24, exact to Sarmaaya's 117.24.
  "GAL",
]);

function preferredBasis(ticker: string): "consolidated" | "unconsolidated" {
  return CONSOLIDATED_BASIS_TICKERS.has(ticker.toUpperCase()) ? "consolidated" : "unconsolidated";
}

/** True when a row should be EXCLUDED from the ticker's default-basis series. */
function excludedByBasis(ticker: string, row: Pick<FinRow, "reporting_basis" | "data">): boolean {
  const basis = row.reporting_basis ?? (row.data?._basis as string | undefined) ?? null;
  return preferredBasis(ticker) === "consolidated" ? basis !== "consolidated" : basis === "consolidated";
}

// A truly-annual row: trust the specific fiscal_period so a row mis-tagged
// period_type "annual" but carrying an interim period (9M/H1/Qx) is excluded
// from the annual series used for valuation and year-over-year growth.
function isAnnual(row: FinRow): boolean {
  const p = (row.fiscal_period ?? "").toUpperCase();
  if (p === "FY") return true;
  if (/^(Q[1-4]|H1|9M)$/.test(p)) return false;
  return row.period_type === "annual";
}

export interface RatioRow {
  ticker: string;
  ratio_name: string;
  ratio_value: number | null;
  formula: string;
  inputs: Record<string, number | string | null>;
  missing: string | null;
  source_period: string | null;
  source: string | null;
  computed_at: string;
}

const numOf = (d: Record<string, number | null | string> | undefined, key: string): number | null => {
  const v = d?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const safeDiv = (num: number | null, den: number | null): number | null =>
  num !== null && den !== null && den !== 0 ? num / den : null;

const pct = (num: number | null, den: number | null): number | null => {
  const v = safeDiv(num, den);
  return v !== null ? v * 100 : null;
};

function periodLabel(r: FinRow | undefined): string | null {
  if (!r) return null;
  return `${r.fiscal_year ?? "?"} ${r.fiscal_period ?? r.period_type}`;
}

/** Latest statement of a type, preferring the most recent reported_date then fiscal year. */
function latest(rows: FinRow[], type: string): FinRow | undefined {
  return rows
    .filter((r) => r.statement_type === type)
    .sort((a, b) => (b.reported_date ?? "").localeCompare(a.reported_date ?? "") || (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0))[0];
}

/** Previous statement of the same type+period_type for growth comparisons. */
function previous(rows: FinRow[], ref: FinRow | undefined): FinRow | undefined {
  if (!ref) return undefined;
  return rows
    .filter(
      (r) =>
        r.statement_type === ref.statement_type &&
        r.period_type === ref.period_type &&
        `${r.fiscal_year}-${r.fiscal_period}` !== `${ref.fiscal_year}-${ref.fiscal_period}`
    )
    .sort((a, b) => (b.reported_date ?? "").localeCompare(a.reported_date ?? ""))[0];
}

export async function computeRatios(supabase: SupabaseClient, ticker: string): Promise<RatioRow[]> {
  const t = ticker.toUpperCase();
  const now = new Date().toISOString();

  const [{ data: finRows }, { data: quote }, { data: divRows }] = await Promise.all([
    supabase
      .from("company_financials")
      .select("period_type, fiscal_year, fiscal_period, statement_type, reported_date, source_type, source_url, reporting_basis, review_status, confidence, data")
      .eq("ticker", t)
      .eq("review_status", "published")
      .order("reported_date", { ascending: false, nullsFirst: false })
      .limit(60),
    supabase.from("market_quotes").select("price, as_of, market_cap").eq("ticker", t).maybeSingle(),
    // Market-wide payouts (ticker-scoped, populated from the official PSX feed)
    // so dividend ratios compute for every company, not just imported holdings.
    supabase
      .from("company_payouts")
      .select("dividend_per_share, announcement_date, book_closure_start")
      .eq("ticker", t)
      .eq("kind", "cash")
      .order("announcement_date", { ascending: false })
      .limit(20),
  ]);

  const rows = (finRows ?? []) as FinRow[];

  // Two sources with different shapes, kept strictly separate so neither
  // corrupts the other:
  //  • PSX summary page (source_type "psx-portal") — a clean, consistent annual
  //    series (sales/EPS/margins) for valuation and year-over-year growth.
  //  • Filing extraction (source_type "psx-filing") — full statements (operating
  //    profit, finance cost, balance sheet, cash flow) for the deep ratios.
  // The PSX portal series is always unconsolidated (it has no notion of
  // group vs standalone), so for a consolidated-preference ticker it can
  // never stand in for the annual series — using it would silently revert
  // the company to unconsolidated regardless of CONSOLIDATED_BASIS_TICKERS.
  const pageAnnual =
    preferredBasis(t) === "consolidated"
      ? []
      : rows
          .filter((r) => r.statement_type === "income_statement" && isAnnual(r) && r.source_type === "psx-portal")
          .sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0));

  // Valuation / margins / growth: prefer the clean page annual series, but only
  // when it is not OLDER than the newest annual on file. A stale portal series
  // (e.g. SCBPL's portal stuck at FY2024 while the filed FY2025 annual exists)
  // must not override the newer filing annual — that broke TTM composition.
  const annualRows = rows.filter((r) => isAnnual(r) && !excludedByBasis(t, r));
  const latestAnnual = latest(annualRows, "income_statement") ?? latest(rows.filter((r) => !excludedByBasis(t, r)), "income_statement");
  const income =
    pageAnnual[0] && (pageAnnual[0].fiscal_year ?? 0) >= (latestAnnual?.fiscal_year ?? 0)
      ? pageAnnual[0]
      : latestAnnual;
  const prevIncome = pageAnnual.length > 1 && income === pageAnnual[0] ? pageAnnual[1] : previous(income && isAnnual(income) ? annualRows : rows, income);
  // Same basis discipline as the income statement: a consolidated-preference
  // ticker's book value must come from the CONSOLIDATED balance sheet, not
  // whichever row happens to sort first. GAL's tie-broke silently to the
  // unconsolidated row (P/B 2.55 vs Sarmaaya 1.7); the actual consolidated
  // equity (19,165,213 vs 12,792,068 standalone) gives P/B 1.70, exact.
  // No fallback to the unfiltered set when nothing matches — same as the
  // income side (PTC/NATF sit unresolved rather than served from the wrong
  // basis) — missing is preferable to silently wrong.
  const balance = latest(rows.filter((r) => !excludedByBasis(t, r)), "balance_sheet");
  const cash = latest(rows.filter((r) => !excludedByBasis(t, r)), "cash_flow");

  const price = quote?.price != null && Number(quote.price) > 0 ? Number(quote.price) : null;

  // Trailing-12-month cash dividend per share from recorded dividends.
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const ttmDps =
    (divRows ?? [])
      .filter((d) => d.dividend_per_share && (d.announcement_date ?? d.book_closure_start ?? "") >= cutoff)
      .reduce((s, d) => s + Number(d.dividend_per_share), 0) || null;

  const eps = numOf(income?.data, "eps");
  const revenue = numOf(income?.data, "revenue");

  // --- Trailing-12-month EPS -------------------------------------------------
  // Valuation must not sit on the last full fiscal year once newer interim
  // quarters exist (the PPL incident: FY2025 EPS priced against a July 2026
  // quote produced P/E 7.3 while the market was valuing the stock on fresher,
  // lower earnings). TTM EPS = annual EPS + current-year interim EPS − the
  // prior year's same-period interim EPS. Interim cumulatives are taken from an
  // exact cumulative row (Q1/H1/9M), a sum of quarterly rows, or H1 + Q3.
  // Consolidated-basis rows are excluded: the annual series (PSX portal) is
  // unconsolidated, and one consolidated interim in the sum silently shifts the
  // TTM by the group/standalone gap (PPL's consolidated 9M EPS was 26.72 vs
  // 22.85 standalone).
  const interimIncome = rows.filter((r) => r.statement_type === "income_statement" && !isAnnual(r) && !excludedByBasis(t, r));
  const qField = (year: number, q: number, field: string): number | null => {
    const r = interimIncome.find((x) => x.fiscal_year === year && (x.fiscal_period ?? "").toUpperCase() === `Q${q}`);
    return numOf(r?.data, field);
  };
  const cumLabel = (n: number): string => (n === 1 ? "Q1" : n === 2 ? "H1" : "9M");
  const cumulativeField = (year: number, n: number, field: string): number | null => {
    const direct = interimIncome.find((x) => x.fiscal_year === year && (x.fiscal_period ?? "").toUpperCase() === cumLabel(n));
    const directVal = numOf(direct?.data, field);
    if (directVal !== null) return directVal;
    const quarters = Array.from({ length: n }, (_, i) => qField(year, i + 1, field));
    if (quarters.every((v) => v !== null)) return (quarters as number[]).reduce((a, b) => a + b, 0);
    if (n === 3) {
      const h1 = cumulativeField(year, 2, field);
      const q3 = qField(year, 3, field);
      if (h1 !== null && q3 !== null) return h1 + q3;
    }
    return null;
  };
  const annualYear = income && isAnnual(income) ? income.fiscal_year : null;
  let ttmEps: number | null = null;
  let ttmPeriod: string | null = null;
  let interimEpsNow: number | null = null;
  let interimEpsPrior: number | null = null;
  let interimPeriod: string | null = null;
  let interimGrowthPeriod: string | null = null;
  let interimMonths: number | null = null;
  if (annualYear !== null && annualYear !== undefined) {
    const y = annualYear + 1;
    for (const n of [3, 2, 1]) {
      const current = cumulativeField(y, n, "eps");
      if (current === null) continue;
      interimEpsNow = current;
      interimMonths = n * 3;
      interimEpsPrior = cumulativeField(annualYear, n, "eps");
      interimPeriod = `${y} ${cumLabel(n)}`;
      interimGrowthPeriod = `${y} ${cumLabel(n)} vs ${annualYear} ${cumLabel(n)}`;
      if (interimEpsPrior !== null && eps !== null) {
        ttmEps = eps + current - interimEpsPrior;
        ttmPeriod = `TTM to ${y} ${cumLabel(n)}`;
      }
      break;
    }
  }
  // EPS basis for price-linked ratios: TTM when derivable, else latest annual.
  const valEps = ttmEps ?? eps;
  const valEpsPeriod = ttmEps !== null ? ttmPeriod : null;
  const costOfSales = numOf(income?.data, "cost_of_sales");
  const grossProfit = numOf(income?.data, "gross_profit");
  const pat = numOf(income?.data, "profit_after_tax");

  // Operating profit / finance cost / PBT come only from the full extracted
  // statement (the PSX summary page lacks them), which may be an interim period.
  // Use the latest income row that actually carries them, and pair each margin
  // with that row's OWN revenue so the period and units stay consistent.
  const detailedIncome = rows
    .filter((r) => r.statement_type === "income_statement" && (numOf(r.data, "operating_profit") !== null || numOf(r.data, "profit_before_tax") !== null || numOf(r.data, "finance_cost") !== null))
    .sort((a, b) => (b.reported_date ?? "").localeCompare(a.reported_date ?? "") || (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0))[0];
  const detailRevenue = numOf(detailedIncome?.data, "revenue");
  const detailCostOfSales = numOf(detailedIncome?.data, "cost_of_sales");
  const operatingExpenses = numOf(detailedIncome?.data, "operating_expenses");
  const operatingProfit = numOf(detailedIncome?.data, "operating_profit");
  const pbt = numOf(detailedIncome?.data, "profit_before_tax");
  const taxRaw = numOf(detailedIncome?.data, "tax");
  const tax = taxRaw != null ? Math.abs(taxRaw) : null;
  // Finance cost is an expense; filings print it in parentheses (negative). Use
  // its magnitude so interest coverage = EBIT ÷ interest is well-formed.
  const fcRaw = numOf(detailedIncome?.data, "finance_cost");
  const financeCost = fcRaw != null ? Math.abs(fcRaw) : null;
  const detailPeriod = periodLabel(detailedIncome);
  // Bank-specific income items: pick the latest non-consolidated income row that
  // carries net markup income (banks only). Months drive annualization of NIM.
  const bankIncome = rows
    .filter((r) => r.statement_type === "income_statement" && numOf(r.data, "net_markup_income") !== null && !excludedByBasis(t, r))
    .sort((a, b) => (b.reported_date ?? "").localeCompare(a.reported_date ?? "") || (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0))[0];
  const netMarkupIncome = numOf(bankIncome?.data, "net_markup_income");
  const nonMarkupIncome = numOf(bankIncome?.data, "non_markup_income");
  const bankOpexRaw = numOf(bankIncome?.data, "operating_expenses");
  const bankOpex = bankOpexRaw != null ? Math.abs(bankOpexRaw) : null;
  const bankMonths = ((): number => {
    const p = (bankIncome?.fiscal_period ?? "").toUpperCase();
    if (p === "9M") return 9;
    if (p === "H1") return 6;
    if (/^Q[1-4]$/.test(p)) return 3;
    return 12;
  })();
  const bankPeriod = periodLabel(bankIncome);
  const equity = numOf(balance?.data, "equity");
  const totalAssets = numOf(balance?.data, "total_assets");
  const currentAssets = numOf(balance?.data, "current_assets");
  const currentLiabilities = numOf(balance?.data, "current_liabilities");
  const inventory = numOf(balance?.data, "inventory");
  const borrowings = numOf(balance?.data, "borrowings");
  const cashEq = numOf(balance?.data, "cash_and_equivalents");
  const receivables = numOf(balance?.data, "receivables");
  const totalLiabilities = numOf(balance?.data, "total_liabilities");
  const retainedEarnings = numOf(balance?.data, "retained_earnings");
  // Bank-specific balance-sheet items (null for non-banks, so bank ratios below
  // simply don't compute for industrial companies). Like bankIncome, use the
  // latest balance sheet that actually CARRIES the bank fields — the newest BS
  // may predate the bank-aware extraction schema and lack deposits/advances.
  const bankBalance = rows
    .filter((r) => r.statement_type === "balance_sheet" && numOf(r.data, "deposits") !== null && !excludedByBasis(t, r))
    .sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0) || (b.reported_date ?? "").localeCompare(a.reported_date ?? ""))[0];
  const deposits = numOf(bankBalance?.data, "deposits");
  const advances = numOf(bankBalance?.data, "advances");
  const grossAdvances = numOf(bankBalance?.data, "gross_advances");
  const nonPerformingLoans = numOf(bankBalance?.data, "non_performing_loans");
  const bankBalancePeriod = periodLabel(bankBalance);
  const ocf = numOf(cash?.data, "operating_cash_flow");
  const capex = numOf(cash?.data, "capex");
  const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;

  // Cash-flow ratios must not mix periods: dividing a Q1 OCF by full-year PAT
  // understates conversion ~4x (the Copilot read FFC's 0.20 as weak earnings
  // quality when same-period conversion was ~0.84). Pair the cash row with the
  // income statement of ITS OWN period when one exists; for ratios against
  // market cap (a point-in-time figure), annualize an interim cash flow.
  const cashMonths = ((): number => {
    const p = (cash?.fiscal_period ?? "").toUpperCase();
    if (p === "9M") return 9;
    if (p === "H1") return 6;
    if (/^Q[1-4]$/.test(p)) return 3;
    return 12;
  })();
  const cashPeriodIncome = cash
    ? rows.find(
        (r) =>
          r.statement_type === "income_statement" &&
          r.fiscal_year === cash.fiscal_year &&
          (r.fiscal_period ?? "").toUpperCase() === (cash.fiscal_period ?? "").toUpperCase() &&
          !excludedByBasis(t, r)
      )
    : undefined;
  const cashPat = numOf(cashPeriodIncome?.data, "profit_after_tax");
  const cashRevenue = numOf(cashPeriodIncome?.data, "revenue");
  const cashOperatingProfit = numOf(cashPeriodIncome?.data, "operating_profit");
  const annualizedFcfRupees = fcf !== null ? fcf * 1000 * (12 / cashMonths) : null;
  const fcfYieldPeriod = cashMonths < 12 ? `annualized from ${periodLabel(cash)}` : periodLabel(cash);

  // Financial statements are stored in PKR thousands. EPS and price are per
  // share in PKR, so PAT/EPS derives an approximate share count without mixing
  // units. Require PAT and EPS to have the same sign to avoid nonsense shares.
  const sharesOutstanding =
    pat !== null && eps !== null && eps !== 0 && pat / eps > 0 ? Math.abs((pat * 1000) / eps) : null;

  // --- Share-count reconciliation (bonus / split robustness) -----------------
  // EPS is printed per the share count on the filing date. A bonus or split
  // AFTER the filing changes the true share count but not the filing's EPS, so
  // price ÷ EPS silently breaks (MTL 2026: a 100% bonus made our P/E read 8.2
  // against a true 16.4; PSX carried the same stale number, only Sarmaaya's
  // current-share figure was right). We CANNOT derive the fix from market_cap ÷
  // price: our price feed is frequently stale (ANL's stored price was two days
  // old, so market_cap ÷ price implied 579M shares when both the filing and
  // Sarmaaya agree on ~485M), and our recorded payouts miss most bonus events.
  // So the reliable current share count is the filing-derived one by default,
  // overridden only for names where a corporate action is hand-verified against
  // Sarmaaya. The reconciliation flag below surfaces divergences for review.
  const quoteMarketCap =
    quote?.market_cap != null && Number(quote.market_cap) > 0 ? Number(quote.market_cap) : null;
  const quoteShares =
    quoteMarketCap !== null && price !== null && price > 0 ? quoteMarketCap / price : null;
  const shareRatio =
    quoteShares !== null && sharesOutstanding !== null && sharesOutstanding > 0
      ? quoteShares / sharesOutstanding
      : null;
  const shareAnomaly = shareRatio !== null && Math.abs(shareRatio - 1) > 0.12;
  const overrideShares = SHARE_COUNT_OVERRIDES[t] ?? null;
  const effectiveShares = overrideShares ?? sharesOutstanding;
  const epsAdjust =
    overrideShares !== null && sharesOutstanding !== null && overrideShares > 0
      ? sharesOutstanding / overrideShares
      : 1;
  const valEpsAdj = valEps !== null ? valEps * epsAdjust : null;
  const ttmEpsAdj = ttmEps !== null ? ttmEps * epsAdjust : null;
  // Forward / run-rate EPS: the current interim cumulative annualized to a full
  // year. For a stable company this ≈ TTM; for a recovering cyclical (cement)
  // it runs well above trailing-12m and matches how some vendors quote P/E. We
  // keep trailing-12m as the primary P/E (it is what actually happened) and
  // surface this run-rate figure alongside so both views are visible.
  const annualizedEps =
    interimEpsNow !== null && interimMonths ? interimEpsNow * (12 / interimMonths) * epsAdjust : null;
  const annualizedEpsPeriod = interimPeriod ? `annualized from ${interimPeriod}` : null;
  // A bonus/split restates per-share dividend history too. Recorded DPS is on
  // the pre-action share base, so convert it to the current base with the same
  // factor (MTL's yield read 11.5% on the old count vs a true 5.8%). epsAdjust
  // is 1 for every name without an override, so this is a no-op elsewhere.
  const ttmDpsAdj = ttmDps !== null ? ttmDps * epsAdjust : null;
  const equityRupees = equity !== null ? equity * 1000 : null;
  const cashRupees = cashEq !== null ? cashEq * 1000 : null;
  const receivablesRupees = receivables !== null ? receivables * 1000 : null;
  const borrowingsRupees = borrowings !== null ? borrowings * 1000 : null;
  const fcfRupees = fcf !== null ? fcf * 1000 : null;
  const operatingProfitRupees = operatingProfit !== null ? operatingProfit * 1000 : null;
  const marketCap = price !== null && effectiveShares !== null ? price * effectiveShares : null;
  const enterpriseValue =
    marketCap !== null ? marketCap + (borrowingsRupees ?? 0) - (cashRupees ?? 0) : null;
  const netDebt = borrowings !== null && cashEq !== null ? borrowings - cashEq : null;
  const investedCapital = equity !== null && borrowings !== null && cashEq !== null ? equity + borrowings - cashEq : null;
  const taxRate = pbt !== null && pbt > 0 && tax !== null ? Math.min(1, Math.max(0, tax / pbt)) : null;
  const nopat = operatingProfit !== null && taxRate !== null ? operatingProfit * (1 - taxRate) : null;

  const incomePeriod = periodLabel(income);
  const balancePeriod = periodLabel(balance);
  // Market cap is price × shares from the LIVE quote, not a filing period, so
  // label it by the quote date rather than an income period.
  const priceAsOfPeriod = quote?.as_of ? `as of ${quote.as_of}` : null;
  const source = income?.source_url ?? balance?.source_url ?? null;

  // --- TTM flow figures (revenue, PAT) for margin/return/turnover ratios -----
  // Margin, return, and turnover ratios historically divided by the last FULL
  // fiscal year's income while P/E already used TTM — so ROE / net margin /
  // asset turnover lagged a whole year once interim results landed. Build TTM
  // revenue and PAT the same way as TTM EPS (annual + current interim −
  // prior-year same interim). These are absolute rupee figures, so a bonus /
  // split (share-count override) does not affect them. PAT falls back to
  // ttmEps × shares when interim rows are portal-EPS-only (no PAT line), and
  // the whole thing falls back to the latest annual value when no TTM is
  // derivable — so nothing regresses for names lacking interim detail.
  const ttmFlow = (field: string): { value: number; period: string } | null => {
    if (annualYear === null || annualYear === undefined) return null;
    const annual = numOf(income?.data, field);
    if (annual === null) return null;
    const y = annualYear + 1;
    for (const n of [3, 2, 1]) {
      const cur = cumulativeField(y, n, field);
      if (cur === null) continue;
      const prior = cumulativeField(annualYear, n, field);
      if (prior === null) return null;
      return { value: annual + cur - prior, period: `TTM to ${y} ${cumLabel(n)}` };
    }
    return null;
  };
  const ttmRevInfo = ttmFlow("revenue");
  const ttmPatInfo = ttmFlow("profit_after_tax");
  const ttmPatFromEps =
    ttmEps !== null && sharesOutstanding !== null ? (ttmEps * sharesOutstanding) / 1000 : null;
  const ttmRevenue = ttmRevInfo?.value ?? null;
  const ttmPat = ttmPatInfo?.value ?? ttmPatFromEps;
  const ttmPatPeriod = ttmPatInfo?.period ?? (ttmPatFromEps !== null ? ttmPeriod : null);
  // Preferred (freshest) flow figures used below: TTM when available, else the
  // latest annual value. Net margin must pair PAT and revenue from the SAME
  // period, so it only goes TTM when both are TTM-derivable.
  const flowRevenue = ttmRevenue ?? revenue;
  const flowRevenueRupees = flowRevenue !== null ? flowRevenue * 1000 : null;
  const flowRevenuePeriod = ttmRevenue !== null ? ttmRevInfo?.period ?? incomePeriod : incomePeriod;
  const flowPat = ttmPat ?? pat;
  const flowPatPeriod = ttmPat !== null ? ttmPatPeriod ?? incomePeriod : incomePeriod;
  const marginTtm = ttmPat !== null && ttmRevenue !== null;
  const marginPat = marginTtm ? ttmPat : pat;
  const marginRevenue = marginTtm ? ttmRevenue : revenue;
  const marginPeriod = marginTtm ? ttmRevInfo?.period ?? incomePeriod : incomePeriod;

  const out: RatioRow[] = [];
  const add = (
    name: string,
    formula: string,
    inputs: Record<string, number | string | null>,
    value: number | null,
    missing: string | null,
    period: string | null
  ) =>
    out.push({ ticker: t, ratio_name: name, ratio_value: value !== null && Number.isFinite(value) ? value : null, formula, inputs, missing, source_period: period, source, computed_at: now });

  const need = (parts: [string, number | null][]): string | null => {
    const gone = parts.filter(([, v]) => v === null).map(([k]) => k);
    return gone.length ? `Cannot calculate — missing: ${gone.join(", ")}.` : null;
  };

  const cagrBase = pageAnnual.find(
    (r) => income?.fiscal_year && r.fiscal_year && income.fiscal_year - r.fiscal_year >= 3
  ) ?? pageAnnual[3] ?? pageAnnual[2];
  const cagrYears = income?.fiscal_year && cagrBase?.fiscal_year ? income.fiscal_year - cagrBase.fiscal_year : null;
  const cagr = (current: number | null, base: number | null): number | null =>
    current !== null && base !== null && current > 0 && base > 0 && cagrYears && cagrYears > 0
      ? (Math.pow(current / base, 1 / cagrYears) - 1) * 100
      : null;
  const cagrPeriod = income && cagrBase ? `${periodLabel(income)} vs ${periodLabel(cagrBase)}` : incomePeriod;

  // Valuation — price-linked earnings ratios use the freshest EPS basis (TTM
  // when interim rows allow it), and say so in their period label.
  const valPeriod = valEpsPeriod ?? incomePeriod;
  const shareNote = overrideShares !== null ? " (share count overridden to current, corporate-action adjusted)" : "";
  add("P/E", "Price ÷ EPS", { price, eps: valEpsAdj, eps_basis: valPeriod, share_adjust: epsAdjust }, price !== null && valEpsAdj ? price / valEpsAdj : null, need([["price", price], ["EPS", valEpsAdj]]) ?? (valEpsAdj === 0 ? "EPS is zero." : null), valPeriod);
  add("Earnings yield", "EPS ÷ Price", { price, eps: valEpsAdj, eps_basis: valPeriod, share_adjust: epsAdjust }, price && valEpsAdj !== null ? (valEpsAdj / price) * 100 : null, need([["price", price], ["EPS", valEpsAdj]]), valPeriod);
  add("EPS (TTM)", `Annual EPS + current interim EPS − prior-year same-period interim EPS${shareNote}`, { annual_eps: eps, interim_eps: interimEpsNow, prior_year_interim_eps: interimEpsPrior, share_adjust: epsAdjust }, ttmEpsAdj, ttmEpsAdj === null ? "Cannot calculate — missing: current or prior-year interim EPS." : null, ttmPeriod ?? incomePeriod);
  add("EPS (annualized)", "Current interim EPS annualized to a full year (run-rate)", { interim_eps: interimEpsNow, months: interimMonths, share_adjust: epsAdjust }, annualizedEps, need([["current interim EPS", interimEpsNow]]), annualizedEpsPeriod ?? incomePeriod);
  add("P/E (forward)", "Price ÷ annualized run-rate EPS", { price, eps: annualizedEps }, price !== null && annualizedEps ? price / annualizedEps : null, need([["price", price], ["annualized EPS", annualizedEps]]) ?? (annualizedEps === 0 ? "EPS is zero." : null), annualizedEpsPeriod ?? incomePeriod);
  add("Interim EPS growth", "(Interim EPS − Prior-year same-period EPS) ÷ |Prior-year same-period EPS|", { interim_eps: interimEpsNow, prior_year_interim_eps: interimEpsPrior }, interimEpsNow !== null && interimEpsPrior ? ((interimEpsNow - interimEpsPrior) / Math.abs(interimEpsPrior)) * 100 : null, need([["current interim EPS", interimEpsNow], ["prior-year interim EPS", interimEpsPrior]]), interimGrowthPeriod ?? interimPeriod);
  add("Shares outstanding (derived)", "(Profit after tax × 1,000) ÷ EPS", { profit_after_tax_pkr_thousands: pat, eps }, sharesOutstanding, need([["profit after tax", pat], ["EPS", eps]]) ?? (eps === 0 ? "EPS is zero." : null), incomePeriod);
  add("Share count reconciliation", "Market shares (market cap ÷ price) ÷ filing-derived shares — a >12% gap flags a possible post-filing bonus/split or a stale price/market-cap feed; verify against Sarmaaya before overriding", { market_shares: quoteShares, filing_shares: sharesOutstanding, override_shares: overrideShares, anomaly: shareAnomaly ? 1 : 0 }, shareRatio, need([["market cap", quoteMarketCap], ["filing-derived shares", sharesOutstanding]]), incomePeriod);
  add("Market cap (derived)", "Price × effective shares outstanding", { price, shares_outstanding: effectiveShares }, marketCap, need([["price", price], ["effective shares outstanding", effectiveShares]]), priceAsOfPeriod);
  add("Book value / share", "(Equity × 1,000) ÷ effective shares outstanding", { equity_pkr_thousands: equity, shares_outstanding: effectiveShares }, safeDiv(equityRupees, effectiveShares), need([["equity", equity], ["effective shares outstanding", effectiveShares]]), balancePeriod);
  add("Sales / share", "(Revenue × 1,000) ÷ effective shares outstanding", { revenue_pkr_thousands: flowRevenue, shares_outstanding: effectiveShares }, safeDiv(flowRevenueRupees, effectiveShares), need([["revenue", flowRevenue], ["effective shares outstanding", effectiveShares]]), flowRevenuePeriod);
  add("Cash / share", "(Cash and equivalents × 1,000) ÷ effective shares outstanding", { cash_and_equivalents_pkr_thousands: cashEq, shares_outstanding: effectiveShares }, safeDiv(cashRupees, effectiveShares), need([["cash and equivalents", cashEq], ["effective shares outstanding", effectiveShares]]), balancePeriod);
  add("P/B", "Price ÷ Book value per share", { price, equity_pkr_thousands: equity, shares_outstanding: effectiveShares }, price !== null ? safeDiv(price, safeDiv(equityRupees, effectiveShares)) : null, need([["price", price], ["equity", equity], ["effective shares outstanding", effectiveShares]]), balancePeriod);
  add("P/S", "Market capitalization ÷ Revenue", { market_cap: marketCap, revenue_pkr: flowRevenueRupees }, safeDiv(marketCap, flowRevenueRupees), need([["market capitalization", marketCap], ["revenue", flowRevenue]]), flowRevenuePeriod);
  add("Price / FCF", "Market capitalization ÷ Annualized free cash flow", { market_cap: marketCap, free_cash_flow_pkr_annualized: annualizedFcfRupees }, safeDiv(marketCap, annualizedFcfRupees), need([["market capitalization", marketCap], ["free cash flow", fcf]]), fcfYieldPeriod);
  add("FCF yield", "Annualized free cash flow ÷ Market capitalization", { free_cash_flow_pkr_annualized: annualizedFcfRupees, market_cap: marketCap }, pct(annualizedFcfRupees, marketCap), need([["free cash flow", fcf], ["market capitalization", marketCap]]), fcfYieldPeriod);
  add("EV/Sales", "Enterprise value ÷ Revenue", { enterprise_value: enterpriseValue, revenue_pkr: flowRevenueRupees }, safeDiv(enterpriseValue, flowRevenueRupees), need([["enterprise value", enterpriseValue], ["revenue", flowRevenue]]), `${flowRevenuePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("EV/EBIT", "Enterprise value ÷ Operating profit", { enterprise_value: enterpriseValue, operating_profit_pkr: operatingProfitRupees }, safeDiv(enterpriseValue, operatingProfitRupees), need([["enterprise value", enterpriseValue], ["operating profit", operatingProfit]]), `${detailPeriod ?? incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Dividend yield (TTM)", "Trailing 12m cash DPS ÷ Price", { price, ttm_dps: ttmDpsAdj, share_adjust: epsAdjust }, price && ttmDpsAdj ? (ttmDpsAdj / price) * 100 : null, need([["price", price], ["trailing dividends", ttmDpsAdj]]), "Last 12 months");
  add("Payout ratio", "TTM DPS ÷ EPS", { ttm_dps: ttmDpsAdj, eps: valEpsAdj, eps_basis: valPeriod, share_adjust: epsAdjust }, ttmDpsAdj && valEpsAdj ? (ttmDpsAdj / valEpsAdj) * 100 : null, need([["trailing dividends", ttmDpsAdj], ["EPS", valEpsAdj]]), valPeriod);
  add("Dividend cover", "EPS ÷ TTM DPS", { eps: valEpsAdj, eps_basis: valPeriod, ttm_dps: ttmDpsAdj, share_adjust: epsAdjust }, valEpsAdj && ttmDpsAdj ? valEpsAdj / ttmDpsAdj : null, need([["EPS", valEpsAdj], ["trailing dividends", ttmDpsAdj]]), valPeriod);

  // Profitability (statement-internal — units cancel)
  add("Gross margin", "Gross profit ÷ Revenue", { gross_profit: grossProfit, revenue }, grossProfit !== null && revenue ? (grossProfit / revenue) * 100 : null, need([["gross profit", grossProfit], ["revenue", revenue]]), incomePeriod);
  add("Operating margin", "Operating profit ÷ Revenue", { operating_profit: operatingProfit, revenue: detailRevenue }, operatingProfit !== null && detailRevenue ? (operatingProfit / detailRevenue) * 100 : null, need([["operating profit", operatingProfit], ["revenue", detailRevenue]]), detailPeriod ?? incomePeriod);
  add("Net margin", "Profit after tax ÷ Revenue", { profit_after_tax: marginPat, revenue: marginRevenue }, marginPat !== null && marginRevenue ? (marginPat / marginRevenue) * 100 : null, need([["profit after tax", marginPat], ["revenue", marginRevenue]]), marginPeriod);
  add("Cost of sales ratio", "Cost of sales ÷ Revenue", { cost_of_sales: costOfSales ?? detailCostOfSales, revenue: costOfSales !== null ? revenue : detailRevenue }, pct(costOfSales ?? detailCostOfSales, costOfSales !== null ? revenue : detailRevenue), need([["cost of sales", costOfSales ?? detailCostOfSales], ["revenue", costOfSales !== null ? revenue : detailRevenue]]), costOfSales !== null ? incomePeriod : detailPeriod ?? incomePeriod);
  add("Operating expense ratio", "Operating expenses ÷ Revenue", { operating_expenses: operatingExpenses, revenue: detailRevenue }, pct(operatingExpenses, detailRevenue), need([["operating expenses", operatingExpenses], ["revenue", detailRevenue]]), detailPeriod ?? incomePeriod);
  add("Effective tax rate", "Tax expense ÷ Profit before tax", { tax_expense: tax, profit_before_tax: pbt }, pct(tax, pbt), need([["tax", tax], ["profit before tax", pbt]]), detailPeriod ?? incomePeriod);
  add("ROE", "Profit after tax ÷ Equity", { profit_after_tax: flowPat, equity }, flowPat !== null && equity ? (flowPat / equity) * 100 : null, need([["profit after tax", flowPat], ["equity", equity]]), `${flowPatPeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("ROA", "Profit after tax ÷ Total assets", { profit_after_tax: flowPat, total_assets: totalAssets }, flowPat !== null && totalAssets ? (flowPat / totalAssets) * 100 : null, need([["profit after tax", flowPat], ["total assets", totalAssets]]), `${flowPatPeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("ROIC", "NOPAT ÷ (Equity + Borrowings − Cash)", { nopat, equity, borrowings, cash_and_equivalents: cashEq, tax_rate: taxRate }, pct(nopat, investedCapital), need([["operating profit", operatingProfit], ["tax", tax], ["profit before tax", pbt], ["equity", equity], ["borrowings", borrowings], ["cash and equivalents", cashEq]]), `${detailPeriod ?? incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Asset turnover", "Revenue ÷ Total assets", { revenue: flowRevenue, total_assets: totalAssets }, safeDiv(flowRevenue, totalAssets), need([["revenue", flowRevenue], ["total assets", totalAssets]]), `${flowRevenuePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Equity multiplier", "Total assets ÷ Equity", { total_assets: totalAssets, equity }, safeDiv(totalAssets, equity), need([["total assets", totalAssets], ["equity", equity]]), balancePeriod);

  // Leverage & liquidity
  add("Debt-to-equity", "Borrowings ÷ Equity", { borrowings, equity }, borrowings !== null && equity ? borrowings / equity : null, need([["borrowings", borrowings], ["equity", equity]]), balancePeriod);
  add("Net debt", "Borrowings − Cash and equivalents", { borrowings, cash_and_equivalents: cashEq }, netDebt, need([["borrowings", borrowings], ["cash and equivalents", cashEq]]), balancePeriod);
  add("Net debt-to-equity", "(Borrowings − Cash) ÷ Equity", { borrowings, cash_and_equivalents: cashEq, equity }, safeDiv(netDebt, equity), need([["borrowings", borrowings], ["cash and equivalents", cashEq], ["equity", equity]]), balancePeriod);
  add("Debt / assets", "Borrowings ÷ Total assets", { borrowings, total_assets: totalAssets }, safeDiv(borrowings, totalAssets), need([["borrowings", borrowings], ["total assets", totalAssets]]), balancePeriod);
  add("Liabilities / assets", "Total liabilities ÷ Total assets", { total_liabilities: totalLiabilities, total_assets: totalAssets }, safeDiv(totalLiabilities, totalAssets), need([["total liabilities", totalLiabilities], ["total assets", totalAssets]]), balancePeriod);
  add("Current ratio", "Current assets ÷ Current liabilities", { current_assets: currentAssets, current_liabilities: currentLiabilities }, currentAssets !== null && currentLiabilities ? currentAssets / currentLiabilities : null, need([["current assets", currentAssets], ["current liabilities", currentLiabilities]]), balancePeriod);
  add("Quick ratio", "(Current assets − Inventory) ÷ Current liabilities", { current_assets: currentAssets, inventory, current_liabilities: currentLiabilities }, currentAssets !== null && inventory !== null && currentLiabilities ? (currentAssets - inventory) / currentLiabilities : null, need([["current assets", currentAssets], ["inventory", inventory], ["current liabilities", currentLiabilities]]), balancePeriod);
  add("Cash ratio", "Cash and equivalents ÷ Current liabilities", { cash_and_equivalents: cashEq, current_liabilities: currentLiabilities }, safeDiv(cashEq, currentLiabilities), need([["cash and equivalents", cashEq], ["current liabilities", currentLiabilities]]), balancePeriod);
  add("Receivables / revenue", "Receivables ÷ Revenue", { receivables, revenue: flowRevenue }, safeDiv(receivables, flowRevenue), need([["receivables", receivables], ["revenue", flowRevenue]]), `${balancePeriod ?? "?"} / ${flowRevenuePeriod ?? "?"}`);
  add("Receivables / share", "(Receivables × 1,000) ÷ effective shares outstanding", { receivables_pkr_thousands: receivables, shares_outstanding: effectiveShares }, safeDiv(receivablesRupees, effectiveShares), need([["receivables", receivables], ["effective shares outstanding", effectiveShares]]), balancePeriod);
  add("Receivables % of market cap", "(Receivables × 1,000) ÷ Market capitalization", { receivables_pkr_thousands: receivables, market_cap: marketCap }, pct(receivablesRupees, marketCap), need([["receivables", receivables], ["market capitalization", marketCap]]), `${balancePeriod ?? "?"}`);
  add("Days sales outstanding", "(Receivables ÷ Revenue) × 365", { receivables, revenue: flowRevenue }, receivables !== null && flowRevenue ? (receivables / flowRevenue) * 365 : null, need([["receivables", receivables], ["revenue", flowRevenue]]), `${balancePeriod ?? "?"} / ${flowRevenuePeriod ?? "?"}`);
  add("Retained earnings / assets", "Retained earnings ÷ Total assets", { retained_earnings: retainedEarnings, total_assets: totalAssets }, safeDiv(retainedEarnings, totalAssets), need([["retained earnings", retainedEarnings], ["total assets", totalAssets]]), balancePeriod);
  add("Interest coverage", "(Profit before tax + Finance cost) ÷ Finance cost", { profit_before_tax: pbt, finance_cost: financeCost }, pbt !== null && financeCost ? (pbt + financeCost) / financeCost : null, need([["profit before tax", pbt], ["finance cost", financeCost]]), detailPeriod ?? incomePeriod);

  // Bank-specific ratios. These only produce a value when the bank line items
  // are present (net markup income, deposits, advances, NPLs), so they stay
  // null for industrial companies. NIM annualizes an interim net markup income
  // against total assets (a proxy for average earning assets); cost-to-income
  // and the balance-sheet ratios are same-period, so no annualization.
  const bankIncomeTotal = netMarkupIncome !== null || nonMarkupIncome !== null ? (netMarkupIncome ?? 0) + (nonMarkupIncome ?? 0) : null;
  add("Net interest margin", "Annualized net markup income ÷ Total assets", { net_markup_income: netMarkupIncome, total_assets: totalAssets, months: bankMonths }, netMarkupIncome !== null && totalAssets ? ((netMarkupIncome * (12 / bankMonths)) / totalAssets) * 100 : null, need([["net markup income", netMarkupIncome], ["total assets", totalAssets]]), `${bankPeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Cost-to-income", "Operating expenses ÷ (Net markup + non-markup income)", { operating_expenses: bankOpex, total_income: bankIncomeTotal }, bankOpex !== null && bankIncomeTotal ? (bankOpex / bankIncomeTotal) * 100 : null, need([["operating expenses", bankOpex], ["net markup income", netMarkupIncome]]), bankPeriod);
  add("Non-markup income ratio", "Non-markup income ÷ (Net markup + non-markup income)", { non_markup_income: nonMarkupIncome, total_income: bankIncomeTotal }, nonMarkupIncome !== null && bankIncomeTotal ? (nonMarkupIncome / bankIncomeTotal) * 100 : null, need([["non-markup income", nonMarkupIncome], ["total income", bankIncomeTotal]]), bankPeriod);
  add("Advances-to-deposits (ADR)", "Advances ÷ Deposits", { advances, deposits }, advances !== null && deposits ? (advances / deposits) * 100 : null, need([["advances", advances], ["deposits", deposits]]), bankBalancePeriod ?? balancePeriod);
  add("NPL ratio", "Non-performing loans ÷ Gross advances", { non_performing_loans: nonPerformingLoans, gross_advances: grossAdvances }, nonPerformingLoans !== null && grossAdvances ? (nonPerformingLoans / grossAdvances) * 100 : null, need([["non-performing loans", nonPerformingLoans], ["gross advances", grossAdvances]]), bankBalancePeriod ?? balancePeriod);

  // Growth (vs previous extracted period of the same kind)
  const prevRevenue = numOf(prevIncome?.data, "revenue");
  const prevGrossProfit = numOf(prevIncome?.data, "gross_profit");
  const prevPat = numOf(prevIncome?.data, "profit_after_tax");
  const prevEps = numOf(prevIncome?.data, "eps");
  const growthPeriod = income && prevIncome ? `${periodLabel(income)} vs ${periodLabel(prevIncome)}` : incomePeriod;
  add("Revenue growth", "(Revenue − Prior revenue) ÷ Prior revenue", { revenue, prior_revenue: prevRevenue }, revenue !== null && prevRevenue ? ((revenue - prevRevenue) / Math.abs(prevRevenue)) * 100 : null, need([["revenue", revenue], ["prior-period revenue", prevRevenue]]), growthPeriod);
  add("Profit growth", "(PAT − Prior PAT) ÷ |Prior PAT|", { profit_after_tax: pat, prior_pat: prevPat }, pat !== null && prevPat ? ((pat - prevPat) / Math.abs(prevPat)) * 100 : null, need([["profit after tax", pat], ["prior-period profit", prevPat]]), growthPeriod);
  add("EPS growth", "(EPS − Prior EPS) ÷ |Prior EPS|", { eps, prior_eps: prevEps }, eps !== null && prevEps ? ((eps - prevEps) / Math.abs(prevEps)) * 100 : null, need([["EPS", eps], ["prior-period EPS", prevEps]]), growthPeriod);
  add("Revenue CAGR", "(Revenue ÷ Base revenue)^(1 / years) − 1", { revenue, base_revenue: numOf(cagrBase?.data, "revenue"), years: cagrYears }, cagr(revenue, numOf(cagrBase?.data, "revenue")), need([["revenue", revenue], ["base revenue", numOf(cagrBase?.data, "revenue")], ["year gap", cagrYears]]), cagrPeriod);
  add("EPS CAGR", "(EPS ÷ Base EPS)^(1 / years) − 1", { eps, base_eps: numOf(cagrBase?.data, "eps"), years: cagrYears }, cagr(eps, numOf(cagrBase?.data, "eps")), need([["EPS", eps], ["base EPS", numOf(cagrBase?.data, "eps")], ["year gap", cagrYears]]), cagrPeriod);
  add("Gross margin change", "Gross margin − Prior gross margin", { gross_profit: grossProfit, revenue, prior_gross_profit: prevGrossProfit, prior_revenue: prevRevenue }, grossProfit !== null && revenue && prevGrossProfit !== null && prevRevenue ? (grossProfit / revenue - prevGrossProfit / prevRevenue) * 100 : null, need([["gross profit", grossProfit], ["revenue", revenue], ["prior gross profit", prevGrossProfit], ["prior revenue", prevRevenue]]), growthPeriod);
  add("Net margin change", "Net margin − Prior net margin", { profit_after_tax: pat, revenue, prior_pat: prevPat, prior_revenue: prevRevenue }, pat !== null && revenue && prevPat !== null && prevRevenue ? (pat / revenue - prevPat / prevRevenue) * 100 : null, need([["profit after tax", pat], ["revenue", revenue], ["prior PAT", prevPat], ["prior revenue", prevRevenue]]), growthPeriod);

  // Cash flow
  add("FCF (OCF − Capex)", "Operating cash flow − Capex", { operating_cash_flow: ocf, capex }, fcf, need([["operating cash flow", ocf], ["capex", capex]]), periodLabel(cash));
  add("FCF margin", "Free cash flow ÷ Same-period revenue", { free_cash_flow: fcf, revenue: cashRevenue ?? revenue }, pct(fcf, cashRevenue ?? (cashMonths === 12 ? revenue : null)), need([["free cash flow", fcf], ["same-period revenue", cashRevenue ?? (cashMonths === 12 ? revenue : null)]]), cashRevenue !== null ? periodLabel(cash) : `${incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("OCF / PAT", "Operating cash flow ÷ Same-period profit after tax", { operating_cash_flow: ocf, profit_after_tax: cashPat ?? pat }, safeDiv(ocf, cashPat ?? (cashMonths === 12 ? pat : null)), need([["operating cash flow", ocf], ["same-period profit after tax", cashPat ?? (cashMonths === 12 ? pat : null)]]), cashPat !== null ? periodLabel(cash) : `${incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("Cash conversion", "Operating cash flow ÷ Same-period operating profit", { operating_cash_flow: ocf, operating_profit: cashOperatingProfit ?? operatingProfit }, safeDiv(ocf, cashOperatingProfit ?? (cashMonths === 12 ? operatingProfit : null)), need([["operating cash flow", ocf], ["same-period operating profit", cashOperatingProfit ?? (cashMonths === 12 ? operatingProfit : null)]]), cashOperatingProfit !== null ? periodLabel(cash) : `${detailPeriod ?? incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("Accrual ratio", "(Same-period PAT − Operating cash flow) ÷ Total assets", { profit_after_tax: cashPat ?? pat, operating_cash_flow: ocf, total_assets: totalAssets }, (cashPat ?? (cashMonths === 12 ? pat : null)) !== null && ocf !== null ? safeDiv((cashPat ?? pat)! - ocf, totalAssets) : null, need([["same-period profit after tax", cashPat ?? (cashMonths === 12 ? pat : null)], ["operating cash flow", ocf], ["total assets", totalAssets]]), `${cashPat !== null ? periodLabel(cash) : incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);

  return out;
}

/** Compute and persist ratios for a ticker (service-role write). */
export async function refreshRatios(supabase: SupabaseClient, ticker: string): Promise<{ computed: number; available: number }> {
  const ratios = await computeRatios(supabase, ticker);
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && ratios.length) {
    const db = createAdminClient();
    await db.from("company_ratios").upsert(ratios, { onConflict: "ticker,ratio_name" });
    await db.from("company_ratio_history").upsert(
      ratios.map((r) => ({
        ...r,
        as_of_date: r.computed_at.slice(0, 10),
      })),
      { onConflict: "ticker,ratio_name,as_of_date,source_period" }
    );
  }
  return { computed: ratios.length, available: ratios.filter((r) => r.ratio_value !== null).length };
}
