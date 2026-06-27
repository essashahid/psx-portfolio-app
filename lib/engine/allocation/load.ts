import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMonthlyReturns } from "./data";
import { tbillYieldOn } from "@/lib/market-data/macro-assets";
import { getPerformanceAnalytics } from "@/lib/engine/performance";
import type { Allocation } from "./types";
import type { BuildForecastInput } from "./index";

/**
 * Assemble everything buildForecast needs from the database: the aligned return
 * matrix, the live signal inputs, and the user's current portfolio mix and
 * investable cash for personalisation. Pure orchestration, no math.
 */
export async function gatherForecastInputs(
  supabase: SupabaseClient,
  userId: string
): Promise<BuildForecastInput> {
  const loaded = await loadMonthlyReturns(supabase);

  // Foreign-flow demand bias: sign of recent net FIPI flow, if the feed exists.
  let foreignFlowBias: number | null = null;
  try {
    const { data: flows } = await supabase
      .from("foreign_flow_days")
      .select("fipi_net")
      .order("flow_date", { ascending: false })
      .limit(20);
    if (flows && flows.length) {
      const net = flows.reduce((s, r) => s + (Number(r.fipi_net) || 0), 0);
      if (net !== 0) foreignFlowBias = Math.tanh(net / 50); // ~USD 50m normalises to ~0.76
    }
  } catch {
    foreignFlowBias = null;
  }

  // Current portfolio: equity = held PSX market value, cash = broker cash.
  // Gold and BTC are not custodied on the platform, so they start at zero.
  let current: Allocation | null = null;
  let portfolioValuePkr: number | undefined;
  let investableCashPkr: number | undefined;
  try {
    const analytics = await getPerformanceAnalytics(supabase, userId);
    if (analytics) {
      const equityValue = Math.max(0, analytics.returns.marketValue);
      const cash = Math.max(0, analytics.returns.cashBalance);
      const total = equityValue + cash;
      if (total > 0) {
        current = {
          equity: equityValue / total,
          gold: 0,
          btc: 0,
          cash: cash / total,
        };
        portfolioValuePkr = total;
        investableCashPkr = cash;
      }
    }
  } catch {
    current = null;
  }

  return {
    series: loaded.series,
    signalInputs: {
      usdpkr: loaded.usdpkr,
      tbillYieldPct: tbillYieldOn(new Date().toISOString().slice(0, 10)),
      foreignFlowBias,
      newsCounts: null, // structured-event derivation from news is a follow-up wire-up
    },
    dataQuality: loaded.quality,
    monthsByAsset: loaded.monthsByAsset,
    assetFirstMonths: loaded.firstMonths,
    current,
    portfolioValuePkr,
    investableCashPkr,
  };
}
