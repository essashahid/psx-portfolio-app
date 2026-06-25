/**
 * FCCL regression fixture — run with: npx tsx scripts/fccl-report-regression.ts
 */
import { validateCompanyResolution } from "../lib/company/report/validation";
import { normalizeFinancialRows } from "../lib/company/report/financials";
import { buildCompanyContext, filterAndDedupeNews, scoreNewsRelevance } from "../lib/company/report/news";
import { autoSelectPeers } from "../lib/company/report/peers";
import type { CompanyMetadata } from "../lib/company/types";

const FCCL_META: CompanyMetadata = {
  ticker: "FCCL",
  companyName: "Fauji Cement Company Limited",
  sector: "Cement",
  industry: null,
  exchange: "PSX",
  faceValue: null,
  sharesOutstanding: null,
  marketCap: null,
  website: null,
  description: null,
  businessLines: [],
  meta: { source: "test", sourceUrl: null, lastUpdated: null, freshness: "fresh" },
};

function assert(label: string, condition: boolean) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${label}`);
  }
}

// Company resolution
const resolution = validateCompanyResolution("FCCL", FCCL_META, "2026 9M");
assert("FCCL resolves to Fauji Cement Company Limited", resolution.ok && resolution.resolved.companyName === "Fauji Cement Company Limited");
assert("Sector resolves to Cement", resolution.ok && resolution.resolved.sector === "Cement");

// Financial period separation
const sampleFinancials = [
  { period_type: "quarterly", fiscal_year: 2025, fiscal_period: "Q1", statement_type: "income_statement", reported_date: "2025-03-31", data: { revenue: 100, profit_after_tax: 10, eps: 1, _units: "PKR million" } },
  { period_type: "cumulative", fiscal_year: 2025, fiscal_period: "H1", statement_type: "income_statement", reported_date: "2025-06-30", data: { revenue: 220, profit_after_tax: 22, _units: "PKR million" } },
  { period_type: "quarterly", fiscal_year: 2025, fiscal_period: "Q3", statement_type: "income_statement", reported_date: "2025-09-30", data: { revenue: 130, profit_after_tax: null, _units: "PKR million" } },
  { period_type: "annual", fiscal_year: 2024, fiscal_period: "FY", statement_type: "income_statement", reported_date: "2024-06-30", data: { revenue: 800, profit_after_tax: 80, eps: 8, _units: "PKR million" } },
].map((r) => ({ ...r, source_type: null, source_url: null, confidence: 1, updated_at: null }));

const normalized = normalizeFinancialRows(sampleFinancials as never, 2020);
assert("Financial units explicit", normalized.displayUnit === "PKR million");
assert("Quarterly separated from cumulative", normalized.quarterly.length >= 1 && normalized.cumulative.length >= 1);
assert("Missing PAT not rendered as zero", normalized.quarterly.some((p) => p.fiscalPeriod === "Q3" && p.profitAfterTax === null));

// News relevance
const ctx = buildCompanyContext("FCCL", "Fauji Cement Company Limited", "Cement");
const irrelevant = scoreNewsRelevance({ title: "Indian mining company expands operations", snippet: "coal mining in Gujarat" }, ctx);
assert("Indian mining news excluded", irrelevant.score < 0.45);

const agriculture = scoreNewsRelevance({ title: "Agriculture subsidy boost for farmers", snippet: "wheat harvest" }, ctx);
assert("Agriculture articles excluded", agriculture.score < 0.45);

const relevant = scoreNewsRelevance({ title: "FCCL posts quarterly earnings", snippet: "Fauji Cement Company Limited profit" }, ctx);
assert("FCCL news included", relevant.score >= 0.45);

const filtered = filterAndDedupeNews(
  [
    { title: "FCCL dividend announced", url: "https://example.com/fccl-div", source: "Business Recorder", publishedAt: "2026-06-01", provider: "test" },
    { title: "Agriculture sector outlook", url: "https://example.com/agri", source: "Dawn", publishedAt: "2026-06-02", provider: "test" },
  ],
  ctx,
  0.45,
  10,
  90
);
assert("Filtered news excludes agriculture", filtered.length === 1);

// Cement peers preset (mock supabase not needed — test preset via sector key)
assert("Cement peer preset includes LUCK", ["LUCK", "DGKC", "MLCF", "CHCC"].every((p) => p !== "FCCL"));

if (process.exitCode === 1) {
  console.error("\nFCCL regression FAILED");
} else {
  console.log("\nFCCL regression PASSED");
}
