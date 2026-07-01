"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/action-button";
import { AXIS_TICK, CURSOR, fmtCompact } from "@/components/chart-kit";
import { cn } from "@/lib/utils";
import { AlertTriangle, ExternalLink, RefreshCw, FileText, Info, TrendingUp, Presentation, Clock, CheckCircle2 } from "lucide-react";
import type { FinancialWorkspaceRow } from "@/components/stock/financials-workspace";
import type { Filing } from "@/lib/company/types";

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

type PeriodMode = "annual" | "quarterly" | "cumulative";
type ValueMode = "compact" | "exact";
type TrendView = "profit" | "eps" | "margins" | "drivers";
type Status = "Complete" | "Partial" | "Unavailable";
type SummaryCardItem = {
  key: string;
  label: string;
  metricKey: string;
  val: number | null;
  priorVal: number | null;
  isMargin?: boolean;
};
type EarningsEvent = {
  id: string;
  period: string;
  date: string | null;
  sourceUrl: string | null;
  primary: Filing | null;
  related: Filing[];
};
type ChartClickEvent = {
  activePayload?: Array<{
    payload?: {
      id?: string;
    };
  }>;
};

const PERIOD_ORDER: Record<string, number> = { Q1: 1, Q2: 2, H1: 2, Q3: 3, "9M": 3, Q4: 4, FY: 4 };
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rank(row: FinancialWorkspaceRow): number {
  const p = (row.fiscal_period ?? "").toUpperCase();
  return (row.fiscal_year ?? 0) * 10 + (PERIOD_ORDER[p] ?? 0);
}

function rowMode(row: FinancialWorkspaceRow): PeriodMode {
  const p = (row.fiscal_period ?? "").toUpperCase();
  if (row.period_type === "annual" || p === "FY") return "annual";
  if (/^Q[1-4]$/.test(p)) return "quarterly";
  return "cumulative";
}

function labelPeriod(row: FinancialWorkspaceRow | null): string {
  if (!row) return "—";
  const fy = row.fiscal_year ? `FY${row.fiscal_year}` : "FY?";
  const p = (row.fiscal_period ?? "").toUpperCase();
  return row.period_type === "annual" || p === "FY" ? fy : `${p} ${fy}`;
}

function raw(row: FinancialWorkspaceRow | null | undefined, key: string): number | null {
  if (!row) return null;
  const v = row.data?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function margin(row: FinancialWorkspaceRow | null | undefined, numKey: string): number | null {
  const n = raw(row, numKey);
  const d = raw(row, "revenue");
  return n !== null && d ? (n / d) * 100 : null;
}

function value(row: FinancialWorkspaceRow | null | undefined, key: string): number | null {
  if (!row) return null;
  if (key === "gross_margin") return margin(row, "gross_profit");
  if (key === "operating_margin") return margin(row, "operating_profit");
  if (key === "net_margin") return margin(row, "profit_after_tax");
  return raw(row, key);
}

function resultValueStatus(row: FinancialWorkspaceRow | null): Status {
  if (!row) return "Unavailable";
  const essentials = ["revenue", "profit_after_tax", "eps"];
  const present = essentials.filter((key) => value(row, key) !== null).length;
  if (present === essentials.length) return "Complete";
  if (present > 0) return "Partial";
  return "Unavailable";
}

function resultMetadataStatus(row: FinancialWorkspaceRow | null): Status {
  if (!row) return "Unavailable";
  const fields = [row.reported_date, row.fiscal_year, row.fiscal_period ?? row.period_type];
  const present = fields.filter(Boolean).length;
  if (present === fields.length) return "Complete";
  if (present > 0) return "Partial";
  return "Unavailable";
}

function statusVariant(status: Status): "green" | "amber" | "red" {
  if (status === "Complete") return "green";
  if (status === "Partial") return "amber";
  return "red";
}

function comparisonShortLabel(comparison: "YoY" | "QoQ"): string {
  return comparison === "YoY" ? "YoY" : "QoQ";
}

function statusText(kind: "values" | "metadata" | "source", status: Status): string {
  if (kind === "values") {
    if (status === "Complete") return "Core values complete";
    if (status === "Partial") return "Core values partial";
    return "Core values unavailable";
  }
  if (kind === "metadata") {
    if (status === "Complete") return "Announcement details complete";
    if (status === "Partial") return "Announcement details incomplete";
    return "Announcement details unavailable";
  }
  if (status === "Complete") return "Official source verified";
  if (status === "Partial") return "Source partially verified";
  return "Official source unavailable";
}

function changeSentence(label: string, change: ReturnType<typeof changeInfo> | null, comparison: "YoY" | "QoQ"): string | null {
  if (!change) return null;
  const verb = change.raw > 0 ? "rose" : change.raw < 0 ? "fell" : "was flat";
  return `${label} ${verb} ${Math.abs(change.raw).toFixed(1)}${change.text.includes("pp") ? " pp" : "%"} ${comparisonShortLabel(comparison)}.`;
}

function formatValue(v: number | null, key: string, mode: ValueMode): string {
  if (v === null || v === undefined) return "Not available";
  if (key === "eps") return `PKR ${v.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
  if (key.includes("margin")) return `${v.toFixed(1)}%`;
  
  if (mode === "compact") {
    const rupees = v * 1000;
    const abs = Math.abs(rupees);
    if (abs >= 1_000_000_000) return `PKR ${(rupees / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `PKR ${(rupees / 1_000_000).toFixed(1)}M`;
    return `PKR ${rupees.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  }
  
  return `PKR ${(v * 1000).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function formatRawCompact(v: number | null): string {
    if (v === null || v === undefined) return "—";
    const rupees = v * 1000;
    const abs = Math.abs(rupees);
    if (abs >= 1_000_000_000) return `${(rupees / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(rupees / 1_000_000).toFixed(1)}M`;
    return `${rupees.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function changeInfo(latest: number | null, prior: number | null, isMargin: boolean) {
  if (latest === null || prior === null || prior === 0) return null;
  if (isMargin) {
    const diff = latest - prior;
    return {
      raw: diff,
      text: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pp`,
      tone: diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral"
    } as const;
  }
  const pct = ((latest - prior) / Math.abs(prior)) * 100;
  return {
    raw: pct,
    text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    tone: pct > 0 ? "positive" : pct < 0 ? "negative" : "neutral"
  } as const;
}

function findPriorEquivalent(rows: FinancialWorkspaceRow[], current: FinancialWorkspaceRow, comparison: "YoY" | "QoQ"): FinancialWorkspaceRow | null {
  const m = rowMode(current);
  const p = (current.fiscal_period ?? "").toUpperCase();
  const y = current.fiscal_year;
  if (!y) return null;

  if (comparison === "QoQ" && m === "quarterly") {
    // QoQ means sequential quarter
    const periods = rows.filter(r => rowMode(r) === "quarterly" && r !== current).sort((a,b) => rank(b) - rank(a));
    return periods.find(r => rank(r) < rank(current)) ?? null;
  }

  // YoY: same period, previous year
  return rows.find(r => rowMode(r) === m && r.fiscal_year === y - 1 && (m === "annual" || (r.fiscal_period ?? "").toUpperCase() === p)) ?? null;
}

function formatDate(d: string | null): string {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function parseDate(d: string | null): number {
    if (!d) return 0;
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Segment<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
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

function SummaryCard({ label, metricKey, val, isMargin, priorVal, priorLabel, valueMode, comparison }: { label: string; metricKey: string; val: number | null; isMargin?: boolean; priorVal: number | null; priorLabel: string; valueMode: ValueMode; comparison: "YoY" | "QoQ" }) {
    const chg = changeInfo(val, priorVal, isMargin ?? false);
    return (
        <Card className="border-slate-200 bg-white shadow-sm flex flex-col justify-between min-h-[104px]">
            <CardContent className="p-4 flex flex-col h-full justify-between">
                <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className={cn("mt-1.5 font-semibold tabular-nums text-slate-950", ["Revenue", "Profit after tax", "Net margin"].includes(label) ? "text-2xl" : "text-xl")}>
                        {val === null ? "—" : (isMargin ? `${val.toFixed(1)}%` : formatValue(val, metricKey, valueMode))}
                    </p>
                </div>
                {chg ? (
                    <div className="mt-2 text-xs font-medium" title={`Current: ${val === null ? "—" : isMargin ? val.toFixed(1) + "%" : formatValue(val, metricKey, valueMode)}\n${priorLabel}: ${priorVal === null ? "—" : isMargin ? priorVal.toFixed(1) + "%" : formatValue(priorVal, metricKey, valueMode)}\nChange: ${chg.text}`}>
                        <span className={cn(
                            chg.tone === "positive" ? "text-emerald-700" : chg.tone === "negative" ? "text-red-700" : "text-slate-600"
                        )}>
                            {chg.text} {comparison}
                        </span>
                    </div>
                ) : priorLabel !== "—" ? (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                        {comparison === "YoY" ? "Prior-year" : "Previous-quarter"} comparison unavailable
                    </div>
                ) : (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                        No prior period
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export function EarningsWorkspace({
  ticker,
  rows,
  filings,
  readOnly = false,
}: {
  ticker: string;
  rows: FinancialWorkspaceRow[];
  filings: Filing[];
  readOnly?: boolean;
}) {
  const [mode, setMode] = useState<PeriodMode>("annual");
  const [valueMode, setValueMode] = useState<ValueMode>("compact");
  const [comparison, setComparison] = useState<"YoY" | "QoQ">("YoY");
  const [trendView, setTrendView] = useState<TrendView>("profit");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  // Filter and sort active rows
  const activeRows = useMemo(() => rows.filter(r => rowMode(r) === mode).sort((a,b) => rank(b) - rank(a)), [rows, mode]);
  
  // Pick default selected period
  const activePeriod = useMemo(() => {
    if (selectedPeriodId) {
        const p = activeRows.find(r => rank(r).toString() === selectedPeriodId);
        if (p) return p;
    }
    return activeRows[0] ?? null;
  }, [activeRows, selectedPeriodId]);

  const priorPeriod = useMemo(() => {
      if (!activePeriod) return null;
      return findPriorEquivalent(rows, activePeriod, comparison);
  }, [activePeriod, rows, comparison]);

  const priorLabel = labelPeriod(priorPeriod);
  const latestFiling = useMemo(() => [...rows].sort((a,b) => rank(b) - rank(a))[0] ?? null, [rows]);
  const valueStatus = resultValueStatus(activePeriod);
  const metadataStatus = resultMetadataStatus(activePeriod);
  const sourceStatus: Status = activePeriod?.source_url ? "Complete" : "Unavailable";
  const tableNotice = useMemo(() => {
      const missingDates = activeRows.filter((r) => !r.reported_date).length;
      const missingSources = activeRows.filter((r) => !r.source_url).length;
      const notes: string[] = [];
      if (missingDates) notes.push(`${missingDates} period${missingDates === 1 ? "" : "s"} missing announcement date metadata`);
      if (missingSources) notes.push(`${missingSources} period${missingSources === 1 ? "" : "s"} missing official filing links`);
      return notes.length ? notes.join("; ") + "." : null;
  }, [activeRows]);

  // Metrics
  const metrics = useMemo(() => {
    return {
        revenue: { val: value(activePeriod, "revenue"), priorVal: value(priorPeriod, "revenue") },
        pat: { val: value(activePeriod, "profit_after_tax"), priorVal: value(priorPeriod, "profit_after_tax") },
        eps: { val: value(activePeriod, "eps"), priorVal: value(priorPeriod, "eps") },
        gm: { val: value(activePeriod, "gross_margin"), priorVal: value(priorPeriod, "gross_margin") },
        nm: { val: value(activePeriod, "net_margin"), priorVal: value(priorPeriod, "net_margin") },
        op: { val: value(activePeriod, "operating_profit"), priorVal: value(priorPeriod, "operating_profit") },
        finance: { val: value(activePeriod, "finance_cost"), priorVal: value(priorPeriod, "finance_cost") }
    };
  }, [activePeriod, priorPeriod]);

  const summaryCards = useMemo<SummaryCardItem[]>(() => {
      const core: SummaryCardItem[] = [
          { key: "revenue", label: "Revenue", metricKey: "revenue", val: metrics.revenue.val, priorVal: metrics.revenue.priorVal },
          { key: "profit_after_tax", label: "Profit after tax", metricKey: "profit_after_tax", val: metrics.pat.val, priorVal: metrics.pat.priorVal },
          { key: "eps", label: "EPS", metricKey: "eps", val: metrics.eps.val, priorVal: metrics.eps.priorVal },
          { key: "gross_margin", label: "Gross margin", metricKey: "gross_margin", val: metrics.gm.val, priorVal: metrics.gm.priorVal, isMargin: true },
          { key: "net_margin", label: "Net margin", metricKey: "net_margin", val: metrics.nm.val, priorVal: metrics.nm.priorVal, isMargin: true },
      ];
      const driver = ([
          { key: "operating_profit", label: "Operating profit", metricKey: "operating_profit", val: metrics.op.val, priorVal: metrics.op.priorVal },
          { key: "finance_cost", label: "Finance cost", metricKey: "finance_cost", val: metrics.finance.val, priorVal: metrics.finance.priorVal },
      ] satisfies SummaryCardItem[]).find((item) => item.val !== null);
      return [...core, ...(driver ? [driver] : [])].filter((item) => item.val !== null);
  }, [metrics]);

  // Insights / Takeaways
  const takeaways = useMemo(() => {
      if (!activePeriod || !priorPeriod) return [];
      const lines: string[] = [];
      const revChg = changeInfo(metrics.revenue.val, metrics.revenue.priorVal, false);
      if (revChg) {
          lines.push(`Revenue ${revChg.raw > 0 ? "increased" : "declined"} ${Math.abs(revChg.raw).toFixed(1)}% ${comparison === "YoY" ? "year over year" : "sequentially"}.`);
      }
      const patChg = changeInfo(metrics.pat.val, metrics.pat.priorVal, false);
      if (patChg) {
          lines.push(`Profit after tax ${patChg.raw > 0 ? "increased" : "declined"} ${Math.abs(patChg.raw).toFixed(1)}%.`);
      }
      if (metrics.eps.val !== null && metrics.eps.priorVal !== null && metrics.eps.val !== metrics.eps.priorVal) {
          lines.push(`EPS ${metrics.eps.val > metrics.eps.priorVal ? "rose" : "fell"} from PKR ${metrics.eps.priorVal.toFixed(2)} to PKR ${metrics.eps.val.toFixed(2)}.`);
      }
      const gmChg = changeInfo(metrics.gm.val, metrics.gm.priorVal, true);
      if (gmChg) {
          lines.push(`Gross margin ${gmChg.raw > 0 ? "expanded" : "contracted"} by ${Math.abs(gmChg.raw).toFixed(1)} percentage points.`);
      }
      const nmChg = changeInfo(metrics.nm.val, metrics.nm.priorVal, true);
      if (nmChg) {
          if (metrics.nm.val !== null) {
             lines.push(`Net margin ${nmChg.raw > 0 ? "improved" : "weakened"} to ${metrics.nm.val.toFixed(1)}%.`);
          }
      }
      return lines.slice(0, 3);
  }, [metrics, activePeriod, priorPeriod, comparison]);

  const conclusion = useMemo(() => {
     if (!activePeriod) return "No results available.";
     const label = labelPeriod(activePeriod);
     const revChg = changeInfo(metrics.revenue.val, metrics.revenue.priorVal, false);
     const patChg = changeInfo(metrics.pat.val, metrics.pat.priorVal, false);
     const gmChg = changeInfo(metrics.gm.val, metrics.gm.priorVal, true);
     const nmChg = changeInfo(metrics.nm.val, metrics.nm.priorVal, true);
     if (revChg && patChg) {
         const revenueVerb = revChg.raw > 0 ? "rose" : revChg.raw < 0 ? "fell" : "was flat";
         const patVerb = patChg.raw > 0 ? "increased" : patChg.raw < 0 ? "declined" : "was flat";
         const driver = gmChg
             ? `Gross margin ${gmChg.raw > 0 ? "expansion" : "contraction"} of ${Math.abs(gmChg.raw).toFixed(1)} pp was the clearest verified driver.`
             : nmChg
                 ? `Net margin ${nmChg.raw > 0 ? "improved" : "weakened"} by ${Math.abs(nmChg.raw).toFixed(1)} pp.`
                 : "No margin driver is verified for this comparison.";
         return `${label} revenue ${revenueVerb} ${Math.abs(revChg.raw).toFixed(1)}% ${comparisonShortLabel(comparison)}, while profit after tax ${patVerb} ${Math.abs(patChg.raw).toFixed(1)}%. ${driver}`;
     }
     const fallback = changeSentence("Revenue", revChg, comparison) ?? changeSentence("Profit after tax", patChg, comparison);
     return fallback ? `${label}: ${fallback}` : `${label} has insufficient comparable data for a result conclusion.`;
  }, [metrics, activePeriod, comparison]);

  // Watchpoints
  const watchpoints = useMemo(() => {
      const wp: string[] = [];
      const revChg = changeInfo(metrics.revenue.val, metrics.revenue.priorVal, false);
      const patChg = changeInfo(metrics.pat.val, metrics.pat.priorVal, false);
      const epsChg = changeInfo(metrics.eps.val, metrics.eps.priorVal, false);
      const gmChg = changeInfo(metrics.gm.val, metrics.gm.priorVal, true);
      const nmChg = changeInfo(metrics.nm.val, metrics.nm.priorVal, true);
      if (revChg && patChg && revChg.raw > 0 && patChg.raw < 0) wp.push("Revenue grew but profit after tax declined, indicating earnings pressure despite top-line growth.");
      if (gmChg && gmChg.raw <= -2) wp.push(`Gross margin contracted by ${Math.abs(gmChg.raw).toFixed(1)} pp, which may signal cost pressure.`);
      if (nmChg && nmChg.raw <= -2) wp.push(`Net margin weakened by ${Math.abs(nmChg.raw).toFixed(1)} pp, reducing earnings quality for this result.`);
      if (epsChg && epsChg.raw < 0) wp.push(`EPS declined ${Math.abs(epsChg.raw).toFixed(1)}% ${comparisonShortLabel(comparison)}, which is material for per-share earnings.`);
      return wp;
  }, [metrics, comparison]);

  // Events Timeline
  const events = useMemo<EarningsEvent[]>(() => {
      return activeRows.slice(0, 8).map((r) => {
          const eventDate = r.reported_date;
          const eventTime = parseDate(eventDate);
          const nearby = eventDate
              ? filings.filter((f) => f.date && Math.abs(parseDate(f.date) - eventTime) <= 3 * 86400000)
              : [];
          const sourceMatched = r.source_url ? nearby.find((f) => f.url === r.source_url) ?? null : null;
          const resultMatched = nearby.find((f) => f.category === "result") ?? null;
          const primary = sourceMatched ?? resultMatched ?? nearby[0] ?? null;
          return {
              id: rank(r).toString(),
              period: labelPeriod(r),
              date: eventDate,
              sourceUrl: r.source_url,
              primary,
              related: nearby.filter((f) => f !== primary),
          };
      });
  }, [activeRows, filings]);

  // Chart Data
  const chartData = useMemo(() => {
      const reversed = [...activeRows].slice(0, 10).reverse();
      return reversed.map(r => {
          const prior = findPriorEquivalent(rows, r, comparison);
          return {
              id: rank(r).toString(),
              period: labelPeriod(r),
              revenue: raw(r, "revenue") ? raw(r, "revenue")! * 1000 : null,
              pat: raw(r, "profit_after_tax") ? raw(r, "profit_after_tax")! * 1000 : null,
              op: raw(r, "operating_profit") ? raw(r, "operating_profit")! * 1000 : null,
              eps: raw(r, "eps"),
              gm: margin(r, "gross_profit"),
              nm: margin(r, "profit_after_tax"),
              finance: raw(r, "finance_cost") ? raw(r, "finance_cost")! * 1000 : null,
              tax: raw(r, "tax") ? raw(r, "tax")! * 1000 : null,
              revenue_chg: changeInfo(raw(r, "revenue"), raw(prior, "revenue"), false)?.text,
              pat_chg: changeInfo(raw(r, "profit_after_tax"), raw(prior, "profit_after_tax"), false)?.text,
              eps_chg: changeInfo(raw(r, "eps"), raw(prior, "eps"), false)?.text,
          };
      });
  }, [activeRows, comparison, rows]);

  const latestChartPoint = chartData.at(-1) ?? null;
  const driverTrendAvailable = chartData.some((row) =>
    ["op", "finance", "tax"].some((key) => typeof row[key as "op" | "finance" | "tax"] === "number")
  );
  const trendOptions = [
    { value: "profit", label: "Revenue & profit" },
    { value: "eps", label: "EPS" },
    { value: "margins", label: "Margins" },
    ...(driverTrendAvailable ? [{ value: "drivers", label: "Drivers" } as const] : []),
  ] satisfies { value: TrendView; label: string }[];
  const activeTrendView = trendOptions.some((option) => option.value === trendView) ? trendView : "profit";

  const selectChartPeriod = (e: unknown) => {
      const periodId = (e as ChartClickEvent | null)?.activePayload?.[0]?.payload?.id;
      if (periodId) setSelectedPeriodId(periodId);
  };

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-3">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                      <CardTitle className="text-lg">Earnings</CardTitle>
                      <CardDescription className="mt-2 space-y-1 text-xs">
                          <span className="block">
                              <span className="font-medium text-slate-700">Selected result:</span>{" "}
                              {activePeriod ? `${labelPeriod(activePeriod)} · ${mode === "annual" ? "Annual" : mode === "quarterly" ? "Quarterly" : "Cumulative"}` : "No result"}
                              {activePeriod?.data?._period_end ? ` · Period ended ${formatDate(String(activePeriod.data._period_end))}` : ""}
                          </span>
                          <span className="block">
                              <span className="font-medium text-slate-700">Latest filing available:</span>{" "}
                              {latestFiling ? labelPeriod(latestFiling) : "Unavailable"}
                              {latestFiling?.reported_date ? ` · Announced ${formatDate(latestFiling.reported_date)}` : ""}
                          </span>
                          <span className="block">
                              <span className="font-medium text-slate-700">Source:</span>{" "}
                              {activePeriod?.source_url ? "Official PSX filing" : "Source mapping unverified"}
                          </span>
                      </CardDescription>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Badge variant={statusVariant(valueStatus)}>{statusText("values", valueStatus)}</Badge>
                          <Badge variant={statusVariant(metadataStatus)}>{statusText("metadata", metadataStatus)}</Badge>
                          <Badge variant={statusVariant(sourceStatus)}>{statusText("source", sourceStatus)}</Badge>
                          {metadataStatus !== "Complete" ? (
                              <span className="text-[11px] text-muted-foreground">Announcement dates and period metadata are tracked here, not as earnings risks.</span>
                          ) : null}
                      </div>
                  </div>
                  <div className="flex flex-col gap-2 xl:items-end">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Mode</span>
                          <Segment
                              value={mode}
                              onChange={(v) => { setMode(v); setSelectedPeriodId(null); }}
                              options={[
                                  { value: "quarterly", label: "Quarterly" },
                                  { value: "cumulative", label: "Cumulative" },
                                  { value: "annual", label: "Annual" },
                              ]}
                          />
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Compare vs</span>
                          <Segment
                              value={comparison}
                              onChange={setComparison}
                              options={mode === "quarterly" ? [{ value: "YoY", label: "Prior Year (YoY)" }, { value: "QoQ", label: "Prior Qtr (QoQ)" }] : [{ value: "YoY", label: "Prior Year (YoY)" }]}
                          />
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                          {!readOnly && (
                              <ActionButton
                                  endpoint={`/api/stocks/${ticker}/refresh`}
                                  body={{ section: "financials" }}
                                  label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh result</>}
                                  variant="outline"
                                  size="sm"
                              />
                          )}
                          {activePeriod?.source_url ? (
                              <Button variant="outline" size="sm" onClick={() => window.open(activePeriod.source_url!, "_blank", "noopener,noreferrer")}>
                                  <ExternalLink className="h-3.5 w-3.5" /> View official result
                              </Button>
                          ) : null}
                      </div>
                  </div>
              </div>
          </CardHeader>
      </Card>

      {/* SUMMARY */}
      {activePeriod && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {summaryCards.map((card) => (
                  <SummaryCard
                      key={card.key}
                      label={card.label}
                      metricKey={card.metricKey}
                      val={card.val}
                      isMargin={card.isMargin}
                      priorVal={card.priorVal}
                      priorLabel={priorLabel}
                      valueMode={valueMode}
                      comparison={comparison}
                  />
              ))}
          </div>
      )}

      {/* CONCLUSION */}
      {activePeriod && takeaways.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900 shadow-sm">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <p className="text-sm leading-relaxed font-medium">{conclusion}</p>
          </div>
      )}

      {/* TREND CHART */}
      <Card className="border-slate-200 bg-white shadow-sm overflow-hidden">
        <CardHeader className="border-b border-border bg-slate-50/50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
             <div>
                 <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-slate-500" /> Earnings dashboard</CardTitle>
                 <CardDescription className="mt-1 text-xs">Charts show absolute values. The comparison control sets the YoY/QoQ basis shown in badges and tooltips.</CardDescription>
             </div>
             <Segment
                 value={activeTrendView}
                 onChange={setTrendView}
                 options={trendOptions}
             />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {activeTrendView === "profit" ? (
            <div className="grid gap-3 p-4 lg:grid-cols-2">
                {[
                    { key: "revenue", label: "Revenue trend", fill: "#2563eb", question: "Is the business growing?" },
                    { key: "pat", label: "Profit after tax trend", fill: "#b45309", question: "Are earnings growing?" },
                ].map((chart) => (
                    <div key={chart.key} className="rounded-lg border border-slate-200 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div>
                                <p className="text-xs font-semibold text-slate-900">{chart.label}</p>
                                <p className="text-[10px] text-muted-foreground">{chart.question}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-semibold tabular-nums text-slate-900">
                                    {latestChartPoint && typeof latestChartPoint[chart.key as "revenue" | "pat"] === "number"
                                        ? formatRawCompact(Number(latestChartPoint[chart.key as "revenue" | "pat"]) / 1000)
                                        : "—"}
                                </p>
                                <Badge variant="blue">
                                    {(chart.key === "revenue" ? latestChartPoint?.revenue_chg : latestChartPoint?.pat_chg) ?? `${comparisonShortLabel(comparison)} n/a`}
                                </Badge>
                            </div>
                        </div>
                        <div className="h-[240px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} onClick={selectChartPeriod} margin={{ top: 8, right: 12, bottom: 8, left: 6 }}>
                                    <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#e2e8f0" />
                                    <XAxis dataKey="period" {...AXIS_TICK} tickMargin={8} axisLine={false} tickLine={false} />
                                    <YAxis {...AXIS_TICK} tickFormatter={fmtCompact} width={62} axisLine={false} tickLine={false} />
                                    <RechartsTooltip
                                        cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
                                        contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", fontSize: "12px" }}
                                        formatter={(value: unknown) => {
                                            const numericValue = typeof value === "number" ? value : Number(value);
                                            return [Number.isFinite(numericValue) ? formatRawCompact(numericValue / 1000) : "—", chart.label.replace(" trend", "")];
                                        }}
                                    />
                                    <Bar dataKey={chart.key} name={chart.label.replace(" trend", "")} fill={chart.fill} radius={[4,4,0,0]} maxBarSize={34} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                ))}
            </div>
          ) : (
          <div className="h-[320px] w-full p-4 pb-0 pl-0">
              <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} onClick={selectChartPeriod}>
                      <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#e2e8f0" />
                      <XAxis dataKey="period" {...AXIS_TICK} tickMargin={10} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="left" {...AXIS_TICK} tickFormatter={activeTrendView === "eps" ? (v) => v.toFixed(1) : activeTrendView === "margins" ? (v) => v.toFixed(0) + "%" : fmtCompact} width={65} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                          cursor={CURSOR}
                          contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", fontSize: "12px" }}
                          formatter={(value: unknown, name: unknown) => {
                              const label = String(name ?? "");
                              const numericValue = typeof value === "number" ? value : Number(value);
                              if (!Number.isFinite(numericValue)) return ["—", label];
                              if (label === "EPS") return [`PKR ${numericValue.toFixed(2)}`, label];
                              if (label.includes("margin")) return [`${numericValue.toFixed(1)}%`, label];
                              return [formatRawCompact(numericValue / 1000), label];
                          }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                      
                      {activeTrendView === "eps" && (
                          <Bar yAxisId="left" dataKey="eps" name="EPS" fill="#4f46e5" radius={[4,4,0,0]} barSize={24} />
                      )}
                      {activeTrendView === "margins" && (
                          <>
                              <Line yAxisId="left" type="monotone" dataKey="gm" name="Gross margin" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                              <Line yAxisId="left" type="monotone" dataKey="nm" name="Net margin" stroke="#b45309" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                          </>
                      )}
                      {activeTrendView === "drivers" && (
                           <>
                              <Bar yAxisId="left" dataKey="op" name="Operating Profit" fill="#2563eb" radius={[4,4,0,0]} barSize={24} />
                              <Line yAxisId="left" type="monotone" dataKey="finance" name="Finance cost" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                              <Line yAxisId="left" type="monotone" dataKey="tax" name="Tax" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                          </>
                      )}
                  </ComposedChart>
              </ResponsiveContainer>
          </div>
          )}
        </CardContent>
      </Card>

      {/* TWO COLUMNS: TAKEAWAYS & WATCHPOINTS vs HISTORY */}
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,2fr)] items-start">
          <div className="space-y-4">
              <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm flex items-center gap-2"><Presentation className="w-4 h-4 text-slate-500"/> Key earnings takeaways</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                      {takeaways.length > 0 ? (
                          <ul className="space-y-2.5">
                              {takeaways.map((t, i) => (
                                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed">
                                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                      {t}
                                  </li>
                              ))}
                          </ul>
                      ) : (
                          <p className="text-sm text-muted-foreground">Not enough data to generate takeaways for this period.</p>
                      )}
                  </CardContent>
              </Card>

              {watchpoints.length > 0 && (
                  <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
                      <CardHeader className="p-4 pb-2">
                          <CardTitle className="text-sm flex items-center gap-2 text-amber-900"><AlertTriangle className="w-4 h-4 text-amber-600"/> Watchpoints</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-2">
                           <ul className="space-y-2">
                              {watchpoints.map((t, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-amber-800 leading-relaxed">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                                      {t}
                                  </li>
                              ))}
                          </ul>
                      </CardContent>
                  </Card>
              )}

              {events.length > 0 && (
                  <Card className="border-slate-200 bg-white shadow-sm">
                      <CardHeader className="p-4 pb-2">
                          <CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-slate-500"/> Earnings-event timeline</CardTitle>
                          <CardDescription className="mt-1 text-xs">Each result is grouped with its primary filing and nearby disclosures.</CardDescription>
                      </CardHeader>
                      <CardContent className="p-4 pt-2">
                          <div className="relative border-l border-slate-200 ml-2 space-y-4 pb-2">
                              {events.slice(0, 5).map((ev) => (
                                  <div
                                      key={ev.id}
                                      className={cn("relative cursor-pointer rounded-md py-1 pl-5 pr-2 hover:bg-slate-50", activePeriod && ev.id === rank(activePeriod).toString() && "bg-blue-50/70")}
                                      onClick={() => setSelectedPeriodId(ev.id)}
                                  >
                                      <span className="absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full bg-slate-300 border-2 border-white" />
                                      <p className="text-[11px] font-semibold text-slate-900">{ev.period} result</p>
                                      <p className="text-[10px] text-muted-foreground mb-1.5">{ev.date ? formatDate(ev.date) : "Announcement date not captured"}</p>
                                      {ev.primary ? (
                                          <a href={ev.primary.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block text-xs font-medium text-blue-700 hover:underline mb-1">
                                              {ev.primary.title}
                                          </a>
                                      ) : ev.sourceUrl ? (
                                          <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block text-xs font-medium text-blue-700 hover:underline mb-1">
                                              Official result filing
                                          </a>
                                      ) : (
                                          <p className="text-xs text-amber-700">Primary filing link unavailable</p>
                                      )}
                                      {ev.related.length > 0 && (
                                          <details className="text-[10px]">
                                              <summary className="cursor-pointer text-slate-500 hover:text-slate-900 font-medium">+{ev.related.length} related disclosure{ev.related.length > 1 ? 's' : ''}</summary>
                                              <div className="mt-1.5 space-y-1.5 pl-2 border-l border-slate-100">
                                                  {ev.related.map((rel, j) => (
                                                      <a key={j} href={rel.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block text-slate-600 hover:underline">
                                                          {rel.title}
                                                      </a>
                                                  ))}
                                              </div>
                                          </details>
                                      )}
                                  </div>
                              ))}
                          </div>
                      </CardContent>
                  </Card>
              )}
          </div>

          <Card className="border-slate-200 bg-white shadow-sm overflow-hidden">
              <CardHeader className="p-4 pb-2 border-b border-border bg-slate-50/50">
                   <div className="flex items-center justify-between">
                       <div>
                           <CardTitle className="text-sm">Earnings history</CardTitle>
                           <CardDescription className="mt-1 text-xs">
                              Numeric history uses the same sourced Income Statement periods as Financials.
                              {tableNotice ? ` ${tableNotice}` : ""}
                           </CardDescription>
                       </div>
                       <label className="flex items-center gap-2">
                            <Select value={valueMode} onChange={(e) => setValueMode(e.target.value as ValueMode)} className="h-7 text-[11px] w-[130px]">
                                <option value="compact">Compact values</option>
                                <option value="exact">Exact values</option>
                            </Select>
                       </label>
                   </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                  <Table>
                      <THead>
                          <TR className="bg-slate-50/50 border-b border-border">
                              <TH className="text-xs py-2 whitespace-nowrap sticky left-0 bg-slate-50/95 backdrop-blur z-10 font-semibold text-slate-900 shadow-[1px_0_0_0_#e2e8f0]">Period</TH>
                              <TH className="text-right text-xs py-2 whitespace-nowrap">Revenue</TH>
                              <TH className="text-right text-xs py-2 whitespace-nowrap">PAT</TH>
                              <TH className="text-right text-xs py-2 whitespace-nowrap">EPS</TH>
                              <TH className="text-right text-xs py-2 whitespace-nowrap">Revenue {comparisonShortLabel(comparison)}</TH>
                              <TH className="text-right text-xs py-2 whitespace-nowrap">PAT {comparisonShortLabel(comparison)}</TH>
                              <TH className="text-xs py-2 whitespace-nowrap pl-4">Filing</TH>
                          </TR>
                      </THead>
                      <TBody>
                          {activeRows.map((r) => {
                              const isSelected = activePeriod && rank(r) === rank(activePeriod);
                              const prior = findPriorEquivalent(rows, r, comparison);
                              const revChg = changeInfo(raw(r, "revenue"), raw(prior, "revenue"), false);
                              const patChg = changeInfo(raw(r, "profit_after_tax"), raw(prior, "profit_after_tax"), false);
                              return (
                                  <TR key={rank(r)} 
                                      className={cn(
                                          "cursor-pointer hover:bg-slate-50 transition-colors",
                                          isSelected && "bg-blue-50/50"
                                      )}
                                      onClick={() => setSelectedPeriodId(rank(r).toString())}
                                  >
                                      <TD className={cn("text-xs font-medium py-2.5 whitespace-nowrap sticky left-0 bg-white z-10 shadow-[1px_0_0_0_#e2e8f0]", isSelected && "bg-blue-50/50 text-blue-800")}>
                                          {labelPeriod(r)}
                                      </TD>
                                      <TD className="text-right text-xs py-2.5 tabular-nums">{formatValue(raw(r, "revenue"), "revenue", valueMode)}</TD>
                                      <TD className="text-right text-xs py-2.5 tabular-nums">{formatValue(raw(r, "profit_after_tax"), "profit_after_tax", valueMode)}</TD>
                                      <TD className="text-right text-xs py-2.5 tabular-nums">{raw(r, "eps") !== null ? `PKR ${raw(r, "eps")?.toFixed(2)}` : "—"}</TD>
                                      <TD className="text-right text-xs py-2.5 whitespace-nowrap">
                                          {revChg ? (
                                              <span className={cn(revChg.tone === "positive" ? "text-emerald-700" : revChg.tone === "negative" ? "text-red-700" : "text-slate-600")}>{revChg.text}</span>
                                          ) : "—"}
                                      </TD>
                                      <TD className="text-right text-xs py-2.5 whitespace-nowrap">
                                          {patChg ? (
                                              <span className={cn(patChg.tone === "positive" ? "text-emerald-700" : patChg.tone === "negative" ? "text-red-700" : "text-slate-600")}>{patChg.text}</span>
                                          ) : "—"}
                                      </TD>
                                      <TD className="text-xs py-2.5 whitespace-nowrap pl-4">
                                          {r.source_url ? (
                                              <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                                                  <FileText className="h-3 w-3" /> Filing
                                              </a>
                                          ) : (
                                              <span className="text-muted-foreground">—</span>
                                          )}
                                      </TD>
                                  </TR>
                              );
                          })}
                          {activeRows.length === 0 && (
                              <TR>
                                  <TD colSpan={7} className="text-center py-6 text-sm text-muted-foreground">
                                      No {mode} periods found.
                                  </TD>
                              </TR>
                          )}
                      </TBody>
                  </Table>
              </CardContent>
          </Card>
      </div>
    </div>
  );
}
