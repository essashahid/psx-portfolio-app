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
  Area,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/action-button";
import { AXIS_TICK, ChartEmpty, CURSOR, fmtCompact } from "@/components/chart-kit";
import { cn } from "@/lib/utils";
import { AlertTriangle, Download, ExternalLink, MoreHorizontal, RefreshCw, FileText, Info, TrendingUp, Presentation, Clock, CheckCircle2 } from "lucide-react";
import type { FinancialWorkspaceRow } from "@/components/stock/financials-workspace";
import type { Filing } from "@/lib/company/types";

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

type PeriodMode = "annual" | "quarterly" | "cumulative";
type ValueMode = "compact" | "exact";
type TrendView = "profit" | "eps" | "margins" | "drivers";

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

function SummaryCard({ label, val, isMargin, priorVal, priorLabel, valueMode, comparison }: { label: string; val: number | null; isMargin?: boolean; priorVal: number | null; priorLabel: string; valueMode: ValueMode; comparison: "YoY" | "QoQ" }) {
    const chg = changeInfo(val, priorVal, isMargin ?? false);
    return (
        <Card className="border-slate-200 bg-white shadow-sm flex flex-col justify-between min-h-[104px]">
            <CardContent className="p-4 flex flex-col h-full justify-between">
                <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className={cn("mt-1.5 font-semibold tabular-nums text-slate-950", ["Revenue", "Profit after tax", "Net margin"].includes(label) ? "text-2xl" : "text-xl")}>
                        {val === null ? "—" : (isMargin ? `${val.toFixed(1)}%` : formatValue(val, label.toLowerCase(), valueMode))}
                    </p>
                </div>
                {chg ? (
                    <div className="mt-2 text-xs font-medium" title={`Current: ${val === null ? "—" : isMargin ? val.toFixed(1) + "%" : formatValue(val, label.toLowerCase(), valueMode)}\n${priorLabel}: ${priorVal === null ? "—" : isMargin ? priorVal.toFixed(1) + "%" : formatValue(priorVal, label.toLowerCase(), valueMode)}\nChange: ${chg.text}`}>
                        <span className={cn(
                            chg.tone === "positive" ? "text-emerald-700" : chg.tone === "negative" ? "text-red-700" : "text-slate-600"
                        )}>
                            {chg.text} {comparison}
                        </span>
                    </div>
                ) : priorLabel !== "—" ? (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                        {priorLabel} data unavailable
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
      return lines;
  }, [metrics, activePeriod, priorPeriod, comparison]);

  const conclusion = useMemo(() => {
     if (takeaways.length >= 2) {
         const revPos = metrics.revenue.val && metrics.revenue.priorVal && metrics.revenue.val > metrics.revenue.priorVal;
         const patPos = metrics.pat.val && metrics.pat.priorVal && metrics.pat.val > metrics.pat.priorVal;
         const marginPos = metrics.nm.val && metrics.nm.priorVal && metrics.nm.val > metrics.nm.priorVal;
         
         if (revPos && patPos && marginPos) return `Revenue and profit increased compared with the equivalent period, with margin expansion contributing to stronger earnings.`;
         if (revPos && patPos && !marginPos) return `Revenue and profit increased, though margins contracted slightly compared with the equivalent period.`;
         if (!revPos && !patPos) return `Revenue and profit both declined compared with the equivalent period, reflecting a weaker earnings environment.`;
         if (revPos && !patPos) return `Revenue increased, but profit declined, driven by margin compression or higher costs.`;
         if (!revPos && patPos) return `Revenue declined, but profit improved, supported by margin expansion or cost discipline.`;
     }
     return activePeriod ? `Earnings result for ${labelPeriod(activePeriod)}.` : "No results available.";
  }, [metrics, takeaways, activePeriod]);

  // Watchpoints
  const watchpoints = useMemo(() => {
      const wp: string[] = [];
      if (activePeriod && !activePeriod.reported_date) wp.push(`Result announcement date requires confirmation from source.`);
      if (activePeriod && Object.keys(activePeriod.data || {}).length < 5) wp.push(`This period contains partial data (likely extracted from a limited standalone quarterly summary).`);
      if (metrics.finance.val === null && activeRows.some(r => raw(r, "finance_cost") !== null)) wp.push(`Finance cost detail is unavailable for this specific period.`);
      return wp;
  }, [activePeriod, activeRows, metrics.finance.val]);

  // Events Timeline
  const events = useMemo(() => {
      // Group filings by result events. A result event maps to an activeRow roughly.
      // We'll just show filings that are "result" category or close in date.
      const resultFilings = filings.filter(f => f.category === "result" || f.category === "dividend");
      // This is a simplified timeline grouping
      const timelineMap = new Map<string, { period: string, date: string, primary: Filing, related: Filing[] }>();
      
      for (const r of activeRows) {
          if (!r.reported_date) continue;
          const label = labelPeriod(r);
          // Find filings within 3 days of reported date
          const rDate = parseDate(r.reported_date);
          const related = filings.filter(f => {
              if (!f.date) return false;
              const fDate = parseDate(f.date);
              return Math.abs(fDate - rDate) <= 3 * 86400000;
          });
          if (related.length > 0) {
              const primary = related.find(f => f.category === "result") || related[0];
              const rest = related.filter(f => f !== primary);
              timelineMap.set(label, { period: label, date: r.reported_date, primary, related: rest });
          }
      }
      return Array.from(timelineMap.values()).sort((a,b) => parseDate(b.date) - parseDate(a.date));
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
          };
      });
  }, [activeRows, comparison, rows]);

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-3">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                      <CardTitle className="text-lg">Earnings</CardTitle>
                      <CardDescription className="mt-1">
                          <span className="font-medium text-slate-700">{activePeriod ? labelPeriod(activePeriod) : "No result"} · {mode === "annual" ? "Annual" : mode === "quarterly" ? "Quarterly" : "Cumulative"}</span>
                          {activePeriod?.data?._period_end ? ` · Period ended ${formatDate(String(activePeriod.data._period_end))}` : ""}
                          {activePeriod?.reported_date ? ` · Announced ${formatDate(activePeriod.reported_date)}` : ""}
                      </CardDescription>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                          {activePeriod?.source_url ? (
                               <a href={activePeriod.source_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-blue-600 hover:underline inline-flex items-center gap-1">
                                  <FileText className="w-3 h-3"/> Official PSX filing
                               </a>
                          ) : <span className="text-[11px] text-muted-foreground">Source mapping unverified</span>}
                          <span className="text-muted-foreground text-[11px]">·</span>
                          <Badge variant={activePeriod ? (Object.keys(activePeriod.data||{}).length > 6 ? "green" : "amber") : "secondary"}>
                              Data status: {activePeriod ? (Object.keys(activePeriod.data||{}).length > 6 ? "Complete" : "Partial") : "Unavailable"}
                          </Badge>
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
                  </div>
              </div>
          </CardHeader>
      </Card>

      {/* SUMMARY */}
      {activePeriod && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <SummaryCard label="Revenue" val={metrics.revenue.val} priorVal={metrics.revenue.priorVal} priorLabel={priorLabel} valueMode={valueMode} comparison={comparison} />
              <SummaryCard label="Profit after tax" val={metrics.pat.val} priorVal={metrics.pat.priorVal} priorLabel={priorLabel} valueMode={valueMode} comparison={comparison} />
              <SummaryCard label="EPS" val={metrics.eps.val} priorVal={metrics.eps.priorVal} priorLabel={priorLabel} valueMode={valueMode} comparison={comparison} />
              <SummaryCard label="Gross margin" val={metrics.gm.val} isMargin priorVal={metrics.gm.priorVal} priorLabel={priorLabel} valueMode={valueMode} comparison={comparison} />
              <SummaryCard label="Net margin" val={metrics.nm.val} isMargin priorVal={metrics.nm.priorVal} priorLabel={priorLabel} valueMode={valueMode} comparison={comparison} />
              <SummaryCard label="Finance cost" val={metrics.finance.val} priorVal={metrics.finance.priorVal} priorLabel={priorLabel} valueMode={valueMode} comparison={comparison} />
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
             <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-slate-500" /> Earnings trend</CardTitle>
             <Segment
                 value={trendView}
                 onChange={setTrendView}
                 options={[
                     { value: "profit", label: "Revenue & profit" },
                     { value: "eps", label: "EPS" },
                     { value: "margins", label: "Margins" },
                     { value: "drivers", label: "Drivers" },
                 ]}
             />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[320px] w-full p-4 pb-0 pl-0">
              <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} onClick={(e) => {
                      if (e && e.activePayload && e.activePayload.length > 0) {
                          setSelectedPeriodId(e.activePayload[0].payload.id);
                      }
                  }}>
                      <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#e2e8f0" />
                      <XAxis dataKey="period" {...AXIS_TICK} tickMargin={10} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="left" {...AXIS_TICK} tickFormatter={trendView === "eps" ? (v) => v.toFixed(1) : trendView === "margins" ? (v) => v.toFixed(0) + "%" : fmtCompact} width={65} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                          cursor={CURSOR}
                          contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", fontSize: "12px" }}
                          formatter={(value: any, name: string) => {
                              if (name === "EPS") return [`PKR ${value.toFixed(2)}`, name];
                              if (name.includes("margin")) return [`${value.toFixed(1)}%`, name];
                              return [formatRawCompact(value/1000), name];
                          }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                      
                      {trendView === "profit" && (
                          <>
                              <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#94a3b8" radius={[4,4,0,0]} barSize={24} />
                              <Line yAxisId="left" type="monotone" dataKey="pat" name="Profit after tax" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                          </>
                      )}
                      {trendView === "eps" && (
                          <Bar yAxisId="left" dataKey="eps" name="EPS" fill="#0ea5e9" radius={[4,4,0,0]} barSize={24} />
                      )}
                      {trendView === "margins" && (
                          <>
                              <Line yAxisId="left" type="monotone" dataKey="gm" name="Gross margin" stroke="#64748b" strokeWidth={2} dot={{ r: 3 }} />
                              <Line yAxisId="left" type="monotone" dataKey="nm" name="Net margin" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                          </>
                      )}
                      {trendView === "drivers" && (
                           <>
                              <Bar yAxisId="left" dataKey="op" name="Operating Profit" fill="#94a3b8" radius={[4,4,0,0]} barSize={24} />
                              <Line yAxisId="left" type="monotone" dataKey="finance" name="Finance cost" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                              <Line yAxisId="left" type="monotone" dataKey="tax" name="Tax" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                          </>
                      )}
                  </ComposedChart>
              </ResponsiveContainer>
          </div>
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
                      </CardHeader>
                      <CardContent className="p-4 pt-2">
                          <div className="relative border-l border-slate-200 ml-2 space-y-4 pb-2">
                              {events.slice(0, 5).map((ev, i) => (
                                  <div key={i} className="relative pl-5">
                                      <span className="absolute left-[-5px] top-1 w-2.5 h-2.5 rounded-full bg-slate-300 border-2 border-white" />
                                      <p className="text-[11px] font-semibold text-slate-900">{ev.period} result</p>
                                      <p className="text-[10px] text-muted-foreground mb-1.5">{formatDate(ev.date)}</p>
                                      <a href={ev.primary.url} target="_blank" rel="noopener noreferrer" className="block text-xs font-medium text-blue-700 hover:underline mb-1">
                                          {ev.primary.title}
                                      </a>
                                      {ev.related.length > 0 && (
                                          <details className="text-[10px]">
                                              <summary className="cursor-pointer text-slate-500 hover:text-slate-900 font-medium">+{ev.related.length} related disclosure{ev.related.length > 1 ? 's' : ''}</summary>
                                              <div className="mt-1.5 space-y-1.5 pl-2 border-l border-slate-100">
                                                  {ev.related.map((rel, j) => (
                                                      <a key={j} href={rel.url} target="_blank" rel="noopener noreferrer" className="block text-slate-600 hover:underline">
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
                       <CardTitle className="text-sm">Earnings history</CardTitle>
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
                              <TH className="text-right text-xs py-2 whitespace-nowrap">Gross margin</TH>
                              <TH className="text-right text-xs py-2 whitespace-nowrap">Net margin</TH>
                              <TH className="text-right text-xs py-2 whitespace-nowrap">{comparison} change</TH>
                              <TH className="text-xs py-2 whitespace-nowrap pl-4">Announced</TH>
                          </TR>
                      </THead>
                      <TBody>
                          {activeRows.map((r) => {
                              const isSelected = activePeriod && rank(r) === rank(activePeriod);
                              const prior = findPriorEquivalent(rows, r, comparison);
                              const revChg = changeInfo(raw(r, "revenue"), raw(prior, "revenue"), false);
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
                                      <TD className="text-right text-xs py-2.5 tabular-nums">{raw(r, "eps") !== null ? `PKR ${raw(r,"eps")?.toFixed(2)}` : "—"}</TD>
                                      <TD className="text-right text-xs py-2.5 tabular-nums">{margin(r, "gross_profit") !== null ? `${margin(r, "gross_profit")?.toFixed(1)}%` : "—"}</TD>
                                      <TD className="text-right text-xs py-2.5 tabular-nums">{margin(r, "profit_after_tax") !== null ? `${margin(r, "profit_after_tax")?.toFixed(1)}%` : "—"}</TD>
                                      <TD className="text-right text-xs py-2.5 whitespace-nowrap">
                                          {revChg ? (
                                              <span className={cn(revChg.tone === "positive" ? "text-emerald-700" : revChg.tone === "negative" ? "text-red-700" : "text-slate-600")}>
                                                  {revChg.text}
                                              </span>
                                          ) : "—"}
                                      </TD>
                                      <TD className="text-xs py-2.5 text-muted-foreground whitespace-nowrap pl-4">{formatDate(r.reported_date)}</TD>
                                  </TR>
                              );
                          })}
                          {activeRows.length === 0 && (
                              <TR>
                                  <TD colSpan={8} className="text-center py-6 text-sm text-muted-foreground">
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
