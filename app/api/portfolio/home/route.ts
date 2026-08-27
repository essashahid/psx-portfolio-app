import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { getPerformanceAnalytics } from "@/lib/engine/performance";
import { fillFromSnapshot, retotal, snapshotByTicker } from "@/lib/portfolio/snapshot-fallback";
import { sectorColor } from "@psx/shared/sector-colors";
import type {
  HomeContributor,
  HomeResponse,
  HomeSectorSlice,
} from "@psx/shared/api/home";

/**
 * Everything the mobile home screen draws, in one request.
 *
 * All three reads reuse the functions the web pages already call, so the
 * portfolio maths has exactly one implementation. The timeline is the only
 * expensive part; it comes from the ledger analytics, which is also what the
 * performance screen reads.
 */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const [portfolio, daily, analytics] = await Promise.all([
      getPortfolio(supabase, user.id),
      getDailyHoldingPerformance(supabase, user.id),
      // A missing ledger is normal for a new account and only costs the curve.
      getPerformanceAnalytics(supabase, user.id).catch(() => null),
    ]);

    // Positions the per-user prices table has not caught up with are priced
    // from the market snapshot, so the day move and the unrealised figure agree
    // instead of one reporting a loss while the other says prices are missing.
    const dayByTicker = snapshotByTicker(daily);
    const positions = portfolio.holdings.map((h) => ({
      ticker: h.ticker,
      sector: h.sector,
      totalCost: h.total_cost === null ? null : Number(h.total_cost),
      ...fillFromSnapshot(
        {
          latestPrice: h.latest_price,
          priceDate: h.price_date,
          marketValue: h.market_value,
          unrealizedPl: h.unrealized_pl,
          unrealizedPlPct: h.unrealized_pl_pct,
        },
        Number(h.quantity),
        h.total_cost === null ? null : Number(h.total_cost),
        dayByTicker.get(h.ticker),
        daily.asOf
      ),
    }));
    const totals = retotal(positions);
    const pricedCount = positions.filter((p) => p.latestPrice !== null).length;

    /**
     * Sector weights and the largest position are rebuilt on the same basis as
     * the header figure. portfolio.sectorWeights was computed before the
     * snapshot prices were filled in, so reusing it would show a 607k book
     * split into sector slices that add up to 396k.
     */
    const size = (p: (typeof positions)[number]) => p.marketValue ?? p.totalCost ?? 0;
    const weightBase = positions.reduce((sum, p) => sum + size(p), 0);
    const pct = (value: number) => (weightBase > 0 ? (value / weightBase) * 100 : 0);

    const bySector = new Map<string, number>();
    for (const p of positions) {
      const key = p.sector ?? "Unclassified";
      bySector.set(key, (bySector.get(key) ?? 0) + size(p));
    }
    const sectors: HomeSectorSlice[] = [...bySector.entries()]
      .map(([sector, value]) => ({
        sector,
        value,
        weightPct: pct(value),
        color: sectorColor(sector),
      }))
      .sort((a, b) => b.weightPct - a.weightPct);

    const largestPosition = positions.reduce<(typeof positions)[number] | null>(
      (best, p) => (best === null || size(p) > size(best) ? p : best),
      null
    );

    const contributors: HomeContributor[] = daily.rows
      .filter((row) => row.dayPnl !== null && row.dayPnl !== 0)
      .sort((a, b) => Math.abs(b.dayPnl ?? 0) - Math.abs(a.dayPnl ?? 0))
      .slice(0, 5)
      .map((row) => ({
        ticker: row.ticker,
        companyName: row.companyName,
        sector: row.sector,
        color: sectorColor(row.sector),
        dayPnl: row.dayPnl,
        dayChangePct: row.dayChangePct,
      }));

    const body: HomeResponse = {
      totalValue: totals.totalValue,
      totalCost: totals.totalCost,
      unrealizedPl: totals.unrealizedPl ?? 0,
      unrealizedPlPct: totals.unrealizedPlPct,
      holdingsCount: portfolio.holdingsCount,
      dividendIncome: portfolio.dividendIncome,
      totalDayPnl: daily.totalDayPnl,
      dayChangePct: daily.weightedDayChangePct,
      asOf: daily.snapshotTime ?? daily.asOf,
      // Say so rather than presenting cost as though it were market value.
      atCost: pricedCount === 0 && portfolio.holdingsCount > 0,
      largest: largestPosition
        ? { ticker: largestPosition.ticker, weightPct: pct(size(largestPosition)) }
        : null,
      sectors,
      contributors,
      timeline:
        analytics?.timeline
          .filter((point): point is typeof point & { netWorth: number } => point.netWorth !== null)
          .map((point) => ({ date: point.date, netWorth: point.netWorth })) ?? [],
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
