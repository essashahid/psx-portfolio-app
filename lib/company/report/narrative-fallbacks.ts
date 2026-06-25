import type { AiReportInsight, AiReportNarrative, CompanyReportOptions, ReportSource } from "./types";
import type { NormalizedFinancialPoint } from "./types";
import type { RatioRow } from "@/lib/engine/ratios";

interface PortfolioSlice {
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
  totalReturnAmount?: number | null;
  yieldOnCost?: number | null;
  realizedPl?: number | null;
  priceReturnPct?: number | null;
}

interface FilingItem {
  title: string;
  url: string;
  date: string | null;
  category: string;
}

interface TechnicalsMeta {
  latestPrice?: number | null;
  dayChangePct?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  volatility?: number | null;
  pricePerformance?: {
    oneMonthReturnPct?: number | null;
    threeMonthReturnPct?: number | null;
    ytdReturnPct?: number | null;
    oneYearReturnPct?: number | null;
    maxDrawdownPct?: number | null;
  } | null;
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function fmtPct(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

function fmtAmount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `PKR ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function portfolioCitation(sources: ReportSource[]): string {
  const match = sources.find((s) => /portfolio|holdings/i.test(s.label));
  return match?.id ?? "S1";
}

function financialCitation(sources: ReportSource[]): string {
  const match = sources.find((s) => /financial/i.test(s.label));
  return match?.id ?? "S1";
}

function filingCitation(sources: ReportSource[]): string {
  const match = sources.find((s) => /filing|disclosure/i.test(s.label));
  return match?.id ?? "S1";
}

function priceCitation(sources: ReportSource[]): string {
  const match = sources.find((s) => /price|quote|market/i.test(s.label));
  return match?.id ?? "S1";
}

function buildPortfolioFallback(slice: PortfolioSlice, citation: string): AiReportInsight[] {
  if (!slice.held) return [];
  const insights: AiReportInsight[] = [
    {
      text: `Position: ${slice.quantity ?? "n/a"} shares at average cost PKR ${fmtNum(slice.avgCost)}; current price PKR ${fmtNum(slice.currentPrice)}; portfolio weight ${fmtPct(slice.weight)}.`,
      citations: [citation],
    },
  ];
  if (slice.marketValue != null || slice.unrealizedPl != null) {
    insights.push({
      text: `Market value ${fmtAmount(slice.marketValue)}; unrealized P/L ${fmtAmount(slice.unrealizedPl)} (${fmtPct(slice.unrealizedPlPct)}); price return ${fmtPct(slice.priceReturnPct)}.`,
      citations: [citation],
    });
  }
  if (slice.dividendIncome != null && (slice.dividendIncome ?? 0) > 0) {
    insights.push({
      text: `Dividend income ${fmtAmount(slice.dividendIncome)}; yield on cost ${fmtPct(slice.yieldOnCost)}; total return including dividends ${fmtPct(slice.totalReturn)}.`,
      citations: [citation],
    });
  } else if (slice.totalReturn != null) {
    insights.push({
      text: `Total return ${fmtPct(slice.totalReturn)} (no dividends recorded for this position).`,
      citations: [citation],
    });
  }
  if (slice.sectorWeight != null) {
    insights.push({
      text: `Sector allocation weight ${fmtPct(slice.sectorWeight)} of portfolio.`,
      citations: [citation],
    });
  }
  return insights.slice(0, 5);
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
  if (prior?.profitAfterTax != null && latest.profitAfterTax != null && prior.profitAfterTax !== 0) {
    const growth = ((latest.profitAfterTax - prior.profitAfterTax) / Math.abs(prior.profitAfterTax)) * 100;
    insights.push({
      text: `PAT changed ${growth.toFixed(1)}% from ${prior.periodLabel} to ${latest.periodLabel}.`,
      citations: [citation],
    });
  }
  return insights.slice(0, 5);
}

function buildExecutiveSummaryFallback(
  companyName: string | null,
  sector: string | null,
  points: NormalizedFinancialPoint[],
  displayUnit: string,
  technicals: TechnicalsMeta | null,
  portfolioSlice: PortfolioSlice,
  sources: ReportSource[]
): AiReportInsight[] {
  const insights: AiReportInsight[] = [];
  const finCite = financialCitation(sources);
  const priceCite = priceCitation(sources);

  if (companyName && sector) {
    insights.push({
      text: `${companyName} is a PSX-listed ${sector.toLowerCase()} company. This report presents sourced financial analysis, valuation context and identified catalysts and risks.`,
      citations: [finCite],
    });
  }

  const annual = points.filter((p) => p.periodKind === "annual");
  if (annual.length >= 2) {
    const latest = annual[annual.length - 1];
    const prior = annual[annual.length - 2];
    if (latest.revenue && prior.revenue && prior.revenue > 0) {
      const revGrowth = ((latest.revenue - prior.revenue) / prior.revenue * 100).toFixed(1);
      insights.push({
        text: `Revenue grew ${revGrowth}% in ${latest.periodLabel} to ${latest.revenue.toLocaleString("en-US")} ${displayUnit}.`,
        citations: [finCite],
      });
    }
  }

  if (technicals?.pricePerformance?.oneYearReturnPct != null) {
    insights.push({
      text: `One-year price return was ${fmtPct(technicals.pricePerformance.oneYearReturnPct)} with maximum drawdown of ${fmtPct(technicals.pricePerformance.maxDrawdownPct)}.`,
      citations: [priceCite],
    });
  }

  if (portfolioSlice.held && portfolioSlice.quantity) {
    const portCite = portfolioCitation(sources);
    insights.push({
      text: `The user holds ${portfolioSlice.quantity} shares at an average cost of PKR ${fmtNum(portfolioSlice.avgCost)}, with a total return of ${fmtPct(portfolioSlice.totalReturn)} including dividends.`,
      citations: [portCite],
    });
  }

  return insights.slice(0, 5);
}

function buildBusinessOverviewFallback(
  companyName: string | null,
  sector: string | null,
  description: string | null,
  businessLines: string[] | null,
  sources: ReportSource[]
): AiReportInsight[] {
  const insights: AiReportInsight[] = [];
  const cite = financialCitation(sources);

  if (description) {
    insights.push({ text: description.slice(0, 200), citations: [cite] });
  } else if (companyName && sector) {
    insights.push({
      text: `${companyName} operates in the ${sector} sector on the Pakistan Stock Exchange.`,
      citations: [cite],
    });
  }

  if (businessLines?.length) {
    insights.push({
      text: `Business segments include: ${businessLines.slice(0, 4).join(", ")}.`,
      citations: [cite],
    });
  }

  return insights.slice(0, 4);
}

function buildCatalystsFallback(
  points: NormalizedFinancialPoint[],
  filings: FilingItem[],
  sector: string | null,
  sources: ReportSource[]
): AiReportInsight[] {
  const insights: AiReportInsight[] = [];
  const finCite = financialCitation(sources);
  const filCite = filingCitation(sources);

  const annual = points.filter((p) => p.periodKind === "annual");
  if (annual.length >= 2) {
    const latest = annual[annual.length - 1];
    const prior = annual[annual.length - 2];
    if (latest.revenue && prior.revenue && latest.revenue > prior.revenue) {
      insights.push({
        text: `Revenue growth trend: ${prior.periodLabel} to ${latest.periodLabel} showed positive revenue trajectory.`,
        citations: [finCite],
      });
    }
    if (latest.profitAfterTax && prior.profitAfterTax && latest.profitAfterTax > prior.profitAfterTax) {
      insights.push({
        text: `Profitability improvement: PAT increased from ${prior.periodLabel} to ${latest.periodLabel}.`,
        citations: [finCite],
      });
    }
  }

  const dividendFilings = filings.filter((f) => /dividend|bonus/i.test(f.title));
  if (dividendFilings.length) {
    insights.push({
      text: `Recent dividend or bonus activity: ${dividendFilings[0].title} (${dividendFilings[0].date ?? "recent"}).`,
      citations: [filCite],
    });
  }

  if (!insights.length) {
    insights.push({
      text: `Potential catalysts should be evaluated against sector conditions and recent filing developments. Limited catalyst signals were identified from available evidence.`,
      citations: [finCite],
    });
  }

  return insights.slice(0, 4);
}

function buildRisksFallback(
  points: NormalizedFinancialPoint[],
  ratios: { name: string; value: number | null }[],
  sector: string | null,
  sources: ReportSource[]
): AiReportInsight[] {
  const insights: AiReportInsight[] = [];
  const finCite = financialCitation(sources);

  const annual = points.filter((p) => p.periodKind === "annual");
  if (annual.length >= 2) {
    const latest = annual[annual.length - 1];
    const prior = annual[annual.length - 2];
    if (latest.profitAfterTax && prior.profitAfterTax && latest.profitAfterTax < prior.profitAfterTax) {
      insights.push({
        text: `Profitability pressure: PAT declined from ${prior.periodLabel} to ${latest.periodLabel}.`,
        citations: [finCite],
      });
    }
    if (latest.revenue && prior.revenue && latest.revenue < prior.revenue) {
      insights.push({
        text: `Revenue contraction from ${prior.periodLabel} to ${latest.periodLabel} suggests demand or pricing weakness.`,
        citations: [finCite],
      });
    }
  }

  const debtRatio = ratios.find((r) => r.name === "Debt-to-equity");
  if (debtRatio?.value != null && debtRatio.value > 1.5) {
    insights.push({
      text: `Elevated leverage: debt-to-equity ratio of ${debtRatio.value.toFixed(2)} suggests meaningful financial risk.`,
      citations: [finCite],
    });
  }

  // Sector-generic risks
  if (sector?.toLowerCase().includes("cement")) {
    insights.push({
      text: `Sector risks include sensitivity to construction activity, coal and energy prices, currency depreciation, interest rates, regional cement pricing, and environmental regulation.`,
      citations: [finCite],
    });
  } else {
    insights.push({
      text: `Sector and macro risks include economic conditions, regulatory changes, currency movements, interest rates, and competitive pressures.`,
      citations: [finCite],
    });
  }

  return insights.slice(0, 4);
}

function buildRecentDevelopmentsFallback(
  filings: FilingItem[],
  news: { title: string; publishedAt: string | null; source: string | null }[],
  sources: ReportSource[]
): AiReportInsight[] {
  const insights: AiReportInsight[] = [];
  const filCite = filingCitation(sources);

  const recentFilings = filings.slice(0, 4);
  for (const f of recentFilings) {
    insights.push({
      text: `${f.date ?? "Recent"}: ${f.title} (${f.category}).`,
      citations: [filCite],
    });
  }

  if (!insights.length && news.length) {
    for (const n of news.slice(0, 3)) {
      insights.push({
        text: `${n.publishedAt?.slice(0, 10) ?? "Recent"}: ${n.title} (${n.source ?? "news"}).`,
        citations: [filCite],
      });
    }
  }

  if (!insights.length) {
    insights.push({
      text: `No material recent developments were identified in the evidence window.`,
      citations: [filCite],
    });
  }

  return insights.slice(0, 5);
}

function buildDataGapsFallback(
  points: NormalizedFinancialPoint[],
  portfolioSlice: PortfolioSlice,
  hasPeers: boolean,
  sources: ReportSource[]
): AiReportInsight[] {
  const insights: AiReportInsight[] = [];
  const cite = financialCitation(sources);

  const annual = points.filter((p) => p.periodKind === "annual");
  if (annual.length < 3) {
    insights.push({
      text: `Limited historical data: only ${annual.length} annual period(s) available. Trend analysis may be incomplete.`,
      citations: [cite],
    });
  }

  const missingEps = annual.filter((p) => p.eps === null);
  if (missingEps.length) {
    insights.push({
      text: `EPS not reported for ${missingEps.length} annual period(s): ${missingEps.map((p) => p.periodLabel).join(", ")}.`,
      citations: [cite],
    });
  }

  if (!hasPeers) {
    insights.push({
      text: `Peer comparison data was insufficient or unavailable for this report.`,
      citations: [cite],
    });
  }

  if (!insights.length) {
    insights.push({
      text: `No significant data gaps were identified. All major financial periods have sourced data.`,
      citations: [cite],
    });
  }

  return insights.slice(0, 4);
}

function buildMonitoringFallback(
  companyName: string | null,
  filings: FilingItem[],
  sources: ReportSource[]
): AiReportInsight[] {
  const insights: AiReportInsight[] = [];
  const cite = financialCitation(sources);

  insights.push({
    text: `Monitor next quarterly and annual financial results for trend confirmation.`,
    citations: [cite],
  });
  insights.push({
    text: `Track upcoming board meetings and dividend announcements via official PSX disclosures.`,
    citations: [cite],
  });
  insights.push({
    text: `Review sector-specific developments including pricing, demand, and regulatory changes.`,
    citations: [cite],
  });
  if (filings.some((f) => /expansion|capacity|project/i.test(f.title))) {
    insights.push({
      text: `Follow up on expansion or capacity project milestones mentioned in recent filings.`,
      citations: [cite],
    });
  }

  return insights.slice(0, 5);
}

export interface EnrichmentContext {
  portfolioSlice: PortfolioSlice;
  financialPoints: NormalizedFinancialPoint[];
  displayUnit: string;
  sources: ReportSource[];
  companyName?: string | null;
  sector?: string | null;
  description?: string | null;
  businessLines?: string[] | null;
  technicals?: TechnicalsMeta | null;
  filings?: FilingItem[];
  news?: { title: string; publishedAt: string | null; source: string | null }[];
  ratios?: { name: string; value: number | null }[];
  hasPeers?: boolean;
}

/** Fill structural sections from sourced evidence when the AI returns empty arrays. */
export function enrichNarrativeFromEvidence(
  narrative: AiReportNarrative,
  options: CompanyReportOptions,
  ctx: EnrichmentContext
): AiReportNarrative {
  const out = { ...narrative };

  // Executive Summary — always required
  if (out.executiveSummary.length === 0) {
    out.executiveSummary = buildExecutiveSummaryFallback(
      ctx.companyName ?? null,
      ctx.sector ?? null,
      ctx.financialPoints,
      ctx.displayUnit,
      ctx.technicals ?? null,
      ctx.portfolioSlice,
      ctx.sources
    );
  }

  // Business Overview
  if (options.include.businessOverview && out.businessOverview.length === 0) {
    out.businessOverview = buildBusinessOverviewFallback(
      ctx.companyName ?? null,
      ctx.sector ?? null,
      ctx.description ?? null,
      ctx.businessLines ?? null,
      ctx.sources
    );
  }

  // Portfolio
  if (options.include.portfolio && ctx.portfolioSlice.held && out.portfolio.length === 0) {
    out.portfolio = buildPortfolioFallback(ctx.portfolioSlice, portfolioCitation(ctx.sources));
  }

  // Financial Performance
  if (options.include.financials && out.financialPerformance.length === 0 && ctx.financialPoints.length > 0) {
    out.financialPerformance = buildFinancialFallback(
      ctx.financialPoints,
      ctx.displayUnit,
      financialCitation(ctx.sources)
    );
  }

  // Catalysts
  if (options.include.catalystsRisks && out.catalysts.length === 0) {
    out.catalysts = buildCatalystsFallback(
      ctx.financialPoints,
      ctx.filings ?? [],
      ctx.sector ?? null,
      ctx.sources
    );
  }

  // Risks
  if (options.include.catalystsRisks && out.risks.length === 0) {
    out.risks = buildRisksFallback(
      ctx.financialPoints,
      ctx.ratios ?? [],
      ctx.sector ?? null,
      ctx.sources
    );
  }

  // Recent Developments
  if (out.recentDevelopments.length === 0) {
    out.recentDevelopments = buildRecentDevelopmentsFallback(
      ctx.filings ?? [],
      ctx.news ?? [],
      ctx.sources
    );
  }

  // Data Gaps
  if (out.dataGaps.length === 0) {
    out.dataGaps = buildDataGapsFallback(
      ctx.financialPoints,
      ctx.portfolioSlice,
      ctx.hasPeers ?? false,
      ctx.sources
    );
  }

  // Monitoring Checklist
  if (options.include.monitoring && out.monitoring.length === 0) {
    out.monitoring = buildMonitoringFallback(
      ctx.companyName ?? null,
      ctx.filings ?? [],
      ctx.sources
    );
  }

  return out;
}
