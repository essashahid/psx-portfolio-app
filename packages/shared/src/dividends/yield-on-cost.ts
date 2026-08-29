/**
 * What each holding actually pays you, against what you paid for it.
 *
 * Yield on cost is the number that matters to someone who has held for years:
 * a stock bought at 150 that now pays 12 yields 8% to you whatever the screen
 * says today. Yield on current value is the number a buyer today would get.
 * Both are shown because they answer different questions, and on an old
 * position they diverge a long way.
 */

export interface YieldOnCostInput {
  ticker: string;
  companyName: string | null;
  totalCost: number | null;
  marketValue: number | null;
}

export interface YieldOnCostRow {
  ticker: string;
  companyName: string | null;
  /** Dividends received in the last twelve months, after tax. */
  ttmNet: number;
  cost: number;
  yieldOnCost: number | null;
  yieldOnValue: number | null;
}

/**
 * @param asOf The day the trailing year is measured back from, YYYY-MM-DD.
 */
export function buildYieldOnCost(
  holdings: YieldOnCostInput[],
  payments: { ticker: string | null; status: string; date: string | null; net: number }[],
  asOf: string
): YieldOnCostRow[] {
  const cutoff = new Date(`${asOf}T12:00:00`);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const ttm = new Map<string, number>();
  for (const payment of payments) {
    // Only cash actually received counts: an announced payout has not paid you
    // anything yet, and counting it would flatter every yield on the screen.
    if (payment.status !== "received" || !payment.ticker || !payment.date) continue;
    if (payment.date < cutoffKey) continue;
    ttm.set(payment.ticker, (ttm.get(payment.ticker) ?? 0) + payment.net);
  }

  return holdings
    .map((holding) => {
      const ttmNet = ttm.get(holding.ticker) ?? 0;
      const cost = holding.totalCost ?? 0;
      return {
        ticker: holding.ticker,
        companyName: holding.companyName,
        ttmNet,
        cost,
        yieldOnCost: cost > 0 ? (ttmNet / cost) * 100 : null,
        yieldOnValue:
          holding.marketValue && holding.marketValue > 0
            ? (ttmNet / holding.marketValue) * 100
            : null,
      };
    })
    .filter((row) => row.ttmNet > 0)
    .sort((a, b) => (b.yieldOnCost ?? -1) - (a.yieldOnCost ?? -1));
}
