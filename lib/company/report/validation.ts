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

const MODULE_SECTION_MAP: Record<string, (payload: CompanyReportPayload) => boolean> = {
  businessOverview: (p) => p.narrative.businessOverview.length > 0 || hasEvidence(p, "company"),
  financials: (p) => p.charts.financialsAnnual.length > 0 || p.narrative.financialPerformance.length > 0,
  financialQuality: (p) => p.narrative.financialQuality.length > 0,
  valuation: (p) => p.narrative.valuation.length > 0 || p.charts.valuation.some((v) => v.value !== null),
  dividends: (p) => p.charts.dividends.length > 0 || p.narrative.dividends.length > 0,
  pricePerformance: (p) => p.charts.price.length > 0 || p.narrative.pricePerformance.length > 0,
  filings: (p) => hasEvidenceArray(p, "officialFilings"),
  news: (p) => hasEvidenceArray(p, "independentNews"),
  peers: (p) => hasEvidenceArray(p, "peers") && p.charts.peers.length > 0,
  catalystsRisks: (p) => p.narrative.catalysts.length > 0 && p.narrative.risks.length > 0,
  scenarioAnalysis: (p) => p.scenarios.length >= 3,
  portfolio: (p) => {
    const portfolio = p.evidence.portfolio as { held?: boolean } | undefined;
    if (!portfolio) return false;
    if (portfolio.held === false) return true;
    return p.narrative.portfolio.length > 0 || portfolio.held === true;
  },
  monitoring: (p) => p.narrative.monitoring.length > 0,
};

function hasEvidence(payload: CompanyReportPayload, key: string): boolean {
  return payload.evidence[key] !== undefined && payload.evidence[key] !== null;
}

function hasEvidenceArray(payload: CompanyReportPayload, key: string): boolean {
  const val = payload.evidence[key];
  return Array.isArray(val) && val.length > 0;
}

export function validateReportBeforePublish(
  payload: CompanyReportPayload,
  options: CompanyReportOptions,
  quoteTimestamp: string | null
): ReportValidationResult {
  const criticalFailures: string[] = [];
  const warnings: string[] = [];
  const moduleChecks: ReportValidationResult["moduleChecks"] = [];

  const company = payload.evidence.company as { companyName?: string; sector?: string; exchange?: string } | undefined;
  if (!company?.companyName) criticalFailures.push("Company name not resolved.");
  if (!company?.sector) criticalFailures.push("Sector not resolved.");
  if (!company?.exchange) criticalFailures.push("Exchange not resolved.");
  if (!quoteTimestamp) warnings.push("Current price timestamp missing.");

  for (const [key, selected] of Object.entries(options.include)) {
    if (!selected) continue;
    const checker = MODULE_SECTION_MAP[key];
    const found = checker ? checker(payload) : true;
    moduleChecks.push({ module: key, selected: true, found });
    // Structural modules must be present; narrative-only gaps are warnings.
    const structural = ["financials", "peers", "filings", "news", "scenarioAnalysis", "portfolio"];
    if (!found && structural.includes(key)) {
      criticalFailures.push(`Selected module "${key}" is missing from the generated report.`);
    } else if (!found) {
      warnings.push(`Selected module "${key}" has limited narrative content.`);
    }
  }

  if (options.include.peers && !hasEvidenceArray(payload, "peers")) {
    criticalFailures.push("Peer comparison selected but peer data not delivered.");
  }

  const portfolio = payload.evidence.portfolio as { held?: boolean } | undefined;
  if (options.include.portfolio && portfolio?.held && payload.narrative.portfolio.length === 0) {
    criticalFailures.push("Portfolio position selected but portfolio section is empty.");
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
