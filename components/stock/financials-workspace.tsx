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
import { AXIS_TICK, ChartEmpty, CURSOR, FadeDefs, GlassTooltip, INK, fmtCompact } from "@/components/chart-kit";
import { cn } from "@/lib/utils";
import { AlertTriangle, Download, ExternalLink, RefreshCw } from "lucide-react";

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
  cash_balance: "Cash movement - definition under review",
};
const ACCOUNTING_HINTS: Record<string, string> = {
  gross_margin: "Gross profit divided by revenue. Shown as percentage points when compared.",
  operating_margin: "Operating profit divided by revenue. Shown as percentage points when compared.",
  net_margin: "Profit after tax divided by revenue. Shown as percentage points when compared.",
  eps: "Earnings per share in PKR. Not scaled with statement units.",
  capex: "Shown as capital expenditure outflow for free-cash-flow analysis; source sign conventions can vary.",
  cash_balance: "Definition needs source verification before this can be treated as ending cash balance.",
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

function labelPeriod(row: FinancialWorkspaceRow, includeDate = false): string {
  const fy = row.fiscal_year ? `FY${row.fiscal_year}` : "FY?";
  const p = (row.fiscal_period ?? "").toUpperCase();
  const period = row.period_type === "annual" || p === "FY" ? fy : `${p || "Period"} ${fy}`;
  if (!includeDate || !row.reported_date) return period;
  return `${formatDate(row.reported_date)} · ${period}`;
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
  if (key === "eps") return `PKR ${v.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
  if (key.includes("margin")) return `${v.toFixed(1)}%`;
  if (key.includes("ratio") || key.includes("debt_to_equity")) return `${v.toFixed(2)}x`;
  if (mode === "compact") return compactPkrFromThousands(v);
  if (mode === "exact") return `PKR ${(v * 1000).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  if (mode === "thousands") return `PKR ${v.toLocaleString("en-PK", { maximumFractionDigits: 0 })}k`;
  if (mode === "millions") return `PKR ${(v / 1000).toLocaleString("en-PK", { maximumFractionDigits: 1 })}M`;
  return `PKR ${(v / 1_000_000).toLocaleString("en-PK", { maximumFractionDigits: 2 })}B`;
}

function changeText(key: string, latest: number | null, prior: number | null): { text: string; tone: "positive" | "negative" | "neutral" } | null {
  if (latest === null || prior === null || prior === 0) return null;
  if (key.includes("margin")) {
    const diff = latest - prior;
    return {
      text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pp`,
      tone: diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral",
    };
  }
  const pct = ((latest - prior) / Math.abs(prior)) * 100;
  return {
    text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    tone: pct > 0 ? "positive" : pct < 0 ? "negative" : "neutral",
  };
}

function comparablePrior(rows: FinancialWorkspaceRow[], latest: FinancialWorkspaceRow | null): FinancialWorkspaceRow | null {
  if (!latest) return null;
  const mode = periodMode(latest);
  const period = (latest.fiscal_period ?? "").toUpperCase();
  return rows
    .filter((r) => r.statement_type === latest.statement_type && periodMode(r) === mode)
    .find((r) => {
      if (r === latest || !latest.fiscal_year || r.fiscal_year !== latest.fiscal_year - 1) return false;
      return mode === "annual" || (r.fiscal_period ?? "").toUpperCase() === period;
    }) ?? null;
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

function statusVariant(status: string): "green" | "amber" | "red" | "blue" | "secondary" {
  if (status === "Complete") return "green";
  if (status === "Partial" || status === "Not comparable" || status === "Unverified") return "amber";
  if (status === "Missing") return "red";
  return "secondary";
}

function deriveDataStatus(rows: FinancialWorkspaceRow[]): "Complete" | "Partial" | "Missing" {
  if (!rows.length) return "Missing";
  const hasLowConfidence = rows.some((r) => r.confidence !== null && r.confidence < 0.7);
  const hasSparseQuarter = rows.some((r) => periodMode(r) === "quarterly" && Object.keys(r.data ?? {}).filter((k) => !k.startsWith("_")).length <= 3);
  const hasCashReview = rows.some((r) => r.statement_type === "cash_flow" && raw(r, "cash_balance") !== null);
  return hasLowConfidence || hasSparseQuarter || hasCashReview ? "Partial" : "Complete";
}

function rowCompleteness(row: FinancialWorkspaceRow, keys: string[]): "Complete" | "Partial" | "Unavailable" {
  const present = keys.filter((key) => value(row, key) !== null).length;
  if (present === 0) return "Unavailable";
  if (present < Math.min(4, keys.length)) return "Partial";
  return "Complete";
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
  const latest = sortedRows[0] ?? null;
  const latestIncome = sortedRows.find((r) => r.statement_type === "income_statement" && periodMode(r) === mode) ?? null;
  const latestCash = sortedRows.find((r) => r.statement_type === "cash_flow" && periodMode(r) === mode) ?? null;
  const latestStatement = sortedRows.find((r) => r.statement_type === statement && periodMode(r) === mode) ?? null;
  const statementRows = sortedRows.filter((r) => r.statement_type === statement && periodMode(r) === mode);
  const visiblePeriods = (limit === "latest4" ? statementRows.slice(0, 4) : statementRows).filter(Boolean);
  const sourceUrl = latestStatement?.source_url ?? latest?.source_url ?? null;
  const updated = sortedRows.find((r) => r.updated_at)?.updated_at?.slice(0, 10) ?? "Unavailable";
  const units = String(latest?.data?._units ?? "PKR thousands");
  const dataStatus = deriveDataStatus(rows);
  const comparable = comparablePrior(sortedRows, latestStatement);
  const summaryKeys = ["revenue", "gross_profit", "profit_after_tax", "eps", "net_margin", "operating_cash_flow"];
  const modeLabel = mode === "annual" ? "Annual" : mode === "quarterly" ? "Standalone quarterly" : "Cumulative";
  const orderedStatementKeys = depth === "summary" ? SUMMARY_ROWS[statement] : FULL_ROWS[statement];
  const extraStatementKeys = depth === "full"
    ? [...new Set(visiblePeriods.flatMap((period) => Object.keys(period.data ?? {})))]
      .filter((key) => !key.startsWith("_") && !orderedStatementKeys.includes(key))
    : [];
  const statementKeys = [...orderedStatementKeys, ...extraStatementKeys];
  const hasAnnualCashFlow = rows.some((r) => r.statement_type === "cash_flow" && periodMode(r) === "annual");
  const hasCashBalanceReview = rows.some((r) => r.statement_type === "cash_flow" && raw(r, "cash_balance") !== null);
  const hasSparseQuarter = rows.some((r) => r.statement_type === "income_statement" && periodMode(r) === "quarterly" && rowCompleteness(r, FULL_ROWS.income_statement) === "Partial");
  const missingComparable = latestStatement && !comparable;
  const exactRowsForCsv = visiblePeriods.map((p) => {
    const out: Record<string, unknown> = { period: labelPeriod(p, statement === "balance_sheet") };
    for (const key of statementKeys) out[LABELS[key] ?? key] = value(p, key);
    return out;
  });

  const summaryCards = summaryKeys.map((key) => {
    const row = key === "operating_cash_flow" ? latestCash : latestIncome;
    const prior = comparablePrior(sortedRows, row);
    const latestValue = value(row, key);
    const priorValue = value(prior, key);
    const change = changeText(key, latestValue, priorValue);
    return { key, row, value: latestValue, change };
  }).filter((item) => item.row && item.value !== null).slice(0, 6);

  const trendData = useMemo(() => {
    const type: StatementType = trend === "cash" ? "cash_flow" : trend === "balance" ? "balance_sheet" : "income_statement";
    const keys =
      trend === "profit" ? ["revenue", "gross_profit", "profit_after_tax"] :
      trend === "margins" ? ["gross_margin", "operating_margin", "net_margin"] :
      trend === "eps" ? ["eps"] :
      trend === "cash" ? ["operating_cash_flow", "capex", "free_cash_flow"] :
      ["cash_and_equivalents", "borrowings", "equity", "total_liabilities"];
    return sortedRows
      .filter((r) => r.statement_type === type && periodMode(r) === mode)
      .slice(0, 8)
      .reverse()
      .map((r) => {
        const out: Record<string, string | number | null> = { period: labelPeriod(r, type === "balance_sheet") };
        for (const key of keys) {
          const v = value(r, key);
          out[key] = v === null ? null : key === "eps" || key.includes("margin") || key.includes("ratio") ? v : v * 1000;
        }
        return out;
      })
      .filter((r) => keys.some((key) => typeof r[key] === "number"));
  }, [mode, sortedRows, trend]);

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
                {latest ? labelPeriod(latest, latest.statement_type === "balance_sheet") : "No period"} · {units} · Standalone/consolidated status unverified
              </CardDescription>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant={statusVariant(dataStatus)}>Data status: {dataStatus}</Badge>
                <Badge variant="secondary">{modeLabel}</Badge>
                <Badge variant="secondary">Updated {updated}</Badge>
                {sourceUrl ? <Badge variant="blue">Official PSX source</Badge> : <Badge variant="amber">Source unavailable</Badge>}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Segment
                value={mode}
                onChange={setMode}
                options={[
                  { value: "annual", label: "Annual" },
                  { value: "quarterly", label: "Quarterly" },
                  { value: "cumulative", label: "Cumulative" },
                ]}
              />
              <Select value={valueMode} onChange={(e) => setValueMode(e.target.value as ValueMode)} className="w-full sm:w-[150px]">
                <option value="compact">Compact</option>
                <option value="exact">Exact</option>
                <option value="thousands">PKR thousands</option>
                <option value="millions">PKR millions</option>
                <option value="billions">PKR billions</option>
              </Select>
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
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`${ticker}-financials-${mode}.csv`, exactRowsForCsv)}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {summaryCards.length ? summaryCards.map((item) => (
          <Card key={item.key} className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{LABELS[item.key]}</p>
                {rowCompleteness(item.row!, FULL_ROWS[item.row!.statement_type as StatementType]) === "Partial" ? <Badge variant="amber">Partial</Badge> : null}
              </div>
              <p className="mt-2 text-xl font-semibold tabular-nums text-slate-950">{formatValue(item.value, item.key, valueMode)}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className={cn("text-xs font-medium", item.change?.tone === "positive" && "text-emerald-700", item.change?.tone === "negative" && "text-red-700", !item.change && "text-amber-700")}>
                  {item.change ? item.change.text : "No comparable period"}
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

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="p-5 pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Performance trends</CardTitle>
              <CardDescription>Charts only use the selected period mode; mixed-duration periods are excluded.</CardDescription>
            </div>
            <Segment
              value={trend}
              onChange={setTrend}
              options={[
                { value: "profit", label: "Revenue & profit" },
                { value: "margins", label: "Margins" },
                { value: "eps", label: "EPS" },
                { value: "cash", label: "Cash flow" },
                { value: "balance", label: "Balance sheet" },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-2">
          <FinancialTrendChart trend={trend} rows={trendData} />
          {trendData.length < 3 ? (
            <p className="mt-3 text-xs text-amber-700">At least three reliable comparable periods are needed for a stronger trend read.</p>
          ) : null}
        </CardContent>
      </Card>

      {(insights.length > 0 || callouts.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-base">Material insights</CardTitle>
              <CardDescription>Calculated only from comparable periods in the selected mode.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-5 pt-3">
              {insights.length ? insights.map((insight) => (
                <p key={insight} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-800">{insight}</p>
              )) : <p className="text-sm text-muted-foreground">Comparable prior-period data unavailable.</p>}
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-base">Notable changes</CardTitle>
              <CardDescription>Large movements are flagged for review, not automatically judged.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-5 pt-3">
              {callouts.length ? callouts.map((callout) => (
                <div key={callout.text} className={cn("rounded-xl border px-3 py-2 text-sm", callout.tone === "positive" && "border-emerald-200 bg-emerald-50 text-emerald-900", callout.tone === "negative" && "border-red-200 bg-red-50 text-red-900", callout.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900", callout.tone === "neutral" && "border-slate-200 bg-slate-50 text-slate-800")}>
                  {callout.text}
                </div>
              )) : <p className="text-sm text-muted-foreground">No material comparable changes detected.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="p-5 pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="text-base">Source statements</CardTitle>
              <CardDescription>Full underlying PSX statement access remains available.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Segment
                value={statement}
                onChange={setStatement}
                options={[
                  { value: "income_statement", label: "Income Statement" },
                  { value: "balance_sheet", label: "Balance Sheet" },
                  { value: "cash_flow", label: "Cash Flow" },
                ]}
              />
              <Segment
                value={depth}
                onChange={setDepth}
                options={[
                  { value: "summary", label: "Summary" },
                  { value: "full", label: "Full statement" },
                ]}
              />
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
                        {labelPeriod(period, statement === "balance_sheet")}
                        <span className="block text-[10px] font-normal normal-case text-muted-foreground">
                          {rowCompleteness(period, FULL_ROWS[statement])}
                        </span>
                      </TH>
                    ))}
                    <TH className="text-right">Change</TH>
                  </TR>
                </THead>
                <TBody>
                  {statementKeys.map((key) => {
                    const latestValue = value(visiblePeriods[0], key);
                    const priorValue = comparable ? value(comparable, key) : null;
                    const change = changeText(key, latestValue, priorValue);
                    const derived = ["gross_margin", "operating_margin", "net_margin", "free_cash_flow", "working_capital", "current_ratio", "debt_to_equity", "net_debt", "net_debt_to_equity"].includes(key);
                    return (
                      <TR key={key}>
                        <TD className="sticky left-0 z-[1] bg-white text-xs font-medium text-slate-900">
                          <span title={ACCOUNTING_HINTS[key]} className={cn(ACCOUNTING_HINTS[key] && "cursor-help underline decoration-dotted underline-offset-2")}>{LABELS[key] ?? key.replace(/_/g, " ")}</span>
                          {derived ? <Badge variant="secondary" className="ml-2">Calculated</Badge> : null}
                          {key === "cash_balance" ? <Badge variant="amber" className="ml-2">Unverified</Badge> : null}
                        </TD>
                        {visiblePeriods.map((period, i) => (
                          <TD key={i} className={cn("text-right text-xs tabular-nums", i === 0 && "bg-emerald-50/50 font-semibold text-slate-950", value(period, key) === null && "text-muted-foreground")}>
                            {formatValue(value(period, key), key, valueMode)}
                          </TD>
                        ))}
                        <TD className={cn("text-right text-xs font-semibold tabular-nums", change?.tone === "positive" && "text-emerald-700", change?.tone === "negative" && "text-red-700", !change && "text-amber-700")}>
                          {change ? change.text : "Not comparable"}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          ) : (
            <div className="p-5">
              <ChartEmpty note={`${STATEMENT_LABELS[statement]} data is not available for ${modeLabel.toLowerCase()} periods.`} />
            </div>
          )}
        </CardContent>
      </Card>

      {(hasSparseQuarter || missingComparable || hasCashBalanceReview || !hasAnnualCashFlow) && (
        <Card className="border-amber-200 bg-amber-50 shadow-sm">
          <CardHeader className="p-5 pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-950"><AlertTriangle className="h-4 w-4" /> Data-quality notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-5 pt-2 text-sm text-amber-900">
            {hasSparseQuarter ? <p>Quarterly data is partially available. Revenue and EPS may be present while full Income Statement detail is only available for cumulative H1 or 9M periods.</p> : null}
            {missingComparable ? <p>Comparable prior-period data unavailable for the selected statement and period mode. Growth rates are intentionally suppressed.</p> : null}
            {hasCashBalanceReview ? <p>Cash Flow field “Cash movement - definition under review” requires source verification before it can be treated as ending cash balance.</p> : null}
            {!hasAnnualCashFlow ? <p>Annual Cash Flow history is not available from the current source.</p> : null}
            <p>Standalone versus consolidated status is not confirmed in the extracted dataset and is shown as unverified.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FinancialTrendChart({ trend, rows }: { trend: TrendView; rows: Record<string, string | number | null>[] }) {
  if (rows.length < 3) return <ChartEmpty note="Insufficient comparable periods for a reliable chart." height={280} />;
  const percent = trend === "margins";
  const eps = trend === "eps";
  const keys = Object.keys(rows[0]).filter((key) => key !== "period");
  const format = (v: number) => percent ? `${v.toFixed(1)}%` : eps ? `PKR ${v.toFixed(2)}` : `PKR ${fmtCompact(v)}`;
  if (trend === "profit" || trend === "cash" || trend === "balance") {
    return (
      <ResponsiveContainer width="100%" height={310}>
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis dataKey="period" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickFormatter={(v) => format(Number(v))} axisLine={false} tickLine={false} width={64} />
          <Tooltip content={<GlassTooltip format={(v) => format(v)} />} cursor={{ fill: "rgba(0,0,0,0.035)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
          {keys.map((key, i) => (
            <Bar key={key} dataKey={key} name={LABELS[key] ?? key} fill={[INK.line, INK.up, INK.amber, INK.terracotta][i % 4]} radius={[4, 4, 0, 0]} maxBarSize={34} />
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
        <XAxis dataKey="period" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} tickFormatter={(v) => format(Number(v))} axisLine={false} tickLine={false} width={64} />
        <Tooltip content={<GlassTooltip format={(v) => format(v)} />} cursor={CURSOR} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
        {keys.map((key, i) => (
          i === 0 ? (
            <Area key={key} type="monotone" dataKey={key} name={LABELS[key] ?? key} stroke={INK.line} fill="url(#financialTrend)" strokeWidth={2} dot={false} />
          ) : (
            <Line key={key} type="monotone" dataKey={key} name={LABELS[key] ?? key} stroke={[INK.up, INK.amber, INK.terracotta][i % 3]} strokeWidth={2} dot={false} />
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
    const pat = changeText("profit_after_tax", value(latest, "profit_after_tax"), value(prior, "profit_after_tax"));
    const netMargin = changeText("net_margin", value(latest, "net_margin"), value(prior, "net_margin"));
    if (revenue && pat) insights.push(`${labelPeriod(latest)} revenue changed ${revenue.text}, while profit after tax changed ${pat.text} versus the comparable prior period.`);
    if (netMargin) insights.push(`Net profit margin ${netMargin.tone === "positive" ? "expanded" : netMargin.tone === "negative" ? "contracted" : "was flat"} by ${netMargin.text.replace("+", "")}.`);
  }
  const balance = rows.find((r) => r.statement_type === "balance_sheet" && periodMode(r) === mode) ?? null;
  const balancePrior = comparablePrior(rows, balance);
  if (balance && balancePrior) {
    const equity = changeText("equity", value(balance, "equity"), value(balancePrior, "equity"));
    const liabilities = changeText("total_liabilities", value(balance, "total_liabilities"), value(balancePrior, "total_liabilities"));
    if (equity || liabilities) insights.push(`Balance sheet comparison: equity ${equity?.text ?? "not comparable"} and total liabilities ${liabilities?.text ?? "not comparable"} versus the equivalent prior period.`);
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
  const latestIncome = rows.find((r) => r.statement_type === "income_statement" && periodMode(r) === mode) ?? null;
  const latestBalance = rows.find((r) => r.statement_type === "balance_sheet" && periodMode(r) === mode) ?? null;
  const latestCash = rows.find((r) => r.statement_type === "cash_flow" && periodMode(r) === mode) ?? null;
  const checks: [FinancialWorkspaceRow | null, string, string, string][] = [
    [latestIncome, "gross_margin", "Gross margin moved materially.", "Margin expansion or contraction should be checked against pricing, cost of sales, and volume mix."],
    [latestBalance, "inventory", "Inventory changed materially.", "This may reflect working-capital improvement or lower stock requirements; further context is needed."],
    [latestBalance, "borrowings", "Borrowings changed materially.", "Review debt notes and financing activity before judging the move."],
    [latestBalance, "cash_and_equivalents", "Cash changed materially.", "Check operating cash generation, capex, dividends, and financing flows."],
    [latestCash, "operating_cash_flow", "Operating cash flow moved materially.", "Compare against profit after tax and working-capital movements."],
  ];
  for (const [row, key, label, context] of checks) {
    const prior = comparablePrior(rows, row);
    const change = changeText(key, value(row, key), value(prior, key));
    if (!change) continue;
    const magnitude = Math.abs(Number(change.text.replace(/[^0-9.-]/g, "")));
    if (magnitude < (key.includes("margin") ? 3 : 25)) continue;
    out.push({
      text: `${label} ${change.text} versus the comparable prior period. ${context}`,
      tone: key === "gross_margin" ? (change.tone === "positive" ? "positive" : "negative") : "neutral",
    });
  }
  return out.slice(0, 5);
}
