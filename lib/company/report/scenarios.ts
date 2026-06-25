import type { ScenarioCase } from "./types";
import type { RatioRow } from "@/lib/engine/ratios";

export function buildScenarioAnalysis(
  ticker: string,
  latestEps: number | null,
  latestRevenue: number | null,
  grossMargin: number | null,
  pe: number | null,
  peerMedianPe: number | null
): ScenarioCase[] {
  const baseEps = latestEps;
  const basePe = pe ?? peerMedianPe ?? null;
  const baseMargin = grossMargin;

  const bear: ScenarioCase = {
    label: "bear",
    assumptions: {
      volumeGrowth: "-8%",
      retentionPriceChange: "-5%",
      grossMargin: baseMargin !== null ? `${(baseMargin - 3).toFixed(1)}%` : "compressed 3pp",
      energyCost: "+12%",
      valuationMultiple: basePe !== null ? `${(basePe * 0.85).toFixed(1)}x P/E` : "15% discount to base",
    },
    impliedEps: baseEps !== null ? baseEps * 0.82 : null,
    impliedValuationMultiple: basePe !== null ? basePe * 0.85 : null,
    notes: "Bear case assumes weaker construction demand and higher energy costs.",
  };

  const base: ScenarioCase = {
    label: "base",
    assumptions: {
      volumeGrowth: "+3%",
      retentionPriceChange: "+2%",
      grossMargin: baseMargin !== null ? `${baseMargin.toFixed(1)}%` : "stable",
      energyCost: "flat",
      valuationMultiple: basePe !== null ? `${basePe.toFixed(1)}x P/E` : "current trailing multiple",
    },
    impliedEps: baseEps,
    impliedValuationMultiple: basePe,
    notes: "Base case holds recent operating trends and current market valuation.",
  };

  const bull: ScenarioCase = {
    label: "bull",
    assumptions: {
      volumeGrowth: "+10%",
      retentionPriceChange: "+6%",
      grossMargin: baseMargin !== null ? `${(baseMargin + 2).toFixed(1)}%` : "expanded 2pp",
      energyCost: "-5%",
      valuationMultiple: basePe !== null ? `${(basePe * 1.12).toFixed(1)}x P/E` : "12% premium to base",
    },
    impliedEps: baseEps !== null ? baseEps * 1.15 : null,
    impliedValuationMultiple: basePe !== null ? basePe * 1.12 : null,
    notes: "Bull case assumes stronger dispatch volumes and margin recovery.",
  };

  return [bear, base, bull];
}

export function extractGrossMargin(ratios: RatioRow[]): number | null {
  const row = ratios.find((r) => r.ratio_name === "Gross margin");
  return row?.ratio_value ?? null;
}

export function extractPe(ratios: RatioRow[]): number | null {
  const row = ratios.find((r) => r.ratio_name === "P/E");
  return row?.ratio_value ?? null;
}

export function latestAnnualEps(points: { eps: number | null; periodKind: string }[]): number | null {
  const annual = points.filter((p) => p.periodKind === "annual" || p.periodKind === "cumulative");
  for (const p of annual.reverse()) {
    if (p.eps !== null) return p.eps;
  }
  return null;
}

export function latestAnnualRevenue(points: { revenue: number | null }[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].revenue !== null) return points[i].revenue;
  }
  return null;
}
