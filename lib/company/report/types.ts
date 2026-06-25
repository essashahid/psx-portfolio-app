export type ReportDepth = "full" | "brief";
export type ReportPeriod = 3 | 5;
export type NewsPeriodDays = 30 | 90 | 180 | 365;

export interface ReportIncludeOptions {
  businessOverview: boolean;
  financials: boolean;
  financialQuality: boolean;
  valuation: boolean;
  dividends: boolean;
  pricePerformance: boolean;
  filings: boolean;
  news: boolean;
  peers: boolean;
  catalystsRisks: boolean;
  scenarioAnalysis: boolean;
  portfolio: boolean;
  monitoring: boolean;
}

export interface ReportOutputOptions {
  interactive: boolean;
  saveToResearch: boolean;
  exportPdf: boolean;
  exportDocx: boolean;
}

export interface CompanyReportOptions {
  depth: ReportDepth;
  periodYears: ReportPeriod;
  include: ReportIncludeOptions;
  peers: string[];
  newsPeriodDays: NewsPeriodDays;
  output: ReportOutputOptions;
}

export interface ReportSource {
  id: string;
  label: string;
  url?: string;
  asOf?: string | null;
  publisher?: string | null;
  reportingPeriod?: string | null;
}

export interface AiReportInsight {
  text: string;
  citations: string[];
}

export interface AiReportNarrative {
  businessOverview: AiReportInsight[];
  executiveSummary: AiReportInsight[];
  financialPerformance: AiReportInsight[];
  financialQuality: AiReportInsight[];
  valuation: AiReportInsight[];
  dividends: AiReportInsight[];
  pricePerformance: AiReportInsight[];
  catalysts: AiReportInsight[];
  risks: AiReportInsight[];
  recentDevelopments: AiReportInsight[];
  portfolio: AiReportInsight[];
  monitoring: AiReportInsight[];
  dataGaps: AiReportInsight[];
}

export interface NormalizedFinancialPoint {
  periodLabel: string;
  periodKind: "annual" | "quarterly" | "cumulative";
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  reportedDate: string | null;
  unit: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  profitAfterTax: number | null;
  eps: number | null;
  isDerived: boolean;
  derivationNote?: string;
  sourceUrl?: string | null;
  sourceType?: string | null;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
  summary: string | null;
  snippet: string | null;
  relevanceScore: number;
  relevanceExplanation: string;
  category: string;
  isOfficialDisclosure: boolean;
  isDuplicate: boolean;
  provider: string;
}

export interface PeerRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  marketCap: number | null;
  quote: {
    price: number | null;
    as_of: string | null;
    last_fetched_at: string | null;
  } | null;
  ratios: { ratio_name: string; ratio_value: number | null; source_period: string | null }[];
  selectionReason: string;
}

export interface ScenarioCase {
  label: "bear" | "base" | "bull";
  assumptions: Record<string, string | number | null>;
  impliedEps: number | null;
  impliedValuationMultiple: number | null;
  notes: string;
}

export interface PortfolioSlice {
  held: boolean;
  quantity?: number;
  avgCost?: number;
  currentPrice?: number | null;
  marketValue?: number;
  unrealizedPl?: number;
  unrealizedPlPct?: number;
  dividendIncome?: number;
  weight?: number;
  sectorWeight?: number | null;
  totalReturn?: number | null;
  yieldOnCost?: number | null;
}

export interface ReportValidationResult {
  passed: boolean;
  criticalFailures: string[];
  warnings: string[];
  moduleChecks: { module: string; selected: boolean; found: boolean }[];
}

export interface CompanyReportPayload {
  generatedAt: string;
  reportVersion: number;
  title: string;
  ticker: string;
  options: CompanyReportOptions;
  displayUnit: string;
  evidence: Record<string, unknown>;
  narrative: AiReportNarrative;
  charts: {
    price: { date: string; close: number; volume: number; kse100?: number | null; kse100Indexed?: number | null }[];
    financialsAnnual: { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null }[];
    financialsQuarterly: { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null }[];
    financialsCumulative: { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null }[];
    valuation: { name: string; value: number | null; peerMedian: number | null; historicalMedian: number | null }[];
    dividends: { date: string | null; dps: number | null; kind: string }[];
    peers: { ticker: string; metric: string; value: number | null }[];
    portfolio?: {
      avgCost: number | null;
      markers: { date: string; price: number; quantity: number; type: string; label: string }[];
      runningQuantity: { date: string; quantity: number }[];
    };
  };
  versionDiff?: {
    changedFigures: { field: string; previous: string | number | null; current: string | number | null }[];
    newSources: string[];
    removedSources: string[];
    newFilings: string[];
    newNews: string[];
    summary: string[];
  };
  parentReportId?: string | null;
  scenarios: ScenarioCase[];
  sources: ReportSource[];
  validation: ReportValidationResult;
  dataTimestamps: Record<string, string | null>;
}

export const DEFAULT_INCLUDE: ReportIncludeOptions = {
  businessOverview: true,
  financials: true,
  financialQuality: true,
  valuation: true,
  dividends: true,
  pricePerformance: true,
  filings: true,
  news: true,
  peers: true,
  catalystsRisks: true,
  scenarioAnalysis: true,
  portfolio: true,
  monitoring: true,
};

export const BRIEF_INCLUDE: ReportIncludeOptions = {
  businessOverview: true,
  financials: true,
  financialQuality: false,
  valuation: true,
  dividends: true,
  pricePerformance: false,
  filings: true,
  news: true,
  peers: false,
  catalystsRisks: true,
  scenarioAnalysis: false,
  portfolio: true,
  monitoring: false,
};

export const DEFAULT_OUTPUT: ReportOutputOptions = {
  interactive: true,
  saveToResearch: true,
  exportPdf: false,
  exportDocx: false,
};
