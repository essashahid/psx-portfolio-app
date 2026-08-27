import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { fillFromSnapshot, retotal, snapshotByTicker } from "@/lib/portfolio/snapshot-fallback";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import type { HoldingRow, HoldingsResponse } from "@psx/shared/api/holdings";

/**
 * Positions with today's move, for the mobile Portfolio tab.
 *
 * The web page calls getPortfolio() and getDailyHoldingPerformance() directly
 * and joins them in the component. This does the same join server side so the
 * phone makes one request, and reuses both functions rather than growing a
 * second implementation of the position maths.
 */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const [portfolio, daily] = await Promise.all([
      getPortfolio(supabase, user.id),
      getDailyHoldingPerformance(supabase, user.id),
    ]);

    const dayByTicker = snapshotByTicker(daily);

    const rows: HoldingRow[] = portfolio.holdings.map((h) => {
      const day = dayByTicker.get(h.ticker);
      const quantity = Number(h.quantity);
      const totalCost = h.total_cost === null ? null : Number(h.total_cost);
      const priced = fillFromSnapshot(
        {
          latestPrice: h.latest_price,
          priceDate: h.price_date,
          marketValue: h.market_value,
          unrealizedPl: h.unrealized_pl,
          unrealizedPlPct: h.unrealized_pl_pct,
        },
        quantity,
        totalCost,
        day,
        daily.asOf
      );
      return {
        ticker: h.ticker,
        companyName: h.company_name,
        sector: h.sector,
        quantity,
        avgCost: h.avg_cost === null ? null : Number(h.avg_cost),
        totalCost,
        ...priced,
        weight: h.weight,
        dayChangePct: day?.dayChangePct ?? null,
        dayPnl: day?.dayPnl ?? null,
        dividendIncome: h.dividend_income,
        color: sectorColor(h.sector),
      };
    });

    // Weights follow the same basis as the values above them. getPortfolio
    // computed them before the snapshot prices were filled in, so leaving them
    // alone would print a position at 211k of a 607k book and call it 25%.
    const weightBase = rows.reduce((sum, row) => sum + (row.marketValue ?? row.totalCost ?? 0), 0);
    for (const row of rows) {
      const size = row.marketValue ?? row.totalCost ?? 0;
      row.weight = weightBase > 0 ? (size / weightBase) * 100 : 0;
    }

    // Largest position first: on a small screen the top of the list is the
    // part that gets read, so it should carry the most money. Positions with no
    // live price fall back to cost, otherwise an unpriced book sorts as though
    // every holding were worth nothing and the order means nothing.
    const size = (row: HoldingRow) => row.marketValue ?? row.totalCost ?? 0;
    rows.sort((a, b) => size(b) - size(a));

    // One entry per sector held, so the filter rail is built from what the
    // book actually contains rather than the whole PSX taxonomy.
    const bySector = new Map<string, number>();
    for (const row of rows) {
      const key = row.sector ?? "Unclassified";
      bySector.set(key, (bySector.get(key) ?? 0) + 1);
    }
    const sectorFilters = [...bySector.entries()]
      .map(([sector, count]) => ({
        sector,
        label: shortSector(sector),
        color: sectorColor(sector),
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const priced = rows.filter((row) => row.unrealizedPl !== null);

    // Totals are recomputed rather than taken from getPortfolio, which did not
    // see the snapshot prices filled in above.
    const totals = retotal(rows);

    const body: HoldingsResponse = {
      rows,
      totalValue: totals.totalValue,
      totalCost: totals.totalCost,
      // The contract keeps this a number; the screen decides what to print from
      // pricedCount, which is the honest signal for "nothing is priced".
      unrealizedPl: totals.unrealizedPl ?? 0,
      unrealizedPlPct: totals.unrealizedPlPct,
      asOf: daily.asOf,
      totalDayPnl: daily.totalDayPnl,
      dayChangePct: daily.weightedDayChangePct,
      pricedCount: rows.filter((row) => row.latestPrice !== null).length,
      count: rows.length,
      belowCostCount: priced.length > 0 ? priced.filter((row) => (row.unrealizedPl ?? 0) < 0).length : null,
      sectorFilters,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
