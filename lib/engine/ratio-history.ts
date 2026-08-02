import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ratios computed as of each fiscal period, rather than only for today.
 *
 * `computeRatios` builds a current snapshot: it takes the latest income
 * statement, the latest balance sheet and the latest cash flow, and emits one
 * row per ratio. That is the right shape for "what is this company worth now",
 * and it is why the five-year backfill barely moved ratio coverage — holdings
 * went from 63.7% to 64.3%. The depth was never the constraint on a snapshot.
 *
 * This walks the other axis. For every fiscal period a company has filed it
 * pairs that period's three statements, prices it at that period's own close,
 * and writes a dated row. The result is a series: margins over five years, when
 * leverage started climbing, whether this quarter's return on equity is normal
 * for the company or not.
 *
 * Two rules it does not break:
 *
 *   STATEMENTS FROM ONE PERIOD ONLY. A ratio never mixes a balance sheet from
 *   one year with an income statement from another. Where the matching
 *   statement is absent the ratio is null with a reason, which is the whole
 *   point of a history: a gap has to look like a gap, not like a flat line.
 *
 *   PRICED AT THE TIME. A price-linked ratio uses the close on or before that
 *   period end, never today's. A P/E history built on today's price is not a
 *   history of anything.
 */

export interface RatioHistoryRow {
  ticker: string;
  ratio_name: string;
  as_of_date: string;
  ratio_value: number | null;
  formula: string;
  inputs: Record<string, number | string | null>;
  missing: string | null;
  source_period: string;
  source: string;
  computed_at: string;
}

export interface RatioHistoryResult {
  ticker: string;
  periods: number;
  rows: number;
  computed: number;
  skipped: string[];
}

interface FinRow {
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_type: string | null;
  statement_type: string | null;
  reporting_basis: string | null;
  reported_date: string | null;
  updated_at: string | null;
  data: Record<string, unknown> | null;
}

const num = (d: Record<string, unknown> | null | undefined, k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Safe divide: null unless both sides are present and the denominator is non-zero. */
const div = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

const pct = (a: number | null, b: number | null): number | null => {
  const r = div(a, b);
  return r === null ? null : r * 100;
};

/**
 * The last calendar day of a fiscal period, which is the date the statements
 * describe and therefore the date to price them at. PSX labels a fiscal year by
 * the calendar year it ENDS in, so FY2025 for a June filer ends 30 June 2025.
 */
function periodEndDate(fiscalYear: number, fiscalPeriod: string, fyEndMonth: number): string | null {
  const monthsBack: Record<string, number> = { FY: 0, "9M": 3, H1: 6, Q1: 9 };
  const back = monthsBack[fiscalPeriod];
  if (back === undefined) return null;
  // Count back from the year end: 9M ends one quarter before it, H1 two, Q1 three.
  let month = fyEndMonth - back;
  let year = fiscalYear;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export async function computeRatioHistory(
  db: SupabaseClient,
  ticker: string,
  opts: { years?: number; includeInterim?: boolean } = {}
): Promise<RatioHistoryResult> {
  const t = ticker.toUpperCase();
  const years = opts.years ?? 5;
  const includeInterim = opts.includeInterim ?? true;
  const now = new Date().toISOString();
  const out: RatioHistoryResult = { ticker: t, periods: 0, rows: 0, computed: 0, skipped: [] };

  const [{ data: finData }, { data: meta }] = await Promise.all([
    db
      .from("company_financials")
      .select("fiscal_year, fiscal_period, period_type, statement_type, reporting_basis, reported_date, updated_at, data")
      .eq("ticker", t)
      .eq("review_status", "published"),
    db.from("company_metadata").select("fiscal_year_end_month").eq("ticker", t).maybeSingle(),
  ]);

  const rows = (finData ?? []) as FinRow[];
  if (rows.length === 0) {
    out.skipped.push("no published financials");
    return out;
  }
  const fyEndMonth = (meta?.fiscal_year_end_month as number | null) ?? null;
  if (!fyEndMonth) {
    // Without a fiscal calendar there is no period end, so nothing can be
    // dated or priced. Refusing beats stamping every period 31 December.
    out.skipped.push("fiscal year end unknown — cannot date or price the periods");
    return out;
  }

  // Index by period, then by basis. Newest extraction wins within a basis,
  // matching the rule the rest of the engine uses for competing readings.
  const byPeriod = new Map<string, Map<string, Partial<Record<string, FinRow>>>>();
  for (const r of [...rows].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))) {
    if (!r.fiscal_year || !r.fiscal_period || !r.statement_type) continue;
    const pk = `${r.fiscal_year}|${r.fiscal_period}`;
    const basis = r.reporting_basis ?? "unlabelled";
    const bases = byPeriod.get(pk) ?? new Map();
    const slot = bases.get(basis) ?? {};
    slot[r.statement_type] = r;
    bases.set(basis, slot);
    byPeriod.set(pk, bases);
  }

  /**
   * The two reporting entities a company can describe, and which stored bases
   * belong to each.
   *
   * This matters because the three statements of one period routinely arrive
   * under different basis labels. OGDC's FY2025 income statement comes from the
   * PSX portal and is stored "unlabelled"; its balance sheet comes from the
   * filing and is stored "unconsolidated". Requiring an exact basis match left
   * every balance-sheet ratio null even though both statements were present and
   * described the same entity. The portal series is always unconsolidated, so
   * "unlabelled" is grouped with it rather than treated as a third entity.
   *
   * Consolidated stays strictly separate. Dividing a group's equity into a
   * standalone company's profit describes nothing.
   */
  const SERIES: { name: string; bases: string[] }[] = [
    { name: "unconsolidated", bases: ["unconsolidated", "unlabelled"] },
    { name: "consolidated", bases: ["consolidated"] },
  ];

  // Cumulative periods only, deliberately. Q1 is both a quarter and the 3M
  // cumulative, so it qualifies; the derived Q2, Q3 and Q4 do not. Their income
  // is a single quarter, but the balance sheet beside them is point-in-time and
  // the cash flow is year-to-date, so an OCF-to-profit ratio built from them
  // would divide three months of profit into nine months of cash. These are the
  // periods where all three statements describe the same span.
  const periodsWanted = includeInterim ? ["FY", "9M", "H1", "Q1"] : ["FY"];
  const latestFy = Math.max(...rows.map((r) => r.fiscal_year ?? 0));
  const oldestFy = latestFy - years + 1;

  // Price series, read once and scanned per period rather than one query each.
  const { data: priceData } = await db
    .from("company_price_history")
    .select("price_date, close")
    .eq("ticker", t)
    .order("price_date", { ascending: true });
  const prices = (priceData ?? []) as { price_date: string; close: number | null }[];
  /** The last close on or before a date. A period end is usually a weekend or a holiday. */
  const priceAsOf = (date: string): number | null => {
    let lo = 0;
    let hi = prices.length - 1;
    let best: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (prices[mid].price_date <= date) {
        if (typeof prices[mid].close === "number") best = prices[mid].close;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  };

  const history: RatioHistoryRow[] = [];

  for (const [pk, bases] of byPeriod) {
    const [fyRaw, period] = pk.split("|");
    const fy = Number(fyRaw);
    if (!Number.isFinite(fy) || fy < oldestFy || fy > latestFy) continue;
    if (!periodsWanted.includes(period)) continue;
    const asOf = periodEndDate(fy, period, fyEndMonth);
    if (!asOf) continue;

    for (const series of SERIES) {
    // Within a series, the first basis that carries a given statement wins, so
    // a filing-sourced balance sheet pairs with a portal-sourced income
    // statement without ever crossing into the consolidated set.
    const pick = (type: string): FinRow | undefined => {
      for (const b of series.bases) {
        const hit = bases.get(b)?.[type];
        if (hit) return hit;
      }
      return undefined;
    };
    const income = pick("income_statement");
    if (!income) continue;
    const basis = series.name;
    const balance = pick("balance_sheet");
    const cash = pick("cash_flow");

    const inc = income.data;
    const bs = balance?.data ?? null;
    const cf = cash?.data ?? null;

    const revenue = num(inc, "revenue");
    const pat = num(inc, "profit_after_tax");
    const pbt = num(inc, "profit_before_tax");
    const eps = num(inc, "eps");
    const equity = num(bs, "equity");
    const assets = num(bs, "total_assets");
    const ocf = num(cf, "operating_cash_flow");
    const capex = num(cf, "capex");
    const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;

    // Share count from this period's own profit and EPS, so per-share figures
    // are computed on the base the company itself reported for the period. A
    // later bonus issue must not be applied backwards to an older period.
    const shares = pat !== null && eps !== null && Math.abs(eps) > 0.01 ? pat / eps : null;
    const price = priceAsOf(asOf);
    // Basis belongs in the period label, not just the source. It is part of the
    // row's uniqueness key, and a company filing both a consolidated and an
    // unconsolidated set has two genuinely different ratio histories: collapsing
    // them makes the two collide inside a single upsert batch.
    const label = `FY${fy} ${period} (${basis})`;
    const src = "period-ratios";

    const add = (
      name: string,
      formula: string,
      inputs: Record<string, number | string | null>,
      value: number | null,
      needed: [string, number | null][]
    ) => {
      const gone = needed.filter(([, v]) => v === null).map(([n]) => n);
      history.push({
        ticker: t,
        ratio_name: name,
        as_of_date: asOf,
        ratio_value: value !== null && Number.isFinite(value) ? value : null,
        formula,
        inputs,
        missing: gone.length ? `Cannot calculate — missing: ${gone.join(", ")}.` : null,
        source_period: label,
        source: src,
        computed_at: now,
      });
    };

    // Profitability
    add("Gross margin", "gross profit / revenue x 100", { gross_profit: num(inc, "gross_profit"), revenue }, pct(num(inc, "gross_profit"), revenue), [["gross profit", num(inc, "gross_profit")], ["revenue", revenue]]);
    add("Operating margin", "operating profit / revenue x 100", { operating_profit: num(inc, "operating_profit"), revenue }, pct(num(inc, "operating_profit"), revenue), [["operating profit", num(inc, "operating_profit")], ["revenue", revenue]]);
    add("Net margin", "profit after tax / revenue x 100", { profit_after_tax: pat, revenue }, pct(pat, revenue), [["profit after tax", pat], ["revenue", revenue]]);
    add("Effective tax rate", "tax / profit before tax x 100", { tax: num(inc, "tax"), profit_before_tax: pbt }, pct(num(inc, "tax"), pbt), [["tax", num(inc, "tax")], ["profit before tax", pbt]]);

    // Returns. Period-end equity and assets, not an average: the opening
    // balance is not reliably present for every period we hold, and a stated
    // formula that is applied consistently beats a better one applied
    // sometimes.
    add("ROE", "profit after tax / equity x 100 (period-end equity)", { profit_after_tax: pat, equity }, pct(pat, equity), [["profit after tax", pat], ["equity", equity]]);
    add("ROA", "profit after tax / total assets x 100 (period-end assets)", { profit_after_tax: pat, total_assets: assets }, pct(pat, assets), [["profit after tax", pat], ["total assets", assets]]);
    add("Asset turnover", "revenue / total assets", { revenue, total_assets: assets }, div(revenue, assets), [["revenue", revenue], ["total assets", assets]]);
    add("Equity multiplier", "total assets / equity", { total_assets: assets, equity }, div(assets, equity), [["total assets", assets], ["equity", equity]]);

    // Leverage
    const borrowings = num(bs, "borrowings");
    const cashBal = num(bs, "cash_and_equivalents");
    const netDebt = borrowings !== null && cashBal !== null ? borrowings - cashBal : null;
    add("Debt-to-equity", "borrowings / equity", { borrowings, equity }, div(borrowings, equity), [["borrowings", borrowings], ["equity", equity]]);
    add("Net debt-to-equity", "(borrowings - cash) / equity", { borrowings, cash_and_equivalents: cashBal, equity }, div(netDebt, equity), [["borrowings", borrowings], ["cash and equivalents", cashBal], ["equity", equity]]);
    add("Debt / assets", "borrowings / total assets", { borrowings, total_assets: assets }, div(borrowings, assets), [["borrowings", borrowings], ["total assets", assets]]);
    add("Liabilities / assets", "total liabilities / total assets", { total_liabilities: num(bs, "total_liabilities"), total_assets: assets }, div(num(bs, "total_liabilities"), assets), [["total liabilities", num(bs, "total_liabilities")], ["total assets", assets]]);
    add("Interest coverage", "operating profit / finance cost", { operating_profit: num(inc, "operating_profit"), finance_cost: num(inc, "finance_cost") }, div(num(inc, "operating_profit"), num(inc, "finance_cost")), [["operating profit", num(inc, "operating_profit")], ["finance cost", num(inc, "finance_cost")]]);

    // Liquidity
    const ca = num(bs, "current_assets");
    const cl = num(bs, "current_liabilities");
    const inv = num(bs, "inventory");
    add("Current ratio", "current assets / current liabilities", { current_assets: ca, current_liabilities: cl }, div(ca, cl), [["current assets", ca], ["current liabilities", cl]]);
    add("Quick ratio", "(current assets - inventory) / current liabilities", { current_assets: ca, inventory: inv, current_liabilities: cl }, div(ca !== null && inv !== null ? ca - inv : null, cl), [["current assets", ca], ["inventory", inv], ["current liabilities", cl]]);
    add("Cash ratio", "cash and equivalents / current liabilities", { cash_and_equivalents: cashBal, current_liabilities: cl }, div(cashBal, cl), [["cash and equivalents", cashBal], ["current liabilities", cl]]);

    // Working capital
    const recv = num(bs, "receivables");
    add("Receivables / revenue", "receivables / revenue x 100", { receivables: recv, revenue }, pct(recv, revenue), [["receivables", recv], ["revenue", revenue]]);
    const periodDays: Record<string, number> = { FY: 365, "9M": 273, H1: 182, Q1: 91 };
    add("Days sales outstanding", `receivables / revenue x ${periodDays[period]} days`, { receivables: recv, revenue, days: periodDays[period] }, div(recv, revenue) === null ? null : div(recv, revenue)! * periodDays[period], [["receivables", recv], ["revenue", revenue]]);

    // Cash quality
    add("FCF (OCF − Capex)", "operating cash flow - capex", { operating_cash_flow: ocf, capex }, fcf, [["operating cash flow", ocf], ["capex", capex]]);
    add("FCF margin", "free cash flow / revenue x 100", { free_cash_flow: fcf, revenue }, pct(fcf, revenue), [["free cash flow", fcf], ["revenue", revenue]]);
    add("OCF / PAT", "operating cash flow / profit after tax", { operating_cash_flow: ocf, profit_after_tax: pat }, div(ocf, pat), [["operating cash flow", ocf], ["profit after tax", pat]]);

    // Per share
    add("Book value / share", "equity / shares outstanding", { equity, shares }, div(equity, shares), [["equity", equity], ["shares outstanding", shares]]);
    add("Sales / share", "revenue / shares outstanding", { revenue, shares }, div(revenue, shares), [["revenue", revenue], ["shares outstanding", shares]]);

    // Valuation, priced at the period end rather than today.
    const bvps = div(equity, shares);
    const spsv = div(revenue, shares);
    // A loss makes P/E undefined, not negative: a negative price-to-earnings
    // sorts as "cheap" and reads as a bargain.
    add("P/E", `close on ${asOf} / EPS`, { price, eps, as_of: asOf }, price !== null && eps !== null && eps > 0 ? price / eps : null, [["price at period end", price], ["eps", eps]]);
    add("Earnings yield", `EPS / close on ${asOf} x 100`, { eps, price, as_of: asOf }, pct(eps, price), [["eps", eps], ["price at period end", price]]);
    add("P/B", `close on ${asOf} / book value per share`, { price, book_value_per_share: bvps, as_of: asOf }, price !== null && bvps !== null && bvps > 0 ? price / bvps : null, [["price at period end", price], ["book value per share", bvps]]);
    add("P/S", `close on ${asOf} / sales per share`, { price, sales_per_share: spsv, as_of: asOf }, price !== null && spsv !== null && spsv > 0 ? price / spsv : null, [["price at period end", price], ["sales per share", spsv]]);

    // Dividends, from the filing rather than the payouts feed, which is too
    // patchy to rely on: it returns nothing at all for real payers like MLCF
    // and PTC. dividends_paid is a financing outflow, so its sign is flipped.
    const divPaid = num(cf, "dividends_paid");
    const divOut = divPaid === null ? null : Math.abs(divPaid);
    add("Payout ratio", "dividends paid / profit after tax x 100", { dividends_paid: divPaid, profit_after_tax: pat }, pct(divOut, pat), [["dividends paid", divPaid], ["profit after tax", pat]]);
    const dps = num(inc, "dividend_per_share");
    add("Dividend yield", `dividend per share / close on ${asOf} x 100`, { dividend_per_share: dps, price, as_of: asOf }, pct(dps, price), [["dividend per share", dps], ["price at period end", price]]);

    // Banks. Emitted only when the period actually carries bank line items, so
    // a manufacturer's history is not padded with rows that can never compute.
    const markupEarned = num(inc, "markup_earned");
    const netMarkup = num(inc, "net_markup_income");
    const deposits = num(bs, "deposits");
    const advances = num(bs, "advances");
    const isBankPeriod = markupEarned !== null || netMarkup !== null || deposits !== null || advances !== null;
    if (isBankPeriod) {
      add("Net interest margin", "net markup income / total assets x 100", { net_markup_income: netMarkup, total_assets: assets }, pct(netMarkup, assets), [["net markup income", netMarkup], ["total assets", assets]]);
      const nonMarkup = num(inc, "non_markup_income");
      const totalIncome = netMarkup !== null && nonMarkup !== null ? netMarkup + nonMarkup : null;
      add("Cost-to-income", "operating expenses / (net markup + non-markup income) x 100", { operating_expenses: num(inc, "operating_expenses"), total_income: totalIncome }, pct(num(inc, "operating_expenses"), totalIncome), [["operating expenses", num(inc, "operating_expenses")], ["total income", totalIncome]]);
      add("Advances-to-deposits (ADR)", "advances / deposits x 100", { advances, deposits }, pct(advances, deposits), [["advances", advances], ["deposits", deposits]]);
      const npl = num(bs, "non_performing_loans");
      const gross = num(bs, "gross_advances");
      add("NPL ratio", "non-performing loans / gross advances x 100", { non_performing_loans: npl, gross_advances: gross }, pct(npl, gross), [["non-performing loans", npl], ["gross advances", gross]]);
    }

    out.periods++;
    }
  }

  if (history.length === 0) {
    out.skipped.push("no period had an income statement inside the window");
    return out;
  }

  // Chunked: a five-year run for one company is several hundred rows, and the
  // whole holdings set at once would be a very large single statement.
  for (let i = 0; i < history.length; i += 500) {
    const { error } = await db
      .from("company_ratio_history")
      .upsert(history.slice(i, i + 500), { onConflict: "ticker,ratio_name,as_of_date,source_period" });
    if (error) {
      out.skipped.push(`upsert: ${error.message}`);
      return out;
    }
  }

  out.rows = history.length;
  out.computed = history.filter((h) => h.ratio_value !== null).length;
  return out;
}
