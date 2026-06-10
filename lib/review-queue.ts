import type { PortfolioSummary } from "@/lib/types";
import type { DividendSummary } from "@/lib/dividends";

export type ReviewSeverity = "high" | "medium" | "low";
export type ReviewCategory = "allocation" | "performance" | "data" | "thesis" | "dividend" | "news" | "alert";

export interface ReviewQueueItem {
  id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  ticker?: string | null;
  title: string;
  explanation: string;
  actionLabel: string;
  href: string;
}

export function buildReviewQueue(input: {
  summary: PortfolioSummary;
  openAlerts: { id: string; severity: string; title: string; ticker?: string | null }[];
  hiddenLowConfidenceNews: number;
  dividendSummary: DividendSummary;
  latestPriceDate: string | null;
}): ReviewQueueItem[] {
  const { summary, openAlerts, hiddenLowConfidenceNews, dividendSummary, latestPriceDate } = input;
  const items: ReviewQueueItem[] = [];
  const missingTargets = summary.holdings.filter((h) => h.target_price === null && h.target_allocation === null);
  const missingTheses = summary.holdings.filter((h) => !h.has_thesis);
  const missingPrices = summary.holdings.filter((h) => h.latest_price === null);
  const missingReviewLevels = summary.holdings.filter((h) => h.review_level === null);

  if (summary.largestHolding?.weight && summary.largestHolding.weight >= 25) {
    items.push({
      id: "largest-holding",
      severity: "high",
      category: "allocation",
      ticker: summary.largestHolding.ticker,
      title: `${summary.largestHolding.ticker} is ${summary.largestHolding.weight.toFixed(1)}% of the portfolio`,
      explanation: summary.largestHolding.target_allocation === null
        ? "This is a concentrated position and no target allocation is set."
        : "This is the largest single-stock exposure.",
      actionLabel: "Set target",
      href: "/goals",
    });
  }

  if (summary.largestSector?.weight && summary.largestSector.weight >= 40) {
    items.push({
      id: "largest-sector",
      severity: "medium",
      category: "allocation",
      title: `${summary.largestSector.sector} is ${summary.largestSector.weight.toFixed(1)}% of the portfolio`,
      explanation: "This is the largest sector exposure and may deserve an allocation review.",
      actionLabel: "Review allocation",
      href: "/holdings",
    });
  }

  const biggestDecline = summary.holdings
    .filter((h) => h.unrealized_pl_pct !== null)
    .sort((a, b) => a.unrealized_pl_pct! - b.unrealized_pl_pct!)[0];
  if (biggestDecline && biggestDecline.unrealized_pl_pct! <= -10) {
    items.push({
      id: `decline-${biggestDecline.ticker}`,
      severity: biggestDecline.unrealized_pl_pct! <= -20 ? "high" : "medium",
      category: "performance",
      ticker: biggestDecline.ticker,
      title: `${biggestDecline.ticker} is down ${Math.abs(biggestDecline.unrealized_pl_pct!).toFixed(1)}%`,
      explanation: biggestDecline.has_thesis && biggestDecline.review_level !== null
        ? "Review whether the original thesis still explains the drawdown."
        : "This position is below cost and lacks either a thesis or review level.",
      actionLabel: "Open stock",
      href: `/stocks/${biggestDecline.ticker}`,
    });
  }

  if (missingPrices.length > 0) {
    items.push({
      id: "missing-prices",
      severity: "high",
      category: "data",
      title: `${missingPrices.length} holding(s) need latest prices`,
      explanation: "Portfolio value uses cost fallback for unpriced holdings, so performance review is incomplete.",
      actionLabel: "Refresh prices",
      href: "/settings",
    });
  } else if (latestPriceDate) {
    items.push({
      id: "prices-current",
      severity: "low",
      category: "data",
      title: `Latest prices updated ${latestPriceDate}`,
      explanation: "Portfolio valuation has current price coverage for every holding.",
      actionLabel: "Manage prices",
      href: "/settings",
    });
  }

  if (missingTargets.length > 0) {
    items.push({
      id: "missing-targets",
      severity: "medium",
      category: "data",
      title: `${missingTargets.length} holding(s) are missing targets`,
      explanation: "Target price/allocation gaps make drift and review thresholds less useful.",
      actionLabel: "Set goals",
      href: "/goals",
    });
  }

  if (missingTheses.length > 0) {
    items.push({
      id: "missing-theses",
      severity: "medium",
      category: "thesis",
      title: `${missingTheses.length} holding(s) are missing thesis notes`,
      explanation: "Without a thesis, news and price moves cannot be judged against your original reason for owning.",
      actionLabel: "Review holdings",
      href: "/holdings",
    });
  }

  if (missingReviewLevels.length > 0) {
    items.push({
      id: "missing-review-levels",
      severity: "low",
      category: "thesis",
      title: `${missingReviewLevels.length} holding(s) have no review level`,
      explanation: "A review level helps separate normal volatility from thesis review triggers.",
      actionLabel: "Set review levels",
      href: "/goals",
    });
  }

  if (dividendSummary.receivedCount === 0 && dividendSummary.pendingCount === 0) {
    items.push({
      id: "dividend-not-setup",
      severity: "medium",
      category: "dividend",
      title: "Dividend tracking has not been set up",
      explanation: "Add announced or received dividends to track income and pending payments.",
      actionLabel: "Add dividend",
      href: "/dividends",
    });
  } else if (dividendSummary.pendingCount > 0) {
    items.push({
      id: "pending-dividends",
      severity: "medium",
      category: "dividend",
      title: `${dividendSummary.pendingCount} dividend(s) are pending`,
      explanation: "Expected or announced dividends should be marked received when cash arrives.",
      actionLabel: "Open dividends",
      href: "/dividends",
    });
  }

  if (hiddenLowConfidenceNews > 0) {
    items.push({
      id: "low-confidence-news",
      severity: "low",
      category: "news",
      title: `${hiddenLowConfidenceNews} news article(s) hidden for low relevance`,
      explanation: "Low-confidence matches are excluded from default news and AI briefings unless saved.",
      actionLabel: "Audit news",
      href: "/news?relevance=low",
    });
  }

  for (const alert of openAlerts.slice(0, 3)) {
    items.push({
      id: `alert-${alert.id}`,
      severity: alert.severity === "critical" ? "high" : alert.severity === "warning" ? "medium" : "low",
      category: "alert",
      ticker: alert.ticker,
      title: alert.title,
      explanation: "Open alert from portfolio rules.",
      actionLabel: "Open alerts",
      href: "/alerts",
    });
  }

  return items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).slice(0, 10);
}

function severityRank(severity: ReviewSeverity): number {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}
