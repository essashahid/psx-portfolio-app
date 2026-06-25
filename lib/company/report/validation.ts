import type { CompanyMetadata } from "@/lib/company/types";
import type { CompanyReportOptions, CompanyReportPayload, ReportValidationResult } from "./types";

export interface ResolvedCompany {
  ticker: string;
  companyName: string;
  sector: string;
  exchange: string;
  currency: string;
  financialYearEnd: string | null;
  latestReportingPeriod: string | null;
  metadata: CompanyMetadata;
}

export function validateCompanyResolution(
  ticker: string,
  metadata: CompanyMetadata | null,
  latestFinancialLabel: string | null
): { ok: true; resolved: ResolvedCompany } | { ok: false; error: string } {
  if (!metadata) {
    return { ok: false, error: `Company metadata could not be resolved for ${ticker}.` };
  }
  const companyName = metadata.companyName?.trim();
  const sector = metadata.sector?.trim();
  if (!companyName) {
    return { ok: false, error: `Company name unavailable for ${ticker}. Refresh company data or review ticker mapping.` };
  }
  if (!sector) {
    return { ok: false, error: `Sector unavailable for ${ticker}. Refresh company data or review ticker mapping.` };
  }
  return {
    ok: true,
    resolved: {
      ticker: ticker.toUpperCase(),
      companyName,
      sector,
      exchange: metadata.exchange ?? "PSX",
      currency: "PKR",
      financialYearEnd: null,
      latestReportingPeriod: latestFinancialLabel,
      metadata,
    },
  };
}

/**
 * Strict module checks. A module "passes" only when it has substantive content —
 * not merely because some evidence key exists. Empty narrative sections are NOT acceptable.
 */
const MODULE_SECTION_MAP: Record<string, (payload: CompanyReportPayload) => { found: boolean; reason?: string }> = {
  businessOverview: (p) => {
    const has = p.narrative.businessOverview.length > 0;
    return { found: has, reason: has ? undefined : "Business overview narrative is empty" };
  },
  financials: (p) => {
    const hasData =
      p.charts.financialsAnnual.length > 0 ||
      p.charts.financialsQuarterly.length > 0 ||
      p.charts.financialsCumulative.length > 0;
    const hasNarrative = p.narrative.financialPerformance.length > 0;
    const found = hasData || hasNarrative;
    return { found, reason: found ? undefined : "No financial data or narrative generated" };
  },
  financialQuality: (p) => {
    const has = p.narrative.financialQuality.length > 0;
    return { found: has, reason: has ? undefined : "Financial quality narrative is empty" };
  },
  valuation: (p) => {
    const hasNarrative = p.narrative.valuation.length > 0;
    const hasData = p.charts.valuation.some((v) => v.value !== null);
    const found = hasNarrative || hasData;
    return { found, reason: found ? undefined : "No valuation data or narrative" };
  },
  dividends: (p) => {
    const found = p.charts.dividends.length > 0 || p.narrative.dividends.length > 0;
    return { found, reason: found ? undefined : "No dividend data or narrative" };
  },
  pricePerformance: (p) => {
    const found = p.charts.price.length > 0 || p.narrative.pricePerformance.length > 0;
    return { found, reason: found ? undefined : "No price performance data or narrative" };
  },
  filings: (p) => {
    const found = hasEvidenceArray(p, "officialFilings");
    return { found, reason: found ? undefined : "No official filings retrieved" };
  },
  news: (p) => {
    const found = hasEvidenceArray(p, "independentNews");
    return { found, reason: found ? undefined : "No independent news articles retrieved" };
  },
  peers: (p) => {
    const hasPeers = hasEvidenceArray(p, "peers");
    const hasChartData = p.charts.peers.some((x) => x.value !== null);
    const found = hasPeers;
    return {
      found,
      reason: found
        ? hasChartData
          ? undefined
          : "Peer data retrieved but metric values are unavailable"
        : "No peer data retrieved",
    };
  },
  catalystsRisks: (p) => {
    const hasCatalysts = p.narrative.catalysts.length > 0;
    const hasRisks = p.narrative.risks.length > 0;
    const found = hasCatalysts && hasRisks;
    return {
      found,
      reason: found
        ? undefined
        : !hasCatalysts && !hasRisks
          ? "Both catalysts and risks narratives are empty"
          : !hasCatalysts
            ? "Catalysts narrative is empty"
            : "Risks narrative is empty",
    };
  },
  scenarioAnalysis: (p) => {
    const found = p.scenarios.length >= 3;
    return { found, reason: found ? undefined : "Fewer than 3 scenario cases generated" };
  },
  portfolio: (p) => {
    const portfolio = p.evidence.portfolio as { held?: boolean; quantity?: number } | undefined;
    if (!portfolio) return { found: false, reason: "No portfolio data" };
    if (portfolio.held === false) return { found: true };
    const hasNarrative = p.narrative.portfolio.length > 0;
    const hasData = portfolio.quantity != null;
    const found = hasNarrative || hasData;
    return { found, reason: found ? undefined : "Portfolio position selected but no data or narrative" };
  },
  monitoring: (p) => {
    const has = p.narrative.monitoring.length > 0;
    return { found: has, reason: has ? undefined : "Monitoring checklist is empty" };
  },
};

function hasEvidenceArray(payload: CompanyReportPayload, key: string): boolean {
  const val = payload.evidence[key];
  return Array.isArray(val) && val.length > 0;
}

/**
 * Modules that must have substantive content when selected.
 * If any of these fail, the report receives a critical failure.
 */
const CRITICAL_MODULES = new Set([
  "financials",
  "peers",
  "filings",
  "portfolio",
  "scenarioAnalysis",
  "catalystsRisks",
]);

/**
 * Modules that produce warnings (not critical failures) when content is missing.
 * The report can still be published but will note limited content.
 */
const WARNING_MODULES = new Set([
  "businessOverview",
  "financialQuality",
  "valuation",
  "dividends",
  "pricePerformance",
  "news",
  "monitoring",
]);

export function validateReportBeforePublish(
  payload: CompanyReportPayload,
  options: CompanyReportOptions,
  quoteTimestamp: string | null
): ReportValidationResult {
  const criticalFailures: string[] = [];
  const warnings: string[] = [];
  const moduleChecks: ReportValidationResult["moduleChecks"] = [];

  // Company identity checks
  const company = payload.evidence.company as { companyName?: string; sector?: string; exchange?: string } | undefined;
  if (!company?.companyName) criticalFailures.push("Company name not resolved.");
  if (!company?.sector) criticalFailures.push("Sector not resolved.");
  if (!company?.exchange) criticalFailures.push("Exchange not resolved.");
  if (!quoteTimestamp) warnings.push("Current price timestamp missing.");

  // Executive summary is always required
  if (payload.narrative.executiveSummary.length === 0) {
    criticalFailures.push("Executive summary narrative is empty — report must have a sourced executive summary.");
  }

  // Module checks
  for (const [key, selected] of Object.entries(options.include)) {
    if (!selected) continue;
    const checker = MODULE_SECTION_MAP[key];
    if (!checker) {
      moduleChecks.push({ module: key, selected: true, found: true });
      continue;
    }

    const result = checker(payload);
    moduleChecks.push({ module: key, selected: true, found: result.found });

    if (!result.found) {
      if (CRITICAL_MODULES.has(key)) {
        criticalFailures.push(`Selected module "${key}" failed: ${result.reason ?? "missing from report"}`);
      } else {
        warnings.push(`Selected module "${key}" has limited content: ${result.reason ?? "narrative empty"}`);
      }
    }
  }

  // Portfolio reconciliation check
  const portfolio = payload.evidence.portfolio as {
    held?: boolean;
    dividendIncome?: number;
    totalReturn?: number | null;
    priceReturnPct?: number | null;
    unrealizedPlPct?: number | null;
  } | undefined;
  if (
    options.include.portfolio &&
    portfolio?.held &&
    portfolio.dividendIncome != null &&
    portfolio.dividendIncome > 0 &&
    portfolio.totalReturn != null &&
    portfolio.priceReturnPct != null &&
    Math.abs(portfolio.totalReturn - portfolio.priceReturnPct) < 0.01
  ) {
    warnings.push("Total return including dividends equals price-only return despite recorded dividend income — check portfolio calculation.");
  }

  return {
    passed: criticalFailures.length === 0,
    criticalFailures,
    warnings,
    moduleChecks,
  };
}

export function assertPublishable(validation: ReportValidationResult): void {
  if (!validation.passed) {
    throw new Error(`Report validation failed: ${validation.criticalFailures.join("; ")}`);
  }
}
