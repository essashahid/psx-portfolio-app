"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/action-button";
import { AXIS_TICK, ChartEmpty, CURSOR, FadeDefs, INK, fmtCompact } from "@/components/chart-kit";
import { cn } from "@/lib/utils";
import { Download, ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";

type StatementType = "income_statement" | "balance_sheet" | "cash_flow";
type PeriodMode = "annual" | "quarterly" | "cumulative";
type TrendView = "profit" | "margins" | "eps" | "cash" | "balance";
type ValueMode = "compact" | "exact" | "thousands" | "millions" | "billions";
type TableDepth = "summary" | "full";
type PeriodLimit = "latest4" | "all";

export interface FinancialWorkspaceRow {
  ticker: string;
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  data: Record<string, number | null | string>;
  reported_date: string | null;
  source_url: string | null;
  confidence: number | null;
  updated_at: string | null;
}

const PERIOD_ORDER: Record<string, number> = { Q1: 1, Q2: 2, H1: 2, Q3: 3, "9M": 3, Q4: 4, FY: 4 };
const SUMMARY_ROWS: Record<StatementType, string[]> = {
  income_statement: ["revenue", "gross_profit", "gross_margin", "operating_profit", "operating_margin", "profit_after_tax", "net_margin", "eps"],
  balance_sheet: ["cash_and_equivalents", "inventory", "receivables", "current_assets", "current_liabilities", "borrowings", "total_assets", "total_liabilities", "equity", "retained_earnings"],
  cash_flow: ["operating_cash_flow", "capex", "free_cash_flow", "investing_cash_flow", "financing_cash_flow", "cash_balance"],
};
const FULL_ROWS: Record<StatementType, string[]> = {
  income_statement: [
    "revenue",
    "cost_of_sales",
    "gross_profit",
    "gross_margin",
    "operating_expenses",
    "operating_profit",
    "operating_margin",
    "finance_cost",
    "profit_before_tax",
    "tax",
    "profit_after_tax",
    "net_margin",
    "eps",
  ],
  balance_sheet: [
    "cash_and_equivalents",
    "inventory",
    "receivables",
    "current_assets",
    "current_liabilities",
    "borrowings",
    "total_assets",
    "total_liabilities",
    "equity",
    "retained_earnings",
    "working_capital",
    "current_ratio",
    "debt_to_equity",
    "net_debt",
    "net_debt_to_equity",
  ],
  cash_flow: [
    "operating_cash_flow",
    "capex",
    "free_cash_flow",
    "investing_cash_flow",
    "financing_cash_flow",
    "cash_balance",
  ],
};
const LABELS: Record<string, string> = {
  revenue: "Revenue",
  cost_of_sales: "Cost of sales",
  gross_profit: "Gross profit",
  gross_margin: "Gross profit margin",
  operating_expenses: "Operating expenses",
  operating_profit: "Operating profit",
  operating_margin: "Operating margin",
  finance_cost: "Finance cost",
  profit_before_tax: "Profit before tax",
  tax: "Tax",
  profit_after_tax: "Profit after tax",
  net_margin: "Net profit margin",
  eps: "EPS",
  cash_and_equivalents: "Cash and equivalents",
  inventory: "Inventory",
  receivables: "Receivables",
  current_assets: "Current assets",
  current_liabilities: "Current liabilities",
  borrowings: "Borrowings",
  total_assets: "Total assets",
  total_liabilities: "Total liabilities",
  equity: "Equity",
  retained_earnings: "Retained earnings",
  working_capital: "Working capital",
  current_ratio: "Current ratio",
  debt_to_equity: "Debt-to-equity",
  net_debt: "Net debt",
  net_debt_to_equity: "Net debt-to-equity",
  operating_cash_flow: "Operating cash flow",
  capex: "Capital expenditure",
  free_cash_flow: "Free cash flow",
  investing_cash_flow: "Investing cash flow",
  financing_cash_flow: "Financing cash flow",
  cash_balance: "Cash movement",
};
const ACCOUNTING_HINTS: Record<string, string> = {
  gross_margin: "Gross profit divided by revenue. Shown as percentage points when compared.",
  operating_margin: "Operating profit divided by revenue. Shown as percentage points when compared.",
  net_margin: "Profit after tax divided by revenue. Shown as percentage points when compared.",
  eps: "Earnings per share in PKR. Not scaled with statement units.",
  capex: "Shown as capital expenditure outflow for free-cash-flow analysis; source sign conventions can vary.",
  working_capital: "Calculated: current assets minus current liabilities.",
  current_ratio: "Calculated: current assets divided by current liabilities.",
  debt_to_equity: "Calculated: borrowings divided by equity.",
  net_debt: "Calculated: borrowings minus cash and equivalents.",
  net_debt_to_equity: "Calculated: net debt divided by equity.",
};
const STATEMENT_LABELS: Record<StatementType, string> = {
  income_statement: "Income Statement",
  balance_sheet: "Balance Sheet",
  cash_flow: "Cash Flow",
};

function periodMode(row: FinancialWorkspaceRow): PeriodMode {
  const p = (row.fiscal_period ?? "").toUpperCase();
  if (row.period_type === "annual" || p === "FY") return "annual";
  if (/^Q[1-4]$/.test(p)) return "quarterly";
  return "cumulative";
}

function rank(row: FinancialWorkspaceRow): number {
  const p = (row.fiscal_period ?? "").toUpperCase();
  return (row.fiscal_year ?? 0) * 10 + (PERIOD_ORDER[p] ?? 0);
}

function labelPeriod(row: FinancialWorkspaceRow): string {
  const fy = row.fiscal_year ? `FY${row.fiscal_year}` : "FY?";
  const p = (row.fiscal_period ?? "").toUpperCase();
  return row.period_type === "annual" || p === "FY" ? fy : `${p || "Period"} ${fy}`;
}

function periodEndDate(row: FinancialWorkspaceRow): string | null {
  const candidates = [
    row.data?._period_end,
    row.data?._period_end_date,
    row.data?.period_end,
    row.data?.period_end_date,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.trim().length > 0);
  return typeof found === "string" ? found : null;
}

function statementPeriodMeta(row: FinancialWorkspaceRow): { primary: string; secondary: string | null; status: "verified" | "unverified" } {
  if (row.statement_type !== "balance_sheet") {
    return { primary: labelPeriod(row), secondary: row.reported_date ? `Filed ${formatDate(row.reported_date)}` : null, status: row.reported_date ? "verified" : "unverified" };
  }
  const periodEnd = periodEndDate(row);
  if (!periodEnd) {
    return { primary: labelPeriod(row), secondary: null, status: "unverified" };
  }
  return { primary: formatDate(periodEnd), secondary: labelPeriod(row), status: "verified" };
}

function completenessLabel(status: ReturnType<typeof rowCompleteness>): string {
  if (status === "Complete") return "Data complete";
  if (status === "Partial") return "Partial data";
  return "Data pending";
}

function metadataCompleteness(row: FinancialWorkspaceRow | null | undefined): "Complete" | "Partial" | "Pending" {
  if (!row) return "Pending";
  const hasSource = Boolean(row.source_url);
  const hasFiling = Boolean(row.reported_date);
  const hasPeriodEnd = row.statement_type !== "balance_sheet" || Boolean(periodEndDate(row));
  if (hasSource && hasFiling && hasPeriodEnd) return "Complete";
  if (hasSource || hasFiling || hasPeriodEnd) return "Partial";
  return "Pending";
}

function statementMetadataNote(periods: FinancialWorkspaceRow[], statement: StatementType): string | null {
  if (!periods.length) return null;
  const missingFiling = periods.some((period) => !period.reported_date);
  const missingPeriodEnd = statement === "balance_sheet" && periods.some((period) => !periodEndDate(period));
  const notes: string[] = [];
  if (missingPeriodEnd) notes.push("Balance Sheet period-end dates are not captured in the current extraction, so fiscal labels are shown without inferred dates.");
  if (missingFiling) notes.push("Filing dates are not captured for every period; source links remain available where provided.");
  return notes.length ? notes.join(" ") : null;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function value(row: FinancialWorkspaceRow | null | undefined, key: string): number | null {
  if (!row) return null;
  if (key === "gross_margin") return margin(row, "gross_profit");
  if (key === "operating_margin") return margin(row, "operating_profit");
  if (key === "net_margin") return margin(row, "profit_after_tax");
  if (key === "working_capital") return calc(row, "current_assets", "current_liabilities", (a, b) => a - b);
  if (key === "current_ratio") return calc(row, "current_assets", "current_liabilities", (a, b) => (b !== 0 ? a / b : null));
  if (key === "debt_to_equity") return calc(row, "borrowings", "equity", (a, b) => (b !== 0 ? a / b : null));
  if (key === "net_debt") return calc(row, "borrowings", "cash_and_equivalents", (a, b) => a - b);
  if (key === "net_debt_to_equity") {
    const netDebt = value(row, "net_debt");
    const equity = raw(row, "equity");
    return netDebt !== null && equity ? netDebt / equity : null;
  }
  if (key === "free_cash_flow") {
    const ocf = raw(row, "operating_cash_flow");
    const capex = raw(row, "capex");
    return ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;
  }
  return raw(row, key);
}

function raw(row: FinancialWorkspaceRow, key: string): number | null {
  const v = row.data?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function calc(row: FinancialWorkspaceRow, a: string, b: string, fn: (a: number, b: number) => number | null): number | null {
  const av = raw(row, a);
  const bv = raw(row, b);
  return av !== null && bv !== null ? fn(av, bv) : null;
}

function margin(row: FinancialWorkspaceRow, numerator: string): number | null {
  const n = raw(row, numerator);
  const d = raw(row, "revenue");
  return n !== null && d ? (n / d) * 100 : null;
}

function compactPkrFromThousands(v: number): string {
  const rupees = v * 1000;
  const abs = Math.abs(rupees);
  if (abs >= 1_000_000_000) return `PKR ${(rupees / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `PKR ${(rupees / 1_000_000).toFixed(1)}M`;
  return `PKR ${rupees.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function formatValue(v: number | null, key: string, mode: ValueMode): string {
  if (v === null) return "Not reported";
  if (key === "net_debt" && v < 0) return formatValue(Math.abs(v), "cash_and_equivalents", mode);
  if (key === "eps") return `PKR ${v.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
  if (key.includes("margin")) return `${v.toFixed(1)}%`;
  if (key.includes("ratio") || key.includes("debt_to_equity")) return `${v.toFixed(2)}x`;
  if (mode === "compact") return compactPkrFromThousands(v);
  if (mode === "exact") return `PKR ${(v * 1000).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  if (mode === "thousands") return `PKR ${v.toLocaleString("en-PK", { maximumFractionDigits: 0 })}k`;
  if (mode === "millions") return `PKR ${(v / 1000).toLocaleString("en-PK", { maximumFractionDigits: 1 })}M`;
  return `PKR ${(v / 1_000_000).toLocaleString("en-PK", { maximumFractionDigits: 2 })}B`;
}

function displayLabel(key: string, row?: FinancialWorkspaceRow | null): string {
  if (key === "net_debt" && row && value(row, "net_debt") !== null && value(row, "net_debt")! < 0) return "Net cash";
  return LABELS[key] ?? key.replace(/_/g, " ");
}

function headerUnitLabel(mode: ValueMode): string {
  if (mode === "compact") return "PKR billions";
  if (mode === "exact") return "Exact PKR";
  if (mode === "thousands") return "PKR thousands";
  if (mode === "millions") return "PKR millions";
  return "PKR billions";
}

function changeText(key: string, latest: number | null, prior: number | null): { text: string; tone: "positive" | "negative" | "neutral"; raw: number; kind: "pct" | "pp" } | null {
  if (latest === null || prior === null || prior === 0) return null;
  if (key.includes("margin")) {
    const diff = latest - prior;
    return {
      text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pp`,
      tone: diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral",
      raw: diff,
      kind: "pp",
    };
  }
  const pct = ((latest - prior) / Math.abs(prior)) * 100;
  return {
    text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    tone: pct > 0 ? "positive" : pct < 0 ? "negative" : "neutral",
    raw: pct,
    kind: "pct",
  };
}

function previousQuarter(rows: FinancialWorkspaceRow[], latest: FinancialWorkspaceRow): FinancialWorkspaceRow | null {
  const periods = rows
    .filter((r) => r.statement_type === latest.statement_type && periodMode(r) === "quarterly" && r !== latest)
    .sort((a, b) => rank(b) - rank(a));
  return periods.find((r) => rank(r) < rank(latest)) ?? null;
}

function comparablePrior(rows: FinancialWorkspaceRow[], latest: FinancialWorkspaceRow | null): FinancialWorkspaceRow | null {
  if (!latest) return null;
  const mode = periodMode(latest);
  const period = (latest.fiscal_period ?? "").toUpperCase();
  if (mode === "quarterly") return previousQuarter(rows, latest);
  return rows
    .filter((r) => r.statement_type === latest.statement_type && periodMode(r) === mode)
    .find((r) => {
      if (r === latest || !latest.fiscal_year || r.fiscal_year !== latest.fiscal_year - 1) return false;
      return mode === "annual" || (r.fiscal_period ?? "").toUpperCase() === period;
    }) ?? null;
}

function comparisonLabel(row: FinancialWorkspaceRow | null): "YoY" | "QoQ" | "" {
  if (!row) return "";
  return periodMode(row) === "quarterly" ? "QoQ" : "YoY";
}

function changePhrase(change: ReturnType<typeof changeText>, verbUp = "rose", verbDown = "declined"): string | null {
  if (!change) return null;
  const amount = change.kind === "pp" ? `${Math.abs(change.raw).toFixed(1)} percentage points` : `${Math.abs(change.raw).toFixed(1)}%`;
  if (change.raw > 0) return `${verbUp} ${amount}`;
  if (change.raw < 0) return `${verbDown} ${amount}`;
  return "was flat";
}

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadXlsx(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Financials");
  XLSX.writeFile(workbook, name);
}

function printPdf(title: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
  const html = `<!doctype html><html><head><title>${escape(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111827}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border-bottom:1px solid #e5e7eb;padding:6px;text-align:right}th:first-child,td:first-child{text-align:left}th{color:#6b7280;text-transform:uppercase}</style></head><body><h1>${escape(title)}</h1><table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((h) => `<td>${escape(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

function statusVariant(status: string): "green" | "amber" | "red" | "blue" | "secondary" {
  if (status === "Complete") return "green";
  if (status === "Partial" || status === "Pending" || status === "Not comparable" || status === "Review") return "amber";
  if (status === "Missing") return "red";
  return "secondary";
}

function deriveDataStatus(rows: FinancialWorkspaceRow[]): "Complete" | "Partial" | "Missing" {
  if (!rows.length) return "Missing";
  const hasLowConfidence = rows.some((r) => r.confidence !== null && r.confidence < 0.7);
  const hasSparseQuarter = rows.some((r) => periodMode(r) === "quarterly" && Object.keys(r.data ?? {}).filter((k) => !k.startsWith("_")).length <= 3);
  return hasLowConfidence || hasSparseQuarter ? "Partial" : "Complete";
}

function rowCompleteness(row: FinancialWorkspaceRow, keys: string[]): "Complete" | "Partial" | "Pending" {
  const present = keys.filter((key) => value(row, key) !== null).length;
  if (present === 0) return "Pending";
  if (present < Math.min(4, keys.length)) return "Partial";
  return "Complete";
}

function sectionCompleteness(rows: FinancialWorkspaceRow[], mode: PeriodMode) {
  const incomeRows = rows.filter((r) => r.statement_type === "income_statement" && periodMode(r) === mode);
  const balanceRows = rows.filter((r) => r.statement_type === "balance_sheet" && periodMode(r) === mode);
  const cashRows = rows.filter((r) => r.statement_type === "cash_flow" && periodMode(r) === mode);
  const latestIncome = incomeRows[0] ?? null;
  const latestBalance = balanceRows[0] ?? null;
  const latestCash = cashRows[0] ?? null;
  return [
    { label: "Summary metrics", status: latestIncome ? rowCompleteness(latestIncome, ["revenue", "gross_profit", "profit_after_tax", "eps", "net_margin"]) : "Pending", impact: latestIncome ? "Headline Income Statement values are usable for the selected view." : "Headline metrics are not loaded for this view." },
    { label: "Performance trends", status: incomeRows.length >= 3 ? "Complete" : "Partial", impact: incomeRows.length >= 3 ? `Complete for ${incomeRows.slice(-1)[0] ? labelPeriod(incomeRows.slice(-1)[0]) : ""}-${labelPeriod(incomeRows[0])}.` : "Needs at least three comparable periods for a robust chart." },
    { label: "Income Statement values", status: latestIncome ? rowCompleteness(latestIncome, FULL_ROWS.income_statement) : "Pending", impact: latestIncome ? `${labelPeriod(latestIncome)} statement values are ${rowCompleteness(latestIncome, FULL_ROWS.income_statement).toLowerCase()}.` : "No selected-mode Income Statement loaded." },
    { label: "Income Statement metadata", status: metadataCompleteness(latestIncome), impact: latestIncome ? `Filing/source metadata is ${metadataCompleteness(latestIncome).toLowerCase()}.` : "No selected-mode Income Statement metadata loaded." },
    { label: "Balance Sheet values", status: latestBalance ? rowCompleteness(latestBalance, FULL_ROWS.balance_sheet) : "Pending", impact: latestBalance ? `${labelPeriod(latestBalance)} statement values are ${rowCompleteness(latestBalance, FULL_ROWS.balance_sheet).toLowerCase()}.` : "No selected-mode Balance Sheet loaded." },
    { label: "Balance Sheet metadata", status: metadataCompleteness(latestBalance), impact: latestBalance ? `Period-end/source metadata is ${metadataCompleteness(latestBalance).toLowerCase()}.` : "No selected-mode Balance Sheet metadata loaded." },
    { label: "Cash Flow values", status: latestCash ? rowCompleteness(latestCash, FULL_ROWS.cash_flow) : "Pending", impact: latestCash ? `${labelPeriod(latestCash)} values available.` : "Cash Flow history is not loaded for this view." },
  ] as const;
}

function DataStatusDetails({
  rows,
  mode,
  selectedStatus,
  overallStatus,
}: {
  rows: FinancialWorkspaceRow[];
  mode: PeriodMode;
  selectedStatus: "Complete" | "Partial" | "Pending";
  overallStatus: "Complete" | "Partial" | "Missing";
}) {
  const sections = sectionCompleteness(rows, mode);
  const affected = sections.filter((s) => s.status !== "Complete");
  return (
    <details className="relative">
      <summary className="list-none">
        <Badge variant={statusVariant(selectedStatus)} className="cursor-pointer">Selected view: {selectedStatus}</Badge>
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-[min(340px,calc(100vw-3rem))] rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
        <p className="font-semibold text-slate-950">Data status</p>
        <p className="mt-1 leading-relaxed text-muted-foreground">
          {overallStatus === "Partial" && affected.length
            ? `The selected Income Statement can be complete while other datasets remain partial. ${affected[0].label} needs attention.`
            : "The selected view has no known blocking data-quality issues."}
        </p>
        <div className="mt-3 space-y-2">
          {sections.map((section) => (
            <div key={section.label} className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <p className="font-medium text-slate-900">{section.label}</p>
                <p className="text-muted-foreground">{section.impact}</p>
              </div>
              <Badge variant={statusVariant(section.status)}>{section.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

type StatementDisplayRow = { type: "section"; label: string } | { type: "metric"; key: string };

function statementDisplayRows(statement: StatementType, keys: string[]): StatementDisplayRow[] {
  const has = (key: string) => keys.includes(key);
  const pushGroup = (out: StatementDisplayRow[], label: string, groupKeys: string[]) => {
    const visible = groupKeys.filter(has);
    if (!visible.length) return;
    out.push({ type: "section", label });
    visible.forEach((key) => out.push({ type: "metric", key }));
  };
  const out: StatementDisplayRow[] = [];
  if (statement === "balance_sheet") {
    pushGroup(out, "Current assets", ["cash_and_equivalents", "inventory", "receivables"]);
    pushGroup(out, "Assets", ["current_assets", "total_assets"]);
    pushGroup(out, "Liabilities", ["current_liabilities", "borrowings", "total_liabilities"]);
    pushGroup(out, "Equity", ["retained_earnings", "equity"]);
    pushGroup(out, "Calculated metrics", ["working_capital", "current_ratio", "debt_to_equity", "net_debt", "net_debt_to_equity"]);
  } else if (statement === "income_statement") {
    pushGroup(out, "Revenue and profit", ["revenue", "cost_of_sales", "gross_profit", "operating_expenses", "operating_profit", "finance_cost", "profit_before_tax", "tax", "profit_after_tax"]);
    pushGroup(out, "Margins", ["gross_margin", "operating_margin", "net_margin"]);
    pushGroup(out, "Per share", ["eps"]);
  } else {
    pushGroup(out, "Cash generation", ["operating_cash_flow", "capex", "free_cash_flow"]);
    pushGroup(out, "Other cash flows", ["investing_cash_flow", "financing_cash_flow", "cash_balance"]);
  }
  const used = new Set(out.flatMap((row) => row.type === "metric" ? [row.key] : []));
  const extras = keys.filter((key) => !used.has(key));
  if (extras.length) {
    out.push({ type: "section", label: "Additional source rows" });
    extras.forEach((key) => out.push({ type: "metric", key }));
  }
  return out;
}

function statementHasValues(rows: FinancialWorkspaceRow[], statement: StatementType, mode: PeriodMode): boolean {
  return rows
    .filter((r) => r.statement_type === statement && periodMode(r) === mode)
    .some((row) => FULL_ROWS[statement].some((key) => value(row, key) !== null));
}

function isTotalLike(key: string): boolean {
  return ["gross_profit", "operating_profit", "profit_after_tax", "current_assets", "current_liabilities", "total_assets", "total_liabilities", "equity", "free_cash_flow"].includes(key);
}

function isCalculatedKey(key: string): boolean {
  return ["gross_margin", "operating_margin", "net_margin", "free_cash_flow", "working_capital", "current_ratio", "debt_to_equity", "net_debt", "net_debt_to_equity"].includes(key);
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            value === option.value ? "bg-white text-slate-950 shadow-sm" : "text-muted-foreground hover:text-slate-950"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function trendConfig(trend: TrendView): { type: StatementType; keys: string[] } {
  if (trend === "cash") return { type: "cash_flow", keys: ["operating_cash_flow", "capex", "free_cash_flow"] };
  if (trend === "balance") return { type: "balance_sheet", keys: ["cash_and_equivalents", "borrowings", "equity", "total_liabilities"] };
  if (trend === "margins") return { type: "income_statement", keys: ["gross_margin", "operating_margin", "net_margin"] };
  if (trend === "eps") return { type: "income_statement", keys: ["eps"] };
  return { type: "income_statement", keys: ["revenue", "gross_profit", "profit_after_tax"] };
}

function buildTrendRows(
  sortedRows: FinancialWorkspaceRow[],
  mode: PeriodMode,
  trend: TrendView
): Record<string, string | number | null>[] {
  const { type, keys } = trendConfig(trend);
  return sortedRows
    .filter((r) => r.statement_type === type && periodMode(r) === mode)
    .slice(0, 8)
    .reverse()
    .map((r) => {
      const prior = comparablePrior(sortedRows, r);
      const out: Record<string, string | number | null> = {
        period: labelPeriod(r),
        source: r.source_url ?? "Official PSX financials",
        status: rowCompleteness(r, FULL_ROWS[type]),
      };
      for (const key of keys) {
        const v = value(r, key);
        out[key] = v === null ? null : key === "eps" || key.includes("margin") || key.includes("ratio") ? v : v * 1000;
        const c = changeText(key, v, value(prior, key));
        out[`${key}_change`] = c?.text ?? null;
      }
      return out;
    })
    .filter((r) => keys.some((key) => typeof r[key] === "number"));
}

export function FinancialsWorkspace({
  ticker,
  rows,
  readOnly = false,
}: {
  ticker: string;
  rows: FinancialWorkspaceRow[];
  readOnly?: boolean;
}) {
  const [mode, setMode] = useState<PeriodMode>("annual");
  const [valueMode, setValueMode] = useState<ValueMode>("compact");
  const [statement, setStatement] = useState<StatementType>("income_statement");
  const [trend, setTrend] = useState<TrendView>("profit");
  const [depth, setDepth] = useState<TableDepth>("summary");
  const [limit, setLimit] = useState<PeriodLimit>("latest4");

  const sortedRows = useMemo(() => [...rows].sort((a, b) => rank(b) - rank(a)), [rows]);
  const statementOptions = useMemo(() => {
    const options: { value: StatementType; label: string }[] = [
      { value: "income_statement", label: "Income Statement" },
      { value: "balance_sheet", label: "Balance Sheet" },
      { value: "cash_flow", label: "Cash Flow" },
    ];
    return options.filter((option) => statementHasValues(sortedRows, option.value, mode));
  }, [mode, sortedRows]);
  const activeStatement = statementOptions.some((option) => option.value === statement)
    ? statement
    : statementOptions[0]?.value ?? "income_statement";
  const trendOptions = useMemo(() => {
    const options: { value: TrendView; label: string }[] = [
      { value: "profit", label: "Revenue & profit" },
      { value: "margins", label: "Margins" },
      { value: "eps", label: "EPS" },
      { value: "cash", label: "Cash flow" },
      { value: "balance", label: "Balance sheet" },
    ];
    return options.filter((option) => buildTrendRows(sortedRows, mode, option.value).length >= 3);
  }, [mode, sortedRows]);
  const activeTrend = trendOptions.some((option) => option.value === trend)
    ? trend
    : trendOptions[0]?.value ?? null;
  const latestFiling = sortedRows[0] ?? null;
  const activeRows = sortedRows.filter((r) => periodMode(r) === mode);
  const latestIncome = sortedRows.find((r) => r.statement_type === "income_statement" && periodMode(r) === mode) ?? null;
  const latestCash = sortedRows.find((r) => r.statement_type === "cash_flow" && periodMode(r) === mode) ?? null;
  const activePeriod = latestIncome ?? activeRows[0] ?? null;
  const latestStatement = sortedRows.find((r) => r.statement_type === activeStatement && periodMode(r) === mode) ?? null;
  const statementRows = sortedRows.filter((r) => r.statement_type === activeStatement && periodMode(r) === mode);
  const visiblePeriods = (limit === "latest4" ? statementRows.slice(0, 4) : statementRows).filter(Boolean);
  const sourceUrl = latestStatement?.source_url ?? activePeriod?.source_url ?? latestFiling?.source_url ?? null;
  const updated = sortedRows.find((r) => r.updated_at)?.updated_at?.slice(0, 10) ?? null;
  const units = String(activePeriod?.data?._units ?? latestFiling?.data?._units ?? "PKR thousands");
  const dataStatus = deriveDataStatus(rows);
  const comparable = comparablePrior(sortedRows, latestStatement);
  const selectedValueStatus = latestIncome ? rowCompleteness(latestIncome, ["revenue", "gross_profit", "profit_after_tax", "eps", "net_margin"]) : "Pending";
  const otherDataPartial = dataStatus === "Partial" && selectedValueStatus === "Complete";
  const summaryKeys = ["revenue", "gross_profit", "profit_after_tax", "eps", "net_margin"];
  const modeLabel = mode === "annual" ? "Annual" : mode === "quarterly" ? "Quarterly" : "Cumulative";
  const orderedStatementKeys = depth === "summary" ? SUMMARY_ROWS[activeStatement] : FULL_ROWS[activeStatement];
  const extraStatementKeys = depth === "full"
    ? [...new Set(visiblePeriods.flatMap((period) => Object.keys(period.data ?? {})))]
      .filter((key) => !key.startsWith("_") && !orderedStatementKeys.includes(key))
    : [];
  const statementKeys = [...orderedStatementKeys, ...extraStatementKeys];
  const valueKeys = depth === "summary"
    ? statementKeys.filter((key) => visiblePeriods.some((period) => value(period, key) !== null))
    : statementKeys;
  const displayRows = statementDisplayRows(activeStatement, valueKeys);
  const showChangeColumn = Boolean(comparable && visiblePeriods[0] && valueKeys.some((key) => changeText(key, value(visiblePeriods[0], key), value(comparable, key))));
  const metadataNote = statementMetadataNote(visiblePeriods, activeStatement);
  const exactRowsForCsv = visiblePeriods.map((p) => {
    const meta = statementPeriodMeta(p);
    const out: Record<string, unknown> = { period: meta.primary, period_detail: meta.secondary, source: p.source_url, units };
    for (const key of valueKeys) out[displayLabel(key, p)] = value(p, key);
    return out;
  });
  const exportBaseName = `${ticker}-${activeStatement.replace(/_/g, "-")}-${mode}`;
  const runExport = (kind: "csv" | "xlsx" | "pdf") => {
    const rowsWithMeta = exactRowsForCsv.map((row) => ({
      ticker,
      selected_view: activePeriod ? labelPeriod(activePeriod) : modeLabel,
      mode,
      data_status: dataStatus,
      generated_at: new Date().toISOString(),
      ...row,
    }));
    if (kind === "csv") downloadCsv(`${exportBaseName}.csv`, rowsWithMeta);
    else if (kind === "xlsx") void downloadXlsx(`${exportBaseName}.xlsx`, rowsWithMeta);
    else printPdf(`${ticker} ${STATEMENT_LABELS[activeStatement]} ${modeLabel}`, rowsWithMeta);
  };

  const summaryCards = summaryKeys.map((key) => {
    const row = key === "operating_cash_flow" ? latestCash : latestIncome;
    const prior = comparablePrior(sortedRows, row);
    const latestValue = value(row, key);
    const priorValue = value(prior, key);
    const change = changeText(key, latestValue, priorValue);
    return { key, row, prior, value: latestValue, change };
  }).filter((item) => item.row && item.value !== null).slice(0, 6);

  const trendData = useMemo(() => {
    return activeTrend ? buildTrendRows(sortedRows, mode, activeTrend) : [];
  }, [activeTrend, mode, sortedRows]);

  const insights = buildInsights(sortedRows, mode, valueMode);
  const callouts = buildCallouts(sortedRows, mode);
  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="p-5 pb-3">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="text-lg">Financials</CardTitle>
              <CardDescription className="mt-1">
                <span className="font-medium text-slate-700">Selected view</span>{" "}
                {activePeriod ? `${labelPeriod(activePeriod)} · ${modeLabel} · ${headerUnitLabel(valueMode)}` : `No ${modeLabel.toLowerCase()} period`}
                {sourceUrl ? " · Official PSX source" : ""}
                {updated ? ` · Updated ${updated}` : ""}
              </CardDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <DataStatusDetails rows={rows} mode={mode} selectedStatus={selectedValueStatus} overallStatus={dataStatus} />
                {latestFiling ? (
                  <span className="text-[11px] text-muted-foreground">
                    Latest filing available: {labelPeriod(latestFiling)}
                  </span>
                ) : null}
                {otherDataPartial ? <span className="text-[11px] text-amber-700">Other datasets remain partial.</span> : null}
                <span className="text-[11px] text-muted-foreground">Displayed as {headerUnitLabel(valueMode)}; original source uses {units}.</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 xl:items-end">
              <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Mode</span>
                <Segment
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "annual", label: "Annual" },
                    { value: "quarterly", label: "Quarterly" },
                    { value: "cumulative", label: "Cumulative" },
                  ]}
                />
              </div>
              <label className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Display</span>
                <Select value={valueMode} onChange={(e) => setValueMode(e.target.value as ValueMode)} className="w-full sm:w-[170px]">
                  <option value="compact">Compact values</option>
                  <option value="exact">Exact values</option>
                  <option value="thousands">PKR thousands</option>
                  <option value="millions">PKR millions</option>
                  <option value="billions">PKR billions</option>
                </Select>
              </label>
              <div className="flex flex-col gap-2 md:hidden">
                <details className="relative">
                  <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent">
                    <MoreHorizontal className="h-3.5 w-3.5" /> Actions
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 flex w-56 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                    {!readOnly && (
                      <ActionButton
                        endpoint={`/api/stocks/${ticker}/refresh`}
                        body={{ section: "financials" }}
                        label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh financials</>}
                        variant="outline"
                        size="sm"
                      />
                    )}
                    {sourceUrl ? (
                      <Button variant="outline" size="sm" onClick={() => window.open(sourceUrl, "_blank", "noopener,noreferrer")}>
                        <ExternalLink className="h-3.5 w-3.5" /> View source
                      </Button>
                    ) : null}
                    <Select
                      aria-label="Export financials"
                      defaultValue=""
                      onChange={(e) => {
                        const next = e.target.value as "csv" | "xlsx" | "pdf" | "";
                        if (next) runExport(next);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="">Export</option>
                      <option value="csv">CSV</option>
                      <option value="xlsx">XLSX</option>
                      <option value="pdf">PDF</option>
                    </Select>
                  </div>
                </details>
              </div>
              <div className="hidden flex-col gap-2 md:flex md:flex-row md:flex-wrap md:items-center md:justify-end">
              {!readOnly && (
                <ActionButton
                  endpoint={`/api/stocks/${ticker}/refresh`}
                  body={{ section: "financials" }}
                  label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh financials</>}
                  variant="outline"
                  size="sm"
                />
              )}
              {sourceUrl ? (
                <Button variant="outline" size="sm" onClick={() => window.open(sourceUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-3.5 w-3.5" /> View source
                </Button>
              ) : null}
              <label className="flex items-center gap-2">
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                <Select
                  aria-label="Export financials"
                  defaultValue=""
                  onChange={(e) => {
                    const next = e.target.value as "csv" | "xlsx" | "pdf" | "";
                    if (next) runExport(next);
                    e.currentTarget.value = "";
                  }}
                  className="w-full sm:w-[125px]"
                >
                  <option value="">Export</option>
                  <option value="csv">CSV</option>
                  <option value="xlsx">XLSX</option>
                  <option value="pdf">PDF</option>
                </Select>
              </label>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {summaryCards.length ? summaryCards.map((item) => (
          <Card
            key={item.key}
            className={cn(
              "border-slate-200 bg-white shadow-sm",
              ["revenue", "profit_after_tax", "net_margin"].includes(item.key) && "bg-slate-50/70"
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{LABELS[item.key]}</p>
                {rowCompleteness(item.row!, FULL_ROWS[item.row!.statement_type as StatementType]) === "Partial" ? <Badge variant="amber">Partial</Badge> : null}
              </div>
              <p className={cn("mt-2 font-semibold tabular-nums text-slate-950", ["revenue", "profit_after_tax", "net_margin"].includes(item.key) ? "text-2xl" : "text-xl")}>{formatValue(item.value, item.key, valueMode)}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p
                  className={cn("text-xs font-medium", item.change?.tone === "positive" && "text-emerald-700", item.change?.tone === "negative" && "text-red-700", !item.change && "text-amber-700")}
                  title={item.change && item.prior ? `${labelPeriod(item.row!)} ${LABELS[item.key]}: ${formatValue(item.value, item.key, valueMode)}\n${labelPeriod(item.prior)} ${LABELS[item.key]}: ${formatValue(value(item.prior, item.key), item.key, valueMode)}\nChange: ${item.change.text}` : undefined}
                >
                  {item.change ? `${item.change.text} ${comparisonLabel(item.row!)}` : "No comparable period"}
                </p>
                <p className="text-[11px] text-muted-foreground">{labelPeriod(item.row!)}</p>
              </div>
            </CardContent>
          </Card>
        )) : (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4 text-sm text-amber-900">No summary metrics are available for the selected period mode.</CardContent>
          </Card>
        )}
      </div>

      {activeTrend && trendOptions.length > 0 ? (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Performance trends</CardTitle>
                <CardDescription>Charts only use the selected period mode; mixed-duration periods are excluded.</CardDescription>
              </div>
              <Segment value={activeTrend} onChange={setTrend} options={trendOptions} />
            </div>
          </CardHeader>
          <CardContent className="p-5 pt-2">
            <FinancialTrendChart trend={activeTrend} rows={trendData} valueMode={valueMode} />
          </CardContent>
        </Card>
      ) : null}

      {insights.length > 0 && (
        <div className={cn("grid gap-4", callouts.length > 0 && "lg:grid-cols-2")}>
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-base">Key takeaways</CardTitle>
              <CardDescription>Calculated only from comparable periods in the selected mode.</CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-3">
              {insights.length ? (
                <ul className="space-y-2 text-sm leading-relaxed text-slate-800">
                  {insights.map((insight) => (
                    <li key={insight} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">No comparable prior-period data loaded.</p>}
            </CardContent>
          </Card>
          {callouts.length > 0 && (
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base">Items to review</CardTitle>
                <CardDescription>Shown only when a large movement is worth reviewing alongside the source filing.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-5 pt-3">
                {callouts.map((callout) => (
                <div key={callout.text} className={cn("rounded-xl border px-3 py-2 text-sm", callout.tone === "positive" && "border-emerald-200 bg-emerald-50 text-emerald-900", callout.tone === "negative" && "border-red-200 bg-red-50 text-red-900", callout.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900", callout.tone === "neutral" && "border-slate-200 bg-slate-50 text-slate-800")}>
                  {callout.text}
                </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="p-5 pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="text-base">Source statements</CardTitle>
              <CardDescription>Full underlying PSX statement access remains available.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Statement</p>
                <Segment value={activeStatement} onChange={setStatement} options={statementOptions} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Detail</p>
                <Segment
                  value={depth}
                  onChange={setDepth}
                  options={[
                    { value: "summary", label: "Summary" },
                    { value: "full", label: "Full statement" },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Periods</p>
                <Segment
                  value={limit}
                  onChange={setLimit}
                  options={[
                    { value: "latest4", label: "Latest four" },
                    { value: "all", label: "All periods" },
                  ]}
                />
              </div>
            </div>
          </div>
          {!showChangeColumn && visiblePeriods.length > 0 ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No prior comparable {modeLabel.toLowerCase()} {STATEMENT_LABELS[activeStatement]} is loaded, so change calculations are hidden.
            </p>
          ) : null}
          {metadataNote ? (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Filing metadata: {metadataNote}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {visiblePeriods.length ? (
            <div className="scroll-touch overflow-x-auto">
              <Table className="min-w-[760px]">
                <THead>
                  <TR>
                    <TH className="sticky left-0 z-[1] bg-white">Line item</TH>
                    {visiblePeriods.map((period, i) => (
                      <TH key={`${period.statement_type}-${i}`} className={cn("text-right", i === 0 && "bg-emerald-50/80 text-emerald-800")}>
                        {(() => {
                          const meta = statementPeriodMeta(period);
                          return (
                            <>
                              <span className="block">{meta.primary}</span>
                              {meta.secondary ? (
                                <span className={cn("block text-[10px] font-normal normal-case", meta.status === "unverified" ? "text-amber-700" : "text-muted-foreground")}>{meta.secondary}</span>
                              ) : null}
                            </>
                          );
                        })()}
                        <span className="block text-[10px] font-normal normal-case text-muted-foreground">
                          {completenessLabel(rowCompleteness(period, FULL_ROWS[activeStatement]))}
                        </span>
                      </TH>
                    ))}
                    {showChangeColumn ? <TH className="text-right">Change</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {displayRows.map((row) => {
                    if (row.type === "section") {
                      return (
                        <TR key={`section-${row.label}`} className="hover:bg-transparent">
                          <TD colSpan={visiblePeriods.length + (showChangeColumn ? 2 : 1)} className="bg-slate-50 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {row.label}
                          </TD>
                        </TR>
                      );
                    }
                    const key = row.key;
                    const latestValue = value(visiblePeriods[0], key);
                    const priorValue = comparable ? value(comparable, key) : null;
                    const change = changeText(key, latestValue, priorValue);
                    const derived = isCalculatedKey(key);
                    return (
                      <TR key={key} className={cn(isTotalLike(key) && "font-semibold")}>
                        <TD className={cn("sticky left-0 z-[1] bg-white text-xs text-slate-900", isTotalLike(key) ? "font-semibold" : "font-medium")}>
                          <span title={ACCOUNTING_HINTS[key]} className={cn(ACCOUNTING_HINTS[key] && "cursor-help decoration-dotted underline-offset-2 hover:underline")}>{displayLabel(key, visiblePeriods[0])}</span>
                          {derived ? <Badge variant="secondary" className="ml-2">Calculated</Badge> : null}
                        </TD>
                        {visiblePeriods.map((period, i) => (
                          <TD key={i} className={cn("text-right text-xs tabular-nums", i === 0 && "bg-emerald-50/50 font-semibold text-slate-950", value(period, key) === null && "text-muted-foreground")}>
                            {formatValue(value(period, key), key, valueMode)}
                          </TD>
                        ))}
                        {showChangeColumn ? (
                          <TD className={cn("text-right text-xs font-semibold tabular-nums", change?.tone === "positive" && "text-emerald-700", change?.tone === "negative" && "text-red-700", !change && "text-muted-foreground")}>
                            {change ? `${change.text} ${comparisonLabel(visiblePeriods[0])}` : "—"}
                          </TD>
                        ) : null}
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          ) : (
            <div className="p-5">
              <ChartEmpty note={`${STATEMENT_LABELS[activeStatement]} data is not available for ${modeLabel.toLowerCase()} periods.`} />
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

const SERIES_COLOR: Record<string, string> = {
  revenue: INK.line,
  gross_profit: INK.up,
  profit_after_tax: INK.amber,
  gross_margin: INK.line,
  operating_margin: INK.terracotta,
  net_margin: INK.up,
  eps: INK.line,
  operating_cash_flow: "#0f7e96",
  capex: INK.amber,
  free_cash_flow: INK.up,
  cash_and_equivalents: "#0f7e96",
  borrowings: INK.amber,
  equity: INK.line,
  total_liabilities: INK.terracotta,
};

// Passed to recharts as a ReactElement (content={<TrendTooltip … />}) so recharts
// clones it with active/payload/label — matching the GlassTooltip pattern and
// avoiding the function-form ContentType variance mismatch.
function TrendTooltip({
  active,
  payload,
  label,
  percent,
  eps,
  valueMode,
  format,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: string | number | ((obj: unknown) => unknown); value?: unknown; color?: string; name?: string | number; payload?: Record<string, string | number | null> }[];
  label?: string | number;
  percent: boolean;
  eps: boolean;
  valueMode: ValueMode;
  format: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="chart-tooltip min-w-[230px]">
      <p className="chart-tooltip-label">{String(label)}</p>
      <div className="space-y-1">
        {payload.filter((p) => typeof p.value === "number").map((p) => {
          const key = String(p.dataKey ?? "");
          const rawValue = Number(p.value);
          const statementValue = percent || eps ? rawValue : rawValue / 1000;
          return (
            <div key={key} className="border-b border-slate-100 pb-1 last:border-0">
              <div className="flex items-center justify-between gap-4 text-[11px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? SERIES_COLOR[key] }} />
                  {LABELS[key] ?? key}
                </span>
                <span className="font-semibold tabular-nums">{format(rawValue)}</span>
              </div>
              {!percent && !eps ? <p className="text-[10px] text-muted-foreground">Exact: {formatValue(statementValue, key, valueMode)}</p> : null}
              {row?.[`${key}_change`] ? <p className="text-[10px] text-muted-foreground">{row[`${key}_change`]} versus prior comparable period</p> : null}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">{row?.source ?? "Official PSX financials"} · {row?.status ?? "Status pending"}</p>
    </div>
  );
}

function trendSeriesKeys(trend: TrendView): string[] {
  if (trend === "profit") return ["revenue", "gross_profit", "profit_after_tax"];
  if (trend === "margins") return ["gross_margin", "operating_margin", "net_margin"];
  if (trend === "eps") return ["eps"];
  if (trend === "cash") return ["operating_cash_flow", "capex", "free_cash_flow"];
  return ["cash_and_equivalents", "borrowings", "equity", "total_liabilities"];
}

function FinancialTrendChart({ trend, rows, valueMode }: { trend: TrendView; rows: Record<string, string | number | null>[]; valueMode: ValueMode }) {
  if (rows.length < 3) return <ChartEmpty note="Insufficient comparable periods for a reliable chart." height={280} />;
  const percent = trend === "margins";
  const eps = trend === "eps";
  const keys = trendSeriesKeys(trend).filter((key) => rows.some((row) => typeof row[key] === "number"));
  const format = (v: number) => percent ? `${v.toFixed(1)}%` : eps ? `PKR ${v.toFixed(2)}` : `PKR ${fmtCompact(v)}`;
  const tooltip = <TrendTooltip percent={percent} eps={eps} valueMode={valueMode} format={format} />;
  if (trend === "profit" || trend === "cash" || trend === "balance") {
    return (
      <ResponsiveContainer width="100%" height={310}>
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis dataKey="period" tick={{ ...AXIS_TICK, fontSize: 11.5, fill: "#344054" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ ...AXIS_TICK, fontSize: 11.5, fill: "#344054" }} tickFormatter={(v) => format(Number(v))} axisLine={false} tickLine={false} width={72} />
          <Tooltip content={tooltip} cursor={{ fill: "rgba(0,0,0,0.035)" }} />
          <Legend wrapperStyle={{ fontSize: 12.5, color: "#1f2937" }} iconType="circle" iconSize={8} />
          {keys.map((key, i) => (
            <Bar key={key} dataKey={key} name={LABELS[key] ?? key} fill={SERIES_COLOR[key] ?? [INK.line, INK.up, INK.amber, INK.terracotta][i % 4]} radius={[4, 4, 0, 0]} maxBarSize={34} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={310}>
      <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <FadeDefs defs={[{ id: "financialTrend", color: INK.line, from: 0.18, to: 0.02 }]} />
        <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
        <XAxis dataKey="period" tick={{ ...AXIS_TICK, fontSize: 11.5, fill: "#344054" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ ...AXIS_TICK, fontSize: 11.5, fill: "#344054" }} tickFormatter={(v) => format(Number(v))} axisLine={false} tickLine={false} width={72} />
        <Tooltip content={tooltip} cursor={CURSOR} />
        <Legend wrapperStyle={{ fontSize: 12.5, color: "#1f2937" }} iconType="circle" iconSize={8} />
        {keys.map((key, i) => (
          i === 0 ? (
            <Area key={key} type="monotone" dataKey={key} name={LABELS[key] ?? key} stroke={SERIES_COLOR[key] ?? INK.line} fill="url(#financialTrend)" strokeWidth={2} dot={false} />
          ) : (
            <Line key={key} type="monotone" dataKey={key} name={LABELS[key] ?? key} stroke={SERIES_COLOR[key] ?? [INK.up, INK.amber, INK.terracotta][i % 3]} strokeWidth={2} dot={false} />
          )
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function buildInsights(rows: FinancialWorkspaceRow[], mode: PeriodMode, valueMode: ValueMode): string[] {
  const latest = rows.find((r) => r.statement_type === "income_statement" && periodMode(r) === mode) ?? null;
  const prior = comparablePrior(rows, latest);
  const insights: string[] = [];
  if (latest && prior) {
    const revenue = changeText("revenue", value(latest, "revenue"), value(prior, "revenue"));
    const grossProfit = changeText("gross_profit", value(latest, "gross_profit"), value(prior, "gross_profit"));
    const pat = changeText("profit_after_tax", value(latest, "profit_after_tax"), value(prior, "profit_after_tax"));
    const grossMargin = changeText("gross_margin", value(latest, "gross_margin"), value(prior, "gross_margin"));
    const netMargin = changeText("net_margin", value(latest, "net_margin"), value(prior, "net_margin"));
    if (revenue && pat) {
      const revenuePhrase = changePhrase(revenue, "rose", "fell");
      const patPhrase = changePhrase(pat, "increased", "declined");
      if (revenuePhrase && patPhrase) insights.push(`${labelPeriod(latest)} revenue ${revenuePhrase}, while profit after tax ${patPhrase}.`);
    }
    if (grossProfit) {
      const phrase = changePhrase(grossProfit, "rose", "declined");
      if (phrase) insights.push(`Gross profit ${phrase} to ${formatValue(value(latest, "gross_profit"), "gross_profit", valueMode)}.`);
    }
    if (grossMargin) {
      const phrase = changePhrase(grossMargin, "expanded", "contracted");
      if (phrase) insights.push(`Gross margin ${phrase} to ${formatValue(value(latest, "gross_margin"), "gross_margin", valueMode)}.`);
    }
    if (netMargin) {
      const phrase = changePhrase(netMargin, "expanded", "contracted");
      if (phrase) insights.push(`Net margin ${phrase} to ${formatValue(value(latest, "net_margin"), "net_margin", valueMode)}.`);
    }
  }
  const balance = rows.find((r) => r.statement_type === "balance_sheet" && periodMode(r) === mode) ?? null;
  const balancePrior = comparablePrior(rows, balance);
  if (balance && balancePrior) {
    const equity = changeText("equity", value(balance, "equity"), value(balancePrior, "equity"));
    const liabilities = changeText("total_liabilities", value(balance, "total_liabilities"), value(balancePrior, "total_liabilities"));
    if (equity || liabilities) insights.push(`Balance sheet: equity ${equity ? changePhrase(equity, "increased", "declined") : "was not comparable"} and total liabilities ${liabilities ? changePhrase(liabilities, "increased", "declined") : "were not comparable"}.`);
  }
  const cash = rows.find((r) => r.statement_type === "cash_flow" && periodMode(r) === mode) ?? null;
  if (cash) {
    const ocf = value(cash, "operating_cash_flow");
    const pat = latest ? value(latest, "profit_after_tax") : null;
    if (ocf !== null && pat !== null && pat !== 0) insights.push(`Operating cash flow equals ${(ocf / Math.abs(pat)).toFixed(1)}x profit after tax for ${labelPeriod(cash)}.`);
    const fcf = value(cash, "free_cash_flow");
    if (fcf !== null) insights.push(`Free cash flow is ${formatValue(fcf, "free_cash_flow", valueMode)} after capital expenditure treatment.`);
  }
  return insights.slice(0, 5);
}

function buildCallouts(rows: FinancialWorkspaceRow[], mode: PeriodMode): { text: string; tone: "positive" | "negative" | "warning" | "neutral" }[] {
  const out: { text: string; tone: "positive" | "negative" | "warning" | "neutral" }[] = [];
  const latestBalance = rows.find((r) => r.statement_type === "balance_sheet" && periodMode(r) === mode) ?? null;
  const latestCash = rows.find((r) => r.statement_type === "cash_flow" && periodMode(r) === mode) ?? null;
  const checks: [FinancialWorkspaceRow | null, string, string, string][] = [
    [latestBalance, "inventory", "Inventory changed materially.", "This may reflect working-capital improvement or lower stock requirements; further context is needed."],
    [latestBalance, "borrowings", "Borrowings changed sharply.", "Review debt notes and financing activity before judging the move."],
    [latestBalance, "cash_and_equivalents", "Cash changed sharply.", "Check operating cash generation, capex, dividends, and financing flows."],
    [latestCash, "operating_cash_flow", "Operating cash flow changed sharply.", "Compare against profit after tax and working-capital movements."],
  ];
  for (const [row, key, label, context] of checks) {
    const prior = comparablePrior(rows, row);
    const change = changeText(key, value(row, key), value(prior, key));
    if (!change) continue;
    const magnitude = Math.abs(Number(change.text.replace(/[^0-9.-]/g, "")));
    if (magnitude < (key.includes("margin") ? 3 : 25)) continue;
    out.push({
      text: `${label} ${change.text} ${comparisonLabel(row)}. ${context}`,
      tone: "neutral",
    });
  }
  return out.slice(0, 3);
}
