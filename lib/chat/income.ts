import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtCompact } from "@/lib/market/format";
import type { HoldingsSummary } from "@/lib/chat/data";

/**
 * Portfolio-level dividend income for the Research Copilot. For each holding it
 * computes trailing-12-month cash income (shares held x TTM cash DPS), then the
 * whole-book yield on cost and yield on market and each name's share of total
 * income. All pre-computed from the market-wide company_payouts feed so the model
 * narrates concrete income figures ("FFC throws off 62% of your dividend income,
 * a 14% yield on cost") instead of vague commentary. TTM is a trailing proxy for
 * forward income, labelled as such so nothing reads as a forecast.
 */

export interface DividendIncomeRow {
  ticker: string;
  quantity: number;
  ttmDps: number;
  annualIncome: number;
  yieldOnCostPct: number | null;
  yieldOnMarketPct: number | null;
  incomeSharePct: number;
}

export interface DividendIncome {
  rows: DividendIncomeRow[]; // payers only, largest income first
  payerCount: number;
  nonPayerCount: number;
  totalAnnualIncome: number;
  totalCost: number;
  totalValue: number | null;
  portfolioYieldOnCostPct: number | null;
  portfolioYieldOnMarketPct: number | null;
}

export async function getDividendIncome(
  supabase: SupabaseClient,
  holdings: HoldingsSummary
): Promise<DividendIncome | null> {
  const tickers = holdings.holdings.map((h) => h.ticker.toUpperCase());
  if (tickers.length === 0) return null;

  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("company_payouts")
    .select("ticker, dividend_per_share, announcement_date")
    .in("ticker", tickers)
    .eq("kind", "cash")
    .gte("announcement_date", cutoff);

  // Sum trailing-12-month cash DPS per ticker.
  const ttmByTicker = new Map<string, number>();
  for (const row of data ?? []) {
    const dps = Number(row.dividend_per_share);
    if (!Number.isFinite(dps) || dps <= 0) continue;
    const t = (row.ticker as string).toUpperCase();
    ttmByTicker.set(t, (ttmByTicker.get(t) ?? 0) + dps);
  }
  if (ttmByTicker.size === 0) return null;

  let totalAnnualIncome = 0;
  let totalCost = 0;
  let totalValue = 0;
  let anyPriced = false;
  let payerCount = 0;
  let nonPayerCount = 0;

  interface Draft extends Omit<DividendIncomeRow, "incomeSharePct"> {
    cost: number;
  }
  const drafts: Draft[] = [];

  for (const h of holdings.holdings) {
    const ticker = h.ticker.toUpperCase();
    const cost = h.avgCost * h.quantity;
    totalCost += cost;
    if (h.marketValue != null) {
      totalValue += h.marketValue;
      anyPriced = true;
    }
    const ttmDps = ttmByTicker.get(ticker);
    if (!ttmDps) {
      nonPayerCount++;
      continue;
    }
    payerCount++;
    const annualIncome = ttmDps * h.quantity;
    totalAnnualIncome += annualIncome;
    drafts.push({
      ticker,
      quantity: h.quantity,
      ttmDps,
      annualIncome,
      yieldOnCostPct: cost > 0 ? (annualIncome / cost) * 100 : null,
      yieldOnMarketPct: h.marketValue != null && h.marketValue > 0 ? (annualIncome / h.marketValue) * 100 : null,
      cost,
    });
  }

  if (drafts.length === 0 || totalAnnualIncome <= 0) return null;

  const rows: DividendIncomeRow[] = drafts
    .sort((a, b) => b.annualIncome - a.annualIncome)
    .map(({ cost, ...r }) => {
      void cost;
      return { ...r, incomeSharePct: (r.annualIncome / totalAnnualIncome) * 100 };
    });

  return {
    rows,
    payerCount,
    nonPayerCount,
    totalAnnualIncome,
    totalCost,
    totalValue: anyPriced ? totalValue : null,
    portfolioYieldOnCostPct: totalCost > 0 ? (totalAnnualIncome / totalCost) * 100 : null,
    portfolioYieldOnMarketPct: anyPriced && totalValue > 0 ? (totalAnnualIncome / totalValue) * 100 : null,
  };
}

/** Render dividend income as a headline line plus a per-holding table. */
export function briefFromDividendIncome(income: DividendIncome): string {
  const out: string[] = [`## Dividend income (trailing 12-month cash, pre-computed; do not recompute)`];

  const yoc = income.portfolioYieldOnCostPct;
  const yom = income.portfolioYieldOnMarketPct;
  out.push(
    `Expected annual income about ${fmtCompact(income.totalAnnualIncome)} PKR from ${income.payerCount} payer${income.payerCount === 1 ? "" : "s"}${income.nonPayerCount ? ` (${income.nonPayerCount} holding${income.nonPayerCount === 1 ? " pays" : "s pay"} no cash dividend)` : ""}; yield on cost ${yoc != null ? `${yoc.toFixed(1)}%` : "n/a"}${yom != null ? `, yield on market ${yom.toFixed(1)}%` : ""}. TTM is a trailing proxy for forward income, not a guarantee.`
  );

  const rows = income.rows
    .map(
      (r) =>
        `| ${r.ticker} | ${r.ttmDps.toFixed(2)} | ${fmtCompact(r.annualIncome)} | ${r.yieldOnCostPct != null ? `${r.yieldOnCostPct.toFixed(1)}%` : "n/a"} | ${r.yieldOnMarketPct != null ? `${r.yieldOnMarketPct.toFixed(1)}%` : "n/a"} | ${r.incomeSharePct.toFixed(0)}% |`
    )
    .join("\n");
  out.push(
    `| Ticker | TTM DPS | Annual income | Yield on cost | Yield on market | Share of income |\n|---|---|---|---|---|---|\n${rows}`
  );

  return out.join("\n\n");
}
