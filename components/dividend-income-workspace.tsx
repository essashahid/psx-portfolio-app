"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dividend, EnrichedHolding } from "@/lib/types";
import type { DividendEvent } from "@/lib/dividends/engine";
import { DividendReceivables } from "@/components/dividend-receivables";
import { DividendManager } from "@/components/dividend-form";
import { formatMoney, cn } from "@/lib/utils";

type Period = "ytd" | "previous" | "twelve_months" | "all" | "custom";
type Granularity = "monthly" | "quarterly" | "annual";

const PERIODS: { key: Period; label: string }[] = [
  { key: "ytd", label: "YTD" },
  { key: "previous", label: "Previous year" },
  { key: "twelve_months", label: "Last 12 months" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

function recordDate(record: Dividend) {
  return record.payment_date ?? record.pay_date ?? record.announcement_date ?? record.created_at.slice(0, 10);
}

function periodRange(period: Period, asOf: string, customStart: string, customEnd: string) {
  const end = asOf;
  const date = new Date(`${asOf}T12:00:00`);
  if (period === "ytd") return { start: `${date.getFullYear()}-01-01`, end, label: `${date.getFullYear()} YTD` };
  if (period === "previous") return { start: `${date.getFullYear() - 1}-01-01`, end: `${date.getFullYear() - 1}-12-31`, label: String(date.getFullYear() - 1) };
  if (period === "twelve_months") {
    const start = new Date(date);
    start.setFullYear(start.getFullYear() - 1);
    return { start: start.toISOString().slice(0, 10), end, label: "Last 12 months" };
  }
  if (period === "custom") return { start: customStart || "0000-01-01", end: customEnd || end, label: "Custom period" };
  return { start: "0000-01-01", end: "9999-12-31", label: "All time" };
}

function inRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function bucketKey(date: string, granularity: Granularity) {
  const year = date.slice(0, 4);
  if (granularity === "annual") return year;
  if (granularity === "monthly") return date.slice(0, 7);
  return `${year} Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}

function periodLabel(date: string, granularity: Granularity) {
  if (granularity === "annual") return date;
  if (granularity === "quarterly") return date;
  const [year, month] = date.split("-");
  return new Intl.DateTimeFormat("en-PK", { month: "short", year: "2-digit" }).format(new Date(`${year}-${month}-01T12:00:00`));
}

export function DividendIncomeWorkspace({
  dividends,
  events,
  holdings,
  asOf,
}: {
  dividends: Dividend[];
  events: DividendEvent[];
  holdings: EnrichedHolding[];
  asOf: string;
}) {
  const [period, setPeriod] = useState<Period>("ytd");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const range = periodRange(period, asOf, customStart, customEnd);
  const received = useMemo(() => dividends.filter((record) => record.status === "received" && inRange(recordDate(record), range.start, range.end)), [dividends, range.start, range.end]);
  const periodEvents = useMemo(() => events.filter((event) => {
    const eventDate = event.payment_date ?? event.estimated_payment_end ?? event.announcement_date ?? event.created_at.slice(0, 10);
    return event.status !== "received" && inRange(eventDate, range.start, range.end);
  }), [events, range.start, range.end]);
  const gross = received.reduce((sum, record) => sum + record.amount, 0);
  const tax = received.reduce((sum, record) => sum + (record.tax ?? 0), 0);
  const net = received.reduce((sum, record) => sum + (record.net_amount ?? record.amount - (record.tax ?? 0)), 0);
  const upcoming = periodEvents.filter((event) => !event.is_forecast && ["announced", "expected"].includes(event.status) && !event.is_possible_duplicate);
  const upcomingNet = upcoming.reduce((sum, event) => sum + (event.net_expected ?? 0), 0);
  const reviews = periodEvents.filter((event) => event.status === "needs_review" || event.status === "overdue" || event.is_possible_duplicate || event.needs_tax_review);
  const manualIssues = received.filter((record) => !record.ticker || !recordDate(record) || record.amount < 0 || (record.net_amount !== null && Math.abs(record.amount - (record.tax ?? 0) - record.net_amount) > 1)).length;

  const timeline = useMemo(() => {
    const rows = new Map<string, { key: string; gross: number; tax: number; net: number; payments: number }>();
    received.forEach((record) => {
      const key = bucketKey(recordDate(record), granularity);
      const current = rows.get(key) ?? { key, gross: 0, tax: 0, net: 0, payments: 0 };
      current.gross += record.amount;
      current.tax += record.tax ?? 0;
      current.net += record.net_amount ?? record.amount - (record.tax ?? 0);
      current.payments += 1;
      rows.set(key, current);
    });
    return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)).map((row) => ({ ...row, label: periodLabel(row.key, granularity) }));
  }, [received, granularity]);

  const byHolding = useMemo(() => {
    const rows = new Map<string, { ticker: string; net: number; payments: number }>();
    received.forEach((record) => {
      const ticker = record.ticker ?? "Unmatched";
      const current = rows.get(ticker) ?? { ticker, net: 0, payments: 0 };
      current.net += record.net_amount ?? record.amount - (record.tax ?? 0);
      current.payments += 1;
      rows.set(ticker, current);
    });
    const ranked = [...rows.values()].sort((a, b) => b.net - a.net);
    const top = ranked.slice(0, 6);
    const other = ranked.slice(6);
    if (other.length) top.push({ ticker: "Other", net: other.reduce((sum, row) => sum + row.net, 0), payments: other.reduce((sum, row) => sum + row.payments, 0) });
    return top;
  }, [received]);
  const maxHolding = Math.max(...byHolding.map((row) => row.net), 1);

  return (
    <div className="space-y-7">
      <section className="border-y border-border py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Period: {range.label}</p><p className="mt-1 text-xs text-muted-foreground">{range.start === "0000-01-01" ? "All recorded history" : `${range.start} – ${range.end}`}</p></div>
          <div className="flex flex-wrap gap-1 rounded-md bg-muted p-0.5">{PERIODS.map((item) => <button key={item.key} onClick={() => setPeriod(item.key)} className={cn("rounded px-2.5 py-1.5 text-xs font-medium", item.key === period ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{item.label}</button>)}</div>
        </div>
        {period === "custom" && <div className="mt-3 flex flex-wrap gap-2"><label className="text-xs text-muted-foreground">From <input className="ml-1 rounded border border-border bg-card px-2 py-1.5 text-foreground" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label className="text-xs text-muted-foreground">To <input className="ml-1 rounded border border-border bg-card px-2 py-1.5 text-foreground" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
      </section>

      <section>
        <div className="grid border-y border-border sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Net income received" value={formatMoney(net)} sub={`${received.length} received record${received.length === 1 ? "" : "s"}`} />
          <Metric label="Gross dividend income" value={formatMoney(gross)} sub="Selected period" />
          <Metric label="Tax withheld" value={formatMoney(tax)} sub={gross > 0 ? `Effective: ${((tax / gross) * 100).toFixed(1)}%` : "No received income"} />
          <Metric label="Upcoming confirmed" value={formatMoney(upcomingNet)} sub={upcoming.length ? `${upcoming.length} confirmed record${upcoming.length === 1 ? "" : "s"}` : "No announcements"} />
        </div>
        {(reviews.length > 0 || manualIssues > 0) && <p className="mt-3 text-xs text-amber-800"><strong>{reviews.length + manualIssues} record{reviews.length + manualIssues === 1 ? "" : "s"} need review.</strong> Includes unmatched, overdue, duplicate, tax-review, or inconsistent payment records.</p>}
      </section>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.35fr)_minmax(21rem,0.65fr)]">
        <section className="border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Dividend income over time</h2><p className="mt-1 text-xs text-muted-foreground">Recorded gross income, tax withheld and net income.</p></div><div className="flex gap-1 rounded-md bg-muted p-0.5">{(["monthly", "quarterly", "annual"] as Granularity[]).map((item) => <button key={item} onClick={() => setGranularity(item)} className={cn("rounded px-2 py-1 text-[11px] capitalize", item === granularity && "bg-card shadow-sm")}>{item}</button>)}</div></div>{timeline.length ? <div className="mt-4 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="#dedfda" strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6c6e68" }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: "#6c6e68" }} tickFormatter={(value) => `PKR ${(value / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={55} /><Tooltip content={<IncomeTooltip />} /><Bar dataKey="gross" name="Gross income" fill="#9ca3af" radius={[3, 3, 0, 0]} /><Bar dataKey="tax" name="Tax withheld" fill="#c46d57" radius={[3, 3, 0, 0]} /><Bar dataKey="net" name="Net income" fill="#3450c8" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div> : <p className="py-16 text-center text-sm text-muted-foreground">No received dividend income in the selected period.</p>}</section>
        <section className="border-t border-border pt-4"><h2 className="text-base font-semibold">Net income by holding</h2><p className="mt-1 text-xs text-muted-foreground">Received income by holding in the selected period.</p><div className="mt-5 space-y-4">{byHolding.length ? byHolding.map((row) => <div key={row.ticker}><div className="mb-1 flex items-baseline justify-between gap-3 text-xs"><span className="font-semibold">{row.ticker}</span><span className="tabular-nums text-muted-foreground">{formatMoney(row.net)} · {net > 0 ? ((row.net / net) * 100).toFixed(1) : "0.0"}% · {row.payments} payment{row.payments === 1 ? "" : "s"}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${(row.net / maxHolding) * 100}%` }} /></div></div>) : <p className="py-10 text-center text-sm text-muted-foreground">No holding income to display.</p>}</div></section>
      </div>

      <DividendReceivables events={periodEvents} received={received} showLowConfidence={false} />

      <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-semibold">Manage recorded dividends</summary><p className="mt-1 text-xs text-muted-foreground">Add, edit or remove manual and imported dividend records.</p><div className="mt-4"><DividendManager dividends={received} holdings={holdings} /></div></details>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="border-b border-border py-4 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:pl-0 sm:border-r sm:last:border-r-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{sub}</p></div>;
}

function IncomeTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; payload?: { payments: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const payments = payload[0]?.payload?.payments ?? 0;
  return <div className="chart-tooltip"><p className="chart-tooltip-label">{label}</p>{payload.map((item) => <p key={item.name} className="flex justify-between gap-5 text-xs"><span style={{ color: item.color }}>{item.name}</span><span className="font-medium tabular-nums">{formatMoney(item.value)}</span></p>)}<p className="mt-1 text-[11px] text-muted-foreground">{payments} payment{payments === 1 ? "" : "s"}</p></div>;
}
