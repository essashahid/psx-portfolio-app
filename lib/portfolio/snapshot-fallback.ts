import type { DailyHoldingPerformance } from "@/lib/portfolio/daily-performance";

/**
 * Fills in a position's price from the market snapshot when the per-user
 * prices table has nothing for it yet.
 *
 * getPortfolio() reads `prices`, which the daily cron writes per user. A
 * position added between two cron runs therefore has no price, while
 * getDailyHoldingPerformance() already knows what the stock is trading at from
 * the shared market snapshot. Without this the screen contradicts itself: it
 * prints today's rupee move and "awaiting prices" side by side, and a new
 * account shows nothing but cost for up to a day.
 *
 * Only the price is borrowed. Cost basis, quantity and everything derived from
 * the ledger stay exactly as the position layer computed them.
 */
export interface PricedPosition {
  latestPrice: number | null;
  priceDate: string | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
}

export function fillFromSnapshot(
  position: PricedPosition,
  quantity: number,
  totalCost: number | null,
  day: { price: number | null } | undefined,
  asOf: string | null
): PricedPosition {
  if (position.latestPrice !== null || !day?.price || !Number.isFinite(quantity)) return position;

  const marketValue = day.price * quantity;
  const cost = totalCost ?? null;
  const unrealizedPl = cost === null ? null : marketValue - cost;
  return {
    latestPrice: day.price,
    priceDate: asOf,
    marketValue,
    unrealizedPl,
    unrealizedPlPct: unrealizedPl === null || !cost ? null : (unrealizedPl / cost) * 100,
  };
}

/** The totals that follow once some positions have been priced this way. */
export function retotal(
  rows: { marketValue: number | null; totalCost: number | null; unrealizedPl: number | null }[]
): { totalValue: number; totalCost: number; unrealizedPl: number | null; unrealizedPlPct: number | null } {
  let totalValue = 0;
  let totalCost = 0;
  let pricedCost = 0;
  let unrealized = 0;
  let anyPriced = false;
  for (const row of rows) {
    const cost = row.totalCost ?? 0;
    totalCost += cost;
    totalValue += row.marketValue ?? cost;
    if (row.unrealizedPl !== null) {
      anyPriced = true;
      unrealized += row.unrealizedPl;
      pricedCost += cost;
    }
  }
  return {
    totalValue,
    totalCost,
    unrealizedPl: anyPriced ? unrealized : null,
    unrealizedPlPct: anyPriced && pricedCost > 0 ? (unrealized / pricedCost) * 100 : null,
  };
}

/** A ticker-keyed view of the snapshot rows, for the fill above. */
export function snapshotByTicker(daily: DailyHoldingPerformance) {
  return new Map(daily.rows.map((row) => [row.ticker, row]));
}
