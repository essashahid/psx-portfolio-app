import type { NormalizedFinancialPoint } from "./types";

interface RawFinancialRow {
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  reported_date: string | null;
  source_type: string | null;
  source_url: string | null;
  confidence: number | null;
  updated_at: string | null;
  data: Record<string, number | string | null>;
}

const CUMULATIVE_PERIODS = new Set(["H1", "9M", "HALF", "NINE_MONTHS"]);
const QUARTERLY_PERIODS = new Set(["Q1", "Q2", "Q3", "Q4"]);
const ANNUAL_PERIODS = new Set(["FY", "FULL_YEAR", "ANNUAL"]);

/** Canonical order within a fiscal year for sorting. */
const PERIOD_SORT_ORDER: Record<string, number> = {
  Q1: 1, Q2: 2, Q3: 3, Q4: 4,
  H1: 10, "9M": 11,
  FY: 20, FULL_YEAR: 20, ANNUAL: 20,
};

function periodKind(fiscalPeriod: string | null, periodType: string): NormalizedFinancialPoint["periodKind"] {
  const p = (fiscalPeriod ?? periodType).toUpperCase().replace(/\s+/g, "");
  // Trust the specific fiscal_period first: some rows are mis-tagged
  // period_type "annual" while actually being an interim (9M/H1/Qx) result.
  if (QUARTERLY_PERIODS.has(p) || /^Q[1-4]$/.test(p)) return "quarterly";
  if (CUMULATIVE_PERIODS.has(p) || p.includes("9M") || p.includes("H1")) return "cumulative";
  if (ANNUAL_PERIODS.has(p) || periodType === "annual") return "annual";
  return "annual";
}

function extractUnit(data: Record<string, number | string | null>): string {
  const units = data._units ?? data._unit ?? data.units;
  if (typeof units === "string" && units.trim()) return units.trim();
  return "PKR million";
}

function num(data: Record<string, number | string | null>, key: string): number | null {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function periodLabel(row: RawFinancialRow): string {
  const fp = row.fiscal_period ?? row.period_type;
  const fy = row.fiscal_year ?? "?";
  return `${fy} ${fp}`.trim();
}

function sortKey(p: NormalizedFinancialPoint): string {
  const year = p.fiscalYear ?? 0;
  const order = PERIOD_SORT_ORDER[(p.fiscalPeriod ?? "FY").toUpperCase()] ?? 20;
  return `${String(year).padStart(5, "0")}-${String(order).padStart(3, "0")}`;
}

/** Sort points chronologically: by fiscal year, then by period order within the year. */
function sortChronologically(points: NormalizedFinancialPoint[]): NormalizedFinancialPoint[] {
  return [...points].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export interface FinancialDataIssue {
  type: "duplicate" | "suspicious_repeat" | "quarterly_exceeds_annual" | "missing_source";
  description: string;
  periods: string[];
  field?: string;
}

/** Detect duplicate and suspicious financial records. */
function detectDataIssues(points: NormalizedFinancialPoint[]): FinancialDataIssue[] {
  const issues: FinancialDataIssue[] = [];

  // Detect exact duplicate period labels
  const seen = new Map<string, NormalizedFinancialPoint>();
  for (const p of points) {
    const key = `${p.periodKind}:${p.periodLabel}`;
    if (seen.has(key)) {
      issues.push({
        type: "duplicate",
        description: `Duplicate period record for ${p.periodLabel} (${p.periodKind})`,
        periods: [p.periodLabel],
      });
    }
    seen.set(key, p);
  }

  // Detect suspicious identical values across different annual periods
  const annuals = points.filter((p) => p.periodKind === "annual");
  for (let i = 0; i < annuals.length; i++) {
    for (let j = i + 1; j < annuals.length; j++) {
      const a = annuals[i];
      const b = annuals[j];
      if (
        a.revenue !== null && b.revenue !== null && a.revenue === b.revenue &&
        a.profitAfterTax !== null && b.profitAfterTax !== null && a.profitAfterTax === b.profitAfterTax &&
        a.periodLabel !== b.periodLabel
      ) {
        issues.push({
          type: "suspicious_repeat",
          description: `Identical revenue and PAT values in ${a.periodLabel} and ${b.periodLabel} — possible data duplication`,
          periods: [a.periodLabel, b.periodLabel],
          field: "revenue+PAT",
        });
      }
    }
  }

  return issues;
}

export function normalizeFinancialRows(rows: RawFinancialRow[], minYear: number): {
  all: NormalizedFinancialPoint[];
  annual: NormalizedFinancialPoint[];
  quarterly: NormalizedFinancialPoint[];
  cumulative: NormalizedFinancialPoint[];
  displayUnit: string;
  dataIssues: FinancialDataIssue[];
} {
  const income = rows
    .filter((r) => r.statement_type === "income_statement")
    .filter((r) => !r.fiscal_year || r.fiscal_year >= minYear);

  const unit = income.length ? extractUnit(income[0].data) : "PKR million";

  // Deduplicate: keep the row with the most recent reported_date for each period
  const deduped = new Map<string, RawFinancialRow>();
  for (const r of income) {
    const key = `${r.fiscal_year ?? "?"}-${(r.fiscal_period ?? r.period_type).toUpperCase()}`;
    const existing = deduped.get(key);
    if (!existing || (r.reported_date ?? "") > (existing.reported_date ?? "")) {
      deduped.set(key, r);
    }
  }

  const base: NormalizedFinancialPoint[] = [...deduped.values()].map((r) => ({
    periodLabel: periodLabel(r),
    periodKind: periodKind(r.fiscal_period, r.period_type),
    fiscalYear: r.fiscal_year,
    fiscalPeriod: r.fiscal_period,
    reportedDate: r.reported_date,
    unit,
    revenue: num(r.data, "revenue"),
    grossProfit: num(r.data, "gross_profit"),
    operatingProfit: num(r.data, "operating_profit"),
    profitAfterTax: num(r.data, "profit_after_tax"),
    eps: num(r.data, "eps"),
    isDerived: false,
    sourceUrl: r.source_url,
    sourceType: r.source_type,
  }));

  const withDerived = deriveStandaloneQuarters(base);

  // Sort ALL arrays chronologically
  const annual = sortChronologically(withDerived.filter((p) => p.periodKind === "annual"));
  const quarterly = sortChronologically(withDerived.filter((p) => p.periodKind === "quarterly"));
  const cumulative = sortChronologically(withDerived.filter((p) => p.periodKind === "cumulative"));
  const all = sortChronologically(withDerived);

  const dataIssues = detectDataIssues(all);

  return { all, annual, quarterly, cumulative, displayUnit: unit, dataIssues };
}

function deriveStandaloneQuarters(points: NormalizedFinancialPoint[]): NormalizedFinancialPoint[] {
  const out = [...points];
  const byYear = new Map<number, NormalizedFinancialPoint[]>();
  for (const p of points) {
    if (!p.fiscalYear) continue;
    const list = byYear.get(p.fiscalYear) ?? [];
    list.push(p);
    byYear.set(p.fiscalYear, list);
  }

  for (const [year, yearPoints] of byYear) {
    const q1 = yearPoints.find((p) => p.fiscalPeriod === "Q1");
    const h1 = yearPoints.find((p) => p.fiscalPeriod === "H1" || p.periodLabel.includes("H1"));
    if (q1 && h1 && !yearPoints.some((p) => p.fiscalPeriod === "Q2")) {
      const derived = subtractPoint(h1, q1, "Q2", year);
      if (derived) out.push(derived);
    }
    const q3 = yearPoints.find((p) => p.fiscalPeriod === "Q3");
    const nineM = yearPoints.find((p) => p.fiscalPeriod === "9M" || p.periodLabel.includes("9M"));
    if (h1 && nineM && !q3) {
      const derived = subtractPoint(nineM, h1, "Q3", year);
      if (derived) out.push(derived);
    }
  }
  return out;
}

function subtractPoint(
  cumulative: NormalizedFinancialPoint,
  prior: NormalizedFinancialPoint,
  targetPeriod: string,
  year: number
): NormalizedFinancialPoint | null {
  if (cumulative.unit !== prior.unit) return null;
  // Allow negative results (valid for negative-growth quarters)
  const sub = (a: number | null, b: number | null) =>
    a !== null && b !== null ? a - b : null;
  const pat = sub(cumulative.profitAfterTax, prior.profitAfterTax);
  const rev = sub(cumulative.revenue, prior.revenue);
  if (pat === null && rev === null) return null;
  return {
    periodLabel: `${year} ${targetPeriod}`,
    periodKind: "quarterly",
    fiscalYear: year,
    fiscalPeriod: targetPeriod,
    reportedDate: cumulative.reportedDate,
    unit: cumulative.unit,
    revenue: rev,
    grossProfit: sub(cumulative.grossProfit, prior.grossProfit),
    operatingProfit: sub(cumulative.operatingProfit, prior.operatingProfit),
    profitAfterTax: pat,
    eps: null,
    isDerived: true,
    derivationNote: `Calculated standalone quarter: ${cumulative.periodLabel} minus ${prior.periodLabel}`,
  };
}

export function toChartSeries(points: NormalizedFinancialPoint[]): {
  period: string;
  revenue: number | null;
  profitAfterTax: number | null;
  eps: number | null;
}[] {
  return points.map((p) => ({
    period: p.isDerived ? `${p.periodLabel}*` : p.periodLabel,
    revenue: p.revenue,
    profitAfterTax: p.profitAfterTax,
    eps: p.eps,
  }));
}

export function latestFinancialLabel(rows: RawFinancialRow[]): string | null {
  const sorted = [...rows]
    .filter((r) => r.statement_type === "income_statement")
    .sort((a, b) => String(b.reported_date ?? "").localeCompare(String(a.reported_date ?? "")));
  const top = sorted[0];
  if (!top) return null;
  return periodLabel(top);
}

export function summarizeFinancialsForEvidence(points: NormalizedFinancialPoint[]) {
  return points.map((p) => ({
    periodLabel: p.periodLabel,
    periodKind: p.periodKind,
    fiscalYear: p.fiscalYear,
    fiscalPeriod: p.fiscalPeriod,
    reportedDate: p.reportedDate,
    unit: p.unit,
    revenue: p.revenue,
    grossProfit: p.grossProfit,
    operatingProfit: p.operatingProfit,
    profitAfterTax: p.profitAfterTax,
    eps: p.eps,
    isDerived: p.isDerived,
    derivationNote: p.derivationNote,
  }));
}

/** Build a concise trend summary for the AI prompt (more useful than raw rows). */
export function buildFinancialTrendSummary(points: NormalizedFinancialPoint[], displayUnit: string): string {
  const annual = points.filter((p) => p.periodKind === "annual");
  if (!annual.length) return "No annual financial data available.";

  const lines: string[] = [`Financial values in ${displayUnit}.`];

  for (const p of annual) {
    const rev = p.revenue !== null ? p.revenue.toLocaleString("en-US") : "n/a";
    const pat = p.profitAfterTax !== null ? p.profitAfterTax.toLocaleString("en-US") : "n/a";
    const eps = p.eps !== null ? `PKR ${p.eps.toFixed(2)}` : "n/a";
    lines.push(`${p.periodLabel}: Revenue ${rev}, PAT ${pat}, EPS ${eps}`);
  }

  // Add growth rates
  if (annual.length >= 2) {
    const latest = annual[annual.length - 1];
    const prior = annual[annual.length - 2];
    if (latest.revenue && prior.revenue && prior.revenue > 0) {
      const g = ((latest.revenue - prior.revenue) / prior.revenue * 100).toFixed(1);
      lines.push(`Revenue growth (${prior.periodLabel} → ${latest.periodLabel}): ${g}%`);
    }
    if (latest.profitAfterTax && prior.profitAfterTax && prior.profitAfterTax > 0) {
      const g = ((latest.profitAfterTax - prior.profitAfterTax) / prior.profitAfterTax * 100).toFixed(1);
      lines.push(`PAT growth (${prior.periodLabel} → ${latest.periodLabel}): ${g}%`);
    }
  }

  const quarterly = points.filter((p) => p.periodKind === "quarterly");
  if (quarterly.length) {
    lines.push("", "Recent quarters:");
    for (const q of quarterly.slice(-4)) {
      const rev = q.revenue !== null ? q.revenue.toLocaleString("en-US") : "n/a";
      const pat = q.profitAfterTax !== null ? q.profitAfterTax.toLocaleString("en-US") : "n/a";
      lines.push(`${q.periodLabel}${q.isDerived ? "*" : ""}: Revenue ${rev}, PAT ${pat}`);
    }
  }

  return lines.join("\n");
}
