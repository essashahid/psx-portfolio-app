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

const CUMULATIVE_PERIODS = new Set(["H1", "9M", "FY", "HALF", "NINE_MONTHS", "FULL_YEAR"]);
const QUARTERLY_PERIODS = new Set(["Q1", "Q2", "Q3", "Q4"]);

function periodKind(fiscalPeriod: string | null, periodType: string): NormalizedFinancialPoint["periodKind"] {
  const p = (fiscalPeriod ?? periodType).toUpperCase().replace(/\s+/g, "");
  if (QUARTERLY_PERIODS.has(p)) return "quarterly";
  if (CUMULATIVE_PERIODS.has(p) || p.includes("9M") || p.includes("H1")) return "cumulative";
  if (p === "ANNUAL" || periodType === "annual") return "annual";
  if (/^Q[1-4]$/.test(p)) return "quarterly";
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

export function normalizeFinancialRows(rows: RawFinancialRow[], minYear: number): {
  all: NormalizedFinancialPoint[];
  annual: NormalizedFinancialPoint[];
  quarterly: NormalizedFinancialPoint[];
  cumulative: NormalizedFinancialPoint[];
  displayUnit: string;
} {
  const income = rows
    .filter((r) => r.statement_type === "income_statement")
    .filter((r) => !r.fiscal_year || r.fiscal_year >= minYear);

  const unit = income.length ? extractUnit(income[0].data) : "PKR million";

  const base: NormalizedFinancialPoint[] = income.map((r) => ({
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
  }));

  const withDerived = deriveStandaloneQuarters(base);
  const annual = withDerived.filter((p) => p.periodKind === "annual");
  const quarterly = withDerived.filter((p) => p.periodKind === "quarterly");
  const cumulative = withDerived.filter((p) => p.periodKind === "cumulative");

  return { all: withDerived, annual, quarterly, cumulative, displayUnit: unit };
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
  const sub = (a: number | null, b: number | null) =>
    a !== null && b !== null && a >= b ? a - b : null;
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
    derivationNote: "Calculated standalone quarter from cumulative disclosure",
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
