import type { AiReportInsight, AiReportNarrative, CompanyReportOptions, ReportSource } from "./types";
import type { NormalizedFinancialPoint } from "./types";

type PortfolioSlice = {
  held: boolean;
  quantity?: number;
  avgCost?: number;
  currentPrice?: number | null;
  marketValue?: number | null;
  unrealizedPl?: number | null;
  unrealizedPlPct?: number | null;
  dividendIncome?: number | null;
  weight?: number | null;
  sectorWeight?: number | null;
  totalReturn?: number | null;
  yieldOnCost?: number | null;
};

function fmtNum(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function fmtPct(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

function portfolioCitation(sources: ReportSource[]): string {
  const match = sources.find((s) => /portfolio|holdings/i.test(s.label));
  return match?.id ?? "S1";
}

function financialCitation(sources: ReportSource[]): string {
  const match = sources.find((s) => /financial/i.test(s.label));
  return match?.id ?? "S1";
}

function buildPortfolioFallback(slice: PortfolioSlice, citation: string): AiReportInsight[] {
  if (!slice.held) return [];
  const insights: AiReportInsight[] = [
    {
      text: `Position: ${slice.quantity ?? "n/a"} shares at average cost PKR ${fmtNum(slice.avgCost)}; portfolio weight ${fmtPct(slice.weight)}.`,
      citations: [citation],
    },
  ];
  if (slice.marketValue != null || slice.unrealizedPl != null) {
    insights.push({
      text: `Market value PKR ${fmtNum(slice.marketValue, 0)}; unrealized P/L PKR ${fmtNum(slice.unrealizedPl, 0)} (${fmtPct(slice.unrealizedPlPct)}).`,
      citations: [citation],
    });
  }
  if (slice.dividendIncome != null || slice.yieldOnCost != null) {
    insights.push({
      text: `Dividend income PKR ${fmtNum(slice.dividendIncome, 0)}; yield on cost ${fmtPct(slice.yieldOnCost)}; total return incl. dividends ${fmtPct(slice.totalReturn)}.`,
      citations: [citation],
    });
  }
  if (slice.sectorWeight != null) {
    insights.push({
      text: `Sector allocation weight ${fmtPct(slice.sectorWeight)} of portfolio.`,
      citations: [citation],
    });
  }
  return insights.slice(0, 4);
}

function buildFinancialFallback(
  points: NormalizedFinancialPoint[],
  displayUnit: string,
  citation: string
): AiReportInsight[] {
  if (!points.length) return [];
  const annual = points.filter((p) => p.periodKind === "annual");
  const latest = annual[annual.length - 1] ?? points[points.length - 1];
  const prior = annual.length >= 2 ? annual[annual.length - 2] : null;
  const insights: AiReportInsight[] = [];

  if (latest.revenue != null) {
    insights.push({
      text: `${latest.periodLabel} revenue was ${latest.revenue.toLocaleString("en-US")} ${displayUnit} per sourced filings.`,
      citations: [citation],
    });
  }
  if (latest.profitAfterTax != null) {
    insights.push({
      text: `${latest.periodLabel} profit after tax was ${latest.profitAfterTax.toLocaleString("en-US")} ${displayUnit}.`,
      citations: [citation],
    });
  }
  if (latest.eps != null) {
    insights.push({
      text: `${latest.periodLabel} EPS was PKR ${fmtNum(latest.eps)}.`,
      citations: [citation],
    });
  }
  if (prior?.revenue != null && latest.revenue != null && prior.revenue > 0) {
    const growth = ((latest.revenue - prior.revenue) / prior.revenue) * 100;
    insights.push({
      text: `Revenue changed ${growth.toFixed(1)}% from ${prior.periodLabel} to ${latest.periodLabel}.`,
      citations: [citation],
    });
  }
  return insights.slice(0, 4);
}

/** Fill structural sections from sourced evidence when the AI returns empty arrays. */
export function enrichNarrativeFromEvidence(
  narrative: AiReportNarrative,
  options: CompanyReportOptions,
  ctx: {
    portfolioSlice: PortfolioSlice;
    financialPoints: NormalizedFinancialPoint[];
    displayUnit: string;
    sources: ReportSource[];
  }
): AiReportNarrative {
  const out = { ...narrative };

  if (options.include.portfolio && ctx.portfolioSlice.held && out.portfolio.length === 0) {
    out.portfolio = buildPortfolioFallback(ctx.portfolioSlice, portfolioCitation(ctx.sources));
  }

  if (options.include.financials && out.financialPerformance.length === 0 && ctx.financialPoints.length > 0) {
    out.financialPerformance = buildFinancialFallback(
      ctx.financialPoints,
      ctx.displayUnit,
      financialCitation(ctx.sources)
    );
  }

  return out;
}
