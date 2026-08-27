import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getPerformanceAnalytics } from "@/lib/engine/performance";
import type { PerformanceResponse } from "@psx/shared/api/performance";

/**
 * Headline performance for the mobile Portfolio tab.
 *
 * getPerformanceAnalytics() is the same function the web performance page
 * calls, so XIRR and friction are computed once, in one place. Only the
 * headline fields are forwarded: see the note on PerformanceResponse.
 */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const analytics = await getPerformanceAnalytics(supabase, user.id);

    if (!analytics) {
      const empty: PerformanceResponse = {
        returns: null,
        friction: null,
        concentration: null,
        timeline: [],
        source: null,
      };
      return NextResponse.json(empty);
    }

    const { returns, friction, concentration, timeline, source } = analytics;

    const body: PerformanceResponse = {
      returns: {
        totalDeposited: returns.totalDeposited,
        netWorth: returns.netWorth,
        marketValue: returns.marketValue,
        cashBalance: returns.cashBalance,
        totalGain: returns.totalGain,
        totalReturnPct: returns.totalReturnPct,
        xirrPct: returns.xirrPct,
        xirrStatus: returns.xirrStatus,
        xirrFailureReason: returns.xirrFailureReason,
        holdingPeriodYears: returns.holdingPeriodYears,
        realizedPl: returns.realizedPl,
        unrealizedPl: returns.unrealizedPl,
        startDate: returns.startDate,
        endDate: returns.endDate,
      },
      friction: {
        total: friction.total,
        tradeFeesTotal: friction.tradeFeesTotal,
        cgt: friction.cgt,
        accountFees: friction.accountFees,
        pctOfDeposits: friction.pctOfDeposits,
        pctOfGains: friction.pctOfGains,
      },
      concentration: {
        topHolding: concentration.topHolding,
        hhi: concentration.hhi,
        // Largest first, and only the ones worth reading on a phone.
        sectorWeights: [...concentration.sectorWeights]
          .sort((a, b) => b.weightPct - a.weightPct)
          .slice(0, 8),
        positionsBelow1pct: concentration.positionsBelow1pct,
      },
      timeline: timeline
        .filter((point): point is typeof point & { netWorth: number } => point.netWorth !== null)
        .map((point) => ({ date: point.date, netWorth: point.netWorth })),
      source,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
