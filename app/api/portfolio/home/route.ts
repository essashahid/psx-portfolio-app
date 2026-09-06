import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { getPerformanceAnalytics } from "@/lib/engine/performance";
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

    // Prices are resolved once, inside getPortfolio, through the same rule the
    // web dashboard and the company page use. Nothing is re-priced here.
    const pricedCount = portfolio.pricedHoldings;
    const sectors: HomeSectorSlice[] = portfolio.sectorWeights.map((s) => ({
      sector: s.sector,
      value: s.value,
      weightPct: s.weight,
      color: sectorColor(s.sector),
    }));
    const largestPosition = portfolio.largestHolding;

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
      totalValue: portfolio.totalValue,
      totalCost: portfolio.totalCost,
      unrealizedPl: portfolio.unrealizedPl,
      unrealizedPlPct: portfolio.unrealizedPlPct,
      holdingsCount: portfolio.holdingsCount,
      dividendIncome: portfolio.dividendIncome,
      totalDayPnl: daily.totalDayPnl,
      dayChangePct: daily.weightedDayChangePct,
      asOf: daily.snapshotTime ?? daily.asOf,
      // Say so rather than presenting cost as though it were market value.
      atCost: pricedCount === 0 && portfolio.holdingsCount > 0,
      largest: largestPosition
        ? { ticker: largestPosition.ticker, weightPct: largestPosition.weight ?? 0 }
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
