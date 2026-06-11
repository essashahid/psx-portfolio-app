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
      .select("period_type, fiscal_year, fiscal_period, statement_type, reported_date, source_url, confidence, data")
      .eq("ticker", t)
      .order("reported_date", { ascending: false })
      .limit(30),
    supabase.from("market_quotes").select("price, as_of").eq("ticker", t).maybeSingle(),
    supabase
      .from("dividends")
      .select("dividend_per_share, announcement_date, ex_date")
      .eq("ticker", t)
      .order("announcement_date", { ascending: false })
      .limit(20),
  ]);

  const rows = (finRows ?? []) as FinRow[];
  // Prefer the latest full-year income statement for valuation/margin ratios so
  // a single interim quarter never distorts P/E or annualized figures. Fall
  // back to the latest available statement when no annual is stored.
  const annualRows = rows.filter((r) => r.period_type === "annual");
  const income = latest(annualRows, "income_statement") ?? latest(rows, "income_statement");
  const prevIncome = previous(income?.period_type === "annual" ? annualRows : rows, income);
  const balance = latest(rows, "balance_sheet");
  const cash = latest(rows, "cash_flow");

  const price = quote?.price != null && Number(quote.price) > 0 ? Number(quote.price) : null;

  // Trailing-12-month cash dividend per share from recorded dividends.
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const ttmDps =
    (divRows ?? [])
      .filter((d) => d.dividend_per_share && (d.announcement_date ?? d.ex_date ?? "") >= cutoff)
      .reduce((s, d) => s + Number(d.dividend_per_share), 0) || null;

  const eps = numOf(income?.data, "eps");
  const revenue = numOf(income?.data, "revenue");
  const grossProfit = numOf(income?.data, "gross_profit");
  const operatingProfit = numOf(income?.data, "operating_profit");
  const pat = numOf(income?.data, "profit_after_tax");
  const pbt = numOf(income?.data, "profit_before_tax");
  const financeCost = numOf(income?.data, "finance_cost");
  const equity = numOf(balance?.data, "equity");
  const totalAssets = numOf(balance?.data, "total_assets");
  const currentAssets = numOf(balance?.data, "current_assets");
  const currentLiabilities = numOf(balance?.data, "current_liabilities");
  const inventory = numOf(balance?.data, "inventory");
  const borrowings = numOf(balance?.data, "borrowings");
  const ocf = numOf(cash?.data, "operating_cash_flow");
  const capex = numOf(cash?.data, "capex");

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

  // Valuation
  add("P/E", "Price ÷ EPS", { price, eps }, price !== null && eps ? price / eps : null, need([["price", price], ["EPS", eps]]) ?? (eps === 0 ? "EPS is zero." : null), incomePeriod);
  add("Earnings yield", "EPS ÷ Price", { price, eps }, price && eps !== null ? (eps / price) * 100 : null, need([["price", price], ["EPS", eps]]), incomePeriod);
  add("Dividend yield (TTM)", "Trailing 12m cash DPS ÷ Price", { price, ttm_dps: ttmDps }, price && ttmDps ? (ttmDps / price) * 100 : null, need([["price", price], ["trailing dividends", ttmDps]]), "Last 12 months");
  add("Payout ratio", "TTM DPS ÷ EPS", { ttm_dps: ttmDps, eps }, ttmDps && eps ? (ttmDps / eps) * 100 : null, need([["trailing dividends", ttmDps], ["EPS", eps]]), incomePeriod);
  add("Dividend cover", "EPS ÷ TTM DPS", { eps, ttm_dps: ttmDps }, eps && ttmDps ? eps / ttmDps : null, need([["EPS", eps], ["trailing dividends", ttmDps]]), incomePeriod);

  // Profitability (statement-internal — units cancel)
  add("Gross margin", "Gross profit ÷ Revenue", { gross_profit: grossProfit, revenue }, grossProfit !== null && revenue ? (grossProfit / revenue) * 100 : null, need([["gross profit", grossProfit], ["revenue", revenue]]), incomePeriod);
  add("Operating margin", "Operating profit ÷ Revenue", { operating_profit: operatingProfit, revenue }, operatingProfit !== null && revenue ? (operatingProfit / revenue) * 100 : null, need([["operating profit", operatingProfit], ["revenue", revenue]]), incomePeriod);
  add("Net margin", "Profit after tax ÷ Revenue", { profit_after_tax: pat, revenue }, pat !== null && revenue ? (pat / revenue) * 100 : null, need([["profit after tax", pat], ["revenue", revenue]]), incomePeriod);
  add("ROE", "Profit after tax ÷ Equity", { profit_after_tax: pat, equity }, pat !== null && equity ? (pat / equity) * 100 : null, need([["profit after tax", pat], ["equity", equity]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);
  add("ROA", "Profit after tax ÷ Total assets", { profit_after_tax: pat, total_assets: totalAssets }, pat !== null && totalAssets ? (pat / totalAssets) * 100 : null, need([["profit after tax", pat], ["total assets", totalAssets]]), `${incomePeriod ?? "?"} / ${balancePeriod ?? "?"}`);

  // Leverage & liquidity
  add("Debt-to-equity", "Borrowings ÷ Equity", { borrowings, equity }, borrowings !== null && equity ? borrowings / equity : null, need([["borrowings", borrowings], ["equity", equity]]), balancePeriod);
  add("Current ratio", "Current assets ÷ Current liabilities", { current_assets: currentAssets, current_liabilities: currentLiabilities }, currentAssets !== null && currentLiabilities ? currentAssets / currentLiabilities : null, need([["current assets", currentAssets], ["current liabilities", currentLiabilities]]), balancePeriod);
  add("Quick ratio", "(Current assets − Inventory) ÷ Current liabilities", { current_assets: currentAssets, inventory, current_liabilities: currentLiabilities }, currentAssets !== null && inventory !== null && currentLiabilities ? (currentAssets - inventory) / currentLiabilities : null, need([["current assets", currentAssets], ["inventory", inventory], ["current liabilities", currentLiabilities]]), balancePeriod);
  add("Interest coverage", "(Profit before tax + Finance cost) ÷ Finance cost", { profit_before_tax: pbt, finance_cost: financeCost }, pbt !== null && financeCost ? (pbt + financeCost) / financeCost : null, need([["profit before tax", pbt], ["finance cost", financeCost]]), incomePeriod);

  // Growth (vs previous extracted period of the same kind)
  const prevRevenue = numOf(prevIncome?.data, "revenue");
  const prevPat = numOf(prevIncome?.data, "profit_after_tax");
  const prevEps = numOf(prevIncome?.data, "eps");
  const growthPeriod = income && prevIncome ? `${periodLabel(income)} vs ${periodLabel(prevIncome)}` : incomePeriod;
  add("Revenue growth", "(Revenue − Prior revenue) ÷ Prior revenue", { revenue, prior_revenue: prevRevenue }, revenue !== null && prevRevenue ? ((revenue - prevRevenue) / Math.abs(prevRevenue)) * 100 : null, need([["revenue", revenue], ["prior-period revenue", prevRevenue]]), growthPeriod);
  add("Profit growth", "(PAT − Prior PAT) ÷ |Prior PAT|", { profit_after_tax: pat, prior_pat: prevPat }, pat !== null && prevPat ? ((pat - prevPat) / Math.abs(prevPat)) * 100 : null, need([["profit after tax", pat], ["prior-period profit", prevPat]]), growthPeriod);
  add("EPS growth", "(EPS − Prior EPS) ÷ |Prior EPS|", { eps, prior_eps: prevEps }, eps !== null && prevEps ? ((eps - prevEps) / Math.abs(prevEps)) * 100 : null, need([["EPS", eps], ["prior-period EPS", prevEps]]), growthPeriod);

  // Cash flow
  add("FCF (OCF − Capex)", "Operating cash flow − Capex", { operating_cash_flow: ocf, capex }, ocf !== null && capex !== null ? ocf - Math.abs(capex) : null, need([["operating cash flow", ocf], ["capex", capex]]), periodLabel(cash));

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
