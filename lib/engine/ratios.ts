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
  confidence: number | null;
  data: Record<string, number | null | string>;
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
      .select("period_type, fiscal_year, fiscal_period, statement_type, reported_date, source_type, source_url, confidence, data")
      .eq("ticker", t)
      .order("reported_date", { ascending: false })
      .limit(30),
    supabase.from("market_quotes").select("price, as_of").eq("ticker", t).maybeSingle(),
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
  const pageAnnual = rows
    .filter((r) => r.statement_type === "income_statement" && r.period_type === "annual" && r.source_type === "psx-portal")
    .sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0));

  // Valuation / margins / growth: prefer the clean page annual series; fall back
  // to any annual, then any income statement.
  const annualRows = rows.filter((r) => r.period_type === "annual");
  const income = pageAnnual[0] ?? latest(annualRows, "income_statement") ?? latest(rows, "income_statement");
  const prevIncome = pageAnnual.length > 1 && income === pageAnnual[0] ? pageAnnual[1] : previous(income?.period_type === "annual" ? annualRows : rows, income);
  const balance = latest(rows, "balance_sheet");
  const cash = latest(rows, "cash_flow");

  const price = quote?.price != null && Number(quote.price) > 0 ? Number(quote.price) : null;

  // Trailing-12-month cash dividend per share from recorded dividends.
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const ttmDps =
    (divRows ?? [])
      .filter((d) => d.dividend_per_share && (d.announcement_date ?? d.book_closure_start ?? "") >= cutoff)
      .reduce((s, d) => s + Number(d.dividend_per_share), 0) || null;

  const eps = numOf(income?.data, "eps");
  const revenue = numOf(income?.data, "revenue");
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
  const ocf = numOf(cash?.data, "operating_cash_flow");
  const capex = numOf(cash?.data, "capex");
  const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;

  // Financial statements are stored in PKR thousands. EPS and price are per
  // share in PKR, so PAT/EPS derives an approximate share count without mixing
  // units. Require PAT and EPS to have the same sign to avoid nonsense shares.
  const sharesOutstanding =
    pat !== null && eps !== null && eps !== 0 && pat / eps > 0 ? Math.abs((pat * 1000) / eps) : null;
  const revenueRupees = revenue !== null ? revenue * 1000 : null;
  const equityRupees = equity !== null ? equity * 1000 : null;
  const cashRupees = cashEq !== null ? cashEq * 1000 : null;
  const receivablesRupees = receivables !== null ? receivables * 1000 : null;
  const borrowingsRupees = borrowings !== null ? borrowings * 1000 : null;
  const fcfRupees = fcf !== null ? fcf * 1000 : null;
  const operatingProfitRupees = operatingProfit !== null ? operatingProfit * 1000 : null;
  const marketCap = price !== null && sharesOutstanding !== null ? price * sharesOutstanding : null;
  const enterpriseValue =
    marketCap !== null ? marketCap + (borrowingsRupees ?? 0) - (cashRupees ?? 0) : null;
  const netDebt = borrowings !== null && cashEq !== null ? borrowings - cashEq : null;
  const investedCapital = equity !== null && borrowings !== null && cashEq !== null ? equity + borrowings - cashEq : null;
  const taxRate = pbt !== null && pbt > 0 && tax !== null ? Math.min(1, Math.max(0, tax / pbt)) : null;
  const nopat = operatingProfit !== null && taxRate !== null ? operatingProfit * (1 - taxRate) : null;

  const incomePeriod = periodLabel(income);
  const balancePeriod = periodLabel(balance);
  const source = income?.source_url ?? balance?.source_url ?? null;

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

  // Valuation
  add("P/E", "Price ÷ EPS", { price, eps }, price !== null && eps ? price / eps : null, need([["price", price], ["EPS", eps]]) ?? (eps === 0 ? "EPS is zero." : null), incomePeriod);
  add("Earnings yield", "EPS ÷ Price", { price, eps }, price && eps !== null ? (eps / price) * 100 : null, need([["price", price], ["EPS", eps]]), incomePeriod);
  add("Shares outstanding (derived)", "(Profit after tax × 1,000) ÷ EPS", { profit_after_tax_pkr_thousands: pat, eps }, sharesOutstanding, need([["profit after tax", pat], ["EPS", eps]]) ?? (eps === 0 ? "EPS is zero." : null), incomePeriod);
  add("Market cap (derived)", "Price × derived shares outstanding", { price, shares_outstanding: sharesOutstanding }, marketCap, need([["price", price], ["derived shares outstanding", sharesOutstanding]]), incomePeriod);
  add("Book value / share", "(Equity × 1,000) ÷ derived shares outstanding", { equity_pkr_thousands: equity, shares_outstanding: sharesOutstanding }, safeDiv(equityRupees, sharesOutstanding), need([["equity", equity], ["derived shares outstanding", sharesOutstanding]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Sales / share", "(Revenue × 1,000) ÷ derived shares outstanding", { revenue_pkr_thousands: revenue, shares_outstanding: sharesOutstanding }, safeDiv(revenueRupees, sharesOutstanding), need([["revenue", revenue], ["derived shares outstanding", sharesOutstanding]]), incomePeriod);
  add("Cash / share", "(Cash and equivalents × 1,000) ÷ derived shares outstanding", { cash_and_equivalents_pkr_thousands: cashEq, shares_outstanding: sharesOutstanding }, safeDiv(cashRupees, sharesOutstanding), need([["cash and equivalents", cashEq], ["derived shares outstanding", sharesOutstanding]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("P/B", "Price ÷ Book value per share", { price, equity_pkr_thousands: equity, shares_outstanding: sharesOutstanding }, price !== null ? safeDiv(price, safeDiv(equityRupees, sharesOutstanding)) : null, need([["price", price], ["equity", equity], ["derived shares outstanding", sharesOutstanding]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("P/S", "Market capitalization ÷ Revenue", { market_cap: marketCap, revenue_pkr: revenueRupees }, safeDiv(marketCap, revenueRupees), need([["market capitalization", marketCap], ["revenue", revenue]]), incomePeriod);
  add("Price / FCF", "Market capitalization ÷ Free cash flow", { market_cap: marketCap, free_cash_flow_pkr: fcfRupees }, safeDiv(marketCap, fcfRupees), need([["market capitalization", marketCap], ["free cash flow", fcf]]), `${incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("FCF yield", "Free cash flow ÷ Market capitalization", { free_cash_flow_pkr: fcfRupees, market_cap: marketCap }, pct(fcfRupees, marketCap), need([["free cash flow", fcf], ["market capitalization", marketCap]]), `${incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("EV/Sales", "Enterprise value ÷ Revenue", { enterprise_value: enterpriseValue, revenue_pkr: revenueRupees }, safeDiv(enterpriseValue, revenueRupees), need([["enterprise value", enterpriseValue], ["revenue", revenue]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("EV/EBIT", "Enterprise value ÷ Operating profit", { enterprise_value: enterpriseValue, operating_profit_pkr: operatingProfitRupees }, safeDiv(enterpriseValue, operatingProfitRupees), need([["enterprise value", enterpriseValue], ["operating profit", operatingProfit]]), `${detailPeriod ?? incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Dividend yield (TTM)", "Trailing 12m cash DPS ÷ Price", { price, ttm_dps: ttmDps }, price && ttmDps ? (ttmDps / price) * 100 : null, need([["price", price], ["trailing dividends", ttmDps]]), "Last 12 months");
  add("Payout ratio", "TTM DPS ÷ EPS", { ttm_dps: ttmDps, eps }, ttmDps && eps ? (ttmDps / eps) * 100 : null, need([["trailing dividends", ttmDps], ["EPS", eps]]), incomePeriod);
  add("Dividend cover", "EPS ÷ TTM DPS", { eps, ttm_dps: ttmDps }, eps && ttmDps ? eps / ttmDps : null, need([["EPS", eps], ["trailing dividends", ttmDps]]), incomePeriod);

  // Profitability (statement-internal — units cancel)
  add("Gross margin", "Gross profit ÷ Revenue", { gross_profit: grossProfit, revenue }, grossProfit !== null && revenue ? (grossProfit / revenue) * 100 : null, need([["gross profit", grossProfit], ["revenue", revenue]]), incomePeriod);
  add("Operating margin", "Operating profit ÷ Revenue", { operating_profit: operatingProfit, revenue: detailRevenue }, operatingProfit !== null && detailRevenue ? (operatingProfit / detailRevenue) * 100 : null, need([["operating profit", operatingProfit], ["revenue", detailRevenue]]), detailPeriod ?? incomePeriod);
  add("Net margin", "Profit after tax ÷ Revenue", { profit_after_tax: pat, revenue }, pat !== null && revenue ? (pat / revenue) * 100 : null, need([["profit after tax", pat], ["revenue", revenue]]), incomePeriod);
  add("Cost of sales ratio", "Cost of sales ÷ Revenue", { cost_of_sales: costOfSales ?? detailCostOfSales, revenue: costOfSales !== null ? revenue : detailRevenue }, pct(costOfSales ?? detailCostOfSales, costOfSales !== null ? revenue : detailRevenue), need([["cost of sales", costOfSales ?? detailCostOfSales], ["revenue", costOfSales !== null ? revenue : detailRevenue]]), costOfSales !== null ? incomePeriod : detailPeriod ?? incomePeriod);
  add("Operating expense ratio", "Operating expenses ÷ Revenue", { operating_expenses: operatingExpenses, revenue: detailRevenue }, pct(operatingExpenses, detailRevenue), need([["operating expenses", operatingExpenses], ["revenue", detailRevenue]]), detailPeriod ?? incomePeriod);
  add("Effective tax rate", "Tax expense ÷ Profit before tax", { tax_expense: tax, profit_before_tax: pbt }, pct(tax, pbt), need([["tax", tax], ["profit before tax", pbt]]), detailPeriod ?? incomePeriod);
  add("ROE", "Profit after tax ÷ Equity", { profit_after_tax: pat, equity }, pat !== null && equity ? (pat / equity) * 100 : null, need([["profit after tax", pat], ["equity", equity]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("ROA", "Profit after tax ÷ Total assets", { profit_after_tax: pat, total_assets: totalAssets }, pat !== null && totalAssets ? (pat / totalAssets) * 100 : null, need([["profit after tax", pat], ["total assets", totalAssets]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("ROIC", "NOPAT ÷ (Equity + Borrowings − Cash)", { nopat, equity, borrowings, cash_and_equivalents: cashEq, tax_rate: taxRate }, pct(nopat, investedCapital), need([["operating profit", operatingProfit], ["tax", tax], ["profit before tax", pbt], ["equity", equity], ["borrowings", borrowings], ["cash and equivalents", cashEq]]), `${detailPeriod ?? incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Asset turnover", "Revenue ÷ Total assets", { revenue, total_assets: totalAssets }, safeDiv(revenue, totalAssets), need([["revenue", revenue], ["total assets", totalAssets]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
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
  add("Receivables / revenue", "Receivables ÷ Revenue", { receivables, revenue }, safeDiv(receivables, revenue), need([["receivables", receivables], ["revenue", revenue]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Receivables / share", "(Receivables × 1,000) ÷ derived shares outstanding", { receivables_pkr_thousands: receivables, shares_outstanding: sharesOutstanding }, safeDiv(receivablesRupees, sharesOutstanding), need([["receivables", receivables], ["derived shares outstanding", sharesOutstanding]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Receivables % of market cap", "(Receivables × 1,000) ÷ Market capitalization", { receivables_pkr_thousands: receivables, market_cap: marketCap }, pct(receivablesRupees, marketCap), need([["receivables", receivables], ["market capitalization", marketCap]]), `${balancePeriod ?? "?"}`);
  add("Days sales outstanding", "(Receivables ÷ Revenue) × 365", { receivables, revenue }, receivables !== null && revenue ? (receivables / revenue) * 365 : null, need([["receivables", receivables], ["revenue", revenue]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("Retained earnings / assets", "Retained earnings ÷ Total assets", { retained_earnings: retainedEarnings, total_assets: totalAssets }, safeDiv(retainedEarnings, totalAssets), need([["retained earnings", retainedEarnings], ["total assets", totalAssets]]), balancePeriod);
  add("Interest coverage", "(Profit before tax + Finance cost) ÷ Finance cost", { profit_before_tax: pbt, finance_cost: financeCost }, pbt !== null && financeCost ? (pbt + financeCost) / financeCost : null, need([["profit before tax", pbt], ["finance cost", financeCost]]), detailPeriod ?? incomePeriod);

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
  add("FCF margin", "Free cash flow ÷ Revenue", { free_cash_flow: fcf, revenue }, pct(fcf, revenue), need([["free cash flow", fcf], ["revenue", revenue]]), `${incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("OCF / PAT", "Operating cash flow ÷ Profit after tax", { operating_cash_flow: ocf, profit_after_tax: pat }, safeDiv(ocf, pat), need([["operating cash flow", ocf], ["profit after tax", pat]]), `${incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("Cash conversion", "Operating cash flow ÷ Operating profit", { operating_cash_flow: ocf, operating_profit: operatingProfit }, safeDiv(ocf, operatingProfit), need([["operating cash flow", ocf], ["operating profit", operatingProfit]]), `${detailPeriod ?? incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"}`);
  add("Accrual ratio", "(Profit after tax − Operating cash flow) ÷ Total assets", { profit_after_tax: pat, operating_cash_flow: ocf, total_assets: totalAssets }, pat !== null && ocf !== null ? safeDiv(pat - ocf, totalAssets) : null, need([["profit after tax", pat], ["operating cash flow", ocf], ["total assets", totalAssets]]), `${incomePeriod ?? "?"} / ${periodLabel(cash) ?? "?"} / ${balancePeriod ?? "?"}`);

  return out;
}

/** Compute and persist ratios for a ticker (service-role write). */
export async function refreshRatios(supabase: SupabaseClient, ticker: string): Promise<{ computed: number; available: number }> {
  const ratios = await computeRatios(supabase, ticker);
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && ratios.length) {
    const db = createAdminClient();
    await db.from("company_ratios").upsert(ratios, { onConflict: "ticker,ratio_name" });
  }
  return { computed: ratios.length, available: ratios.filter((r) => r.ratio_value !== null).length };
}
