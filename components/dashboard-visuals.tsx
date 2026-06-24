"use client";

import { useMemo, useState } from "react";
import { ValueLine } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { cn, formatMoney, formatSignedPct } from "@/lib/utils";
import { FileText } from "lucide-react";

type Snapshot = { date: string; value: number; cost: number };
type Allocation = { label: string; value: number; weight: number; holdings: number };
const PERIODS = ["1W", "1M", "3M", "YTD", "1Y", "All"] as const;
type Period = (typeof PERIODS)[number];

/** Opens the browser print dialog so the current, calculation-only dashboard can be saved as a report. */
export function DashboardReportButton() {
  return <Button variant="outline" size="sm" onClick={() => window.print()}><FileText className="h-3.5 w-3.5" /> Generate report</Button>;
}

function filteredSnapshots(data: Snapshot[], period: Period) {
  if (period === "All" || data.length === 0) return data;
  const last = new Date(`${data.at(-1)!.date}T12:00:00`);
  const start = new Date(last);
  if (period === "1W") start.setDate(last.getDate() - 7);
  if (period === "1M") start.setMonth(last.getMonth() - 1);
  if (period === "3M") start.setMonth(last.getMonth() - 3);
  if (period === "1Y") start.setFullYear(last.getFullYear() - 1);
  if (period === "YTD") start.setMonth(0, 1);
  return data.filter((point) => new Date(`${point.date}T12:00:00`) >= start);
}

export function DashboardPerformance({ data }: { data: Snapshot[] }) {
  const [period, setPeriod] = useState<Period>("All");
  const visible = useMemo(() => filteredSnapshots(data, period), [data, period]);
  return (
    <section className="border-y border-border py-5">
      <div className="flex items-center justify-between gap-3 pb-3">
        <div><h2 className="text-base font-semibold">Portfolio performance</h2><p className="mt-1 text-xs text-muted-foreground">Market value, cost basis and unrealised return over time.</p></div>
        <div className="flex rounded-md bg-muted p-0.5" aria-label="Performance period">
          {PERIODS.map((item) => <button key={item} onClick={() => setPeriod(item)} className={cn("rounded px-2 py-1 text-[11px] font-medium", period === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{item}</button>)}
        </div>
      </div>
      <div className="pt-2"><ValueLine data={visible.map((point) => ({ ...point, date: point.date.slice(5) }))} /></div>
    </section>
  );
}

export function PortfolioContribution({ rows, gainers, losers }: { rows: { ticker: string; companyName: string | null; contribution: number | null; priceMove: number | null; weight: number | null }[]; gainers: number; losers: number }) {
  const ranked = rows.filter((row) => row.contribution !== null).sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0)).slice(0, 8);
  const largest = ranked[0];
  const max = Math.max(...ranked.map((row) => Math.abs(row.contribution ?? 0)), 1);
  return (
    <section className="border-t border-border pt-4">
      <div><h2 className="text-base font-semibold">What moved your portfolio today</h2><p className="mt-1 text-xs text-muted-foreground">{ranked.length ? `${gainers} holdings increased and ${losers} declined.${largest ? ` ${largest.ticker} had the largest contribution at ${formatMoney(largest.contribution)}.` : ""}` : "Daily price changes are not available for current holdings."}</p></div>
      <div className="pt-5">
        {ranked.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No daily contribution data available.</p> : <div className="space-y-3">{ranked.map((row) => {
          const positive = (row.contribution ?? 0) >= 0;
          const width = `${(Math.abs(row.contribution ?? 0) / max) * 50}%`;
          return <div key={row.ticker} className="grid grid-cols-[3.8rem_minmax(0,1fr)_5.25rem] items-center gap-2 text-xs">
            <span className="font-semibold" title={row.companyName ?? row.ticker}>{row.ticker}</span>
            <div className="relative h-5"><span className="absolute inset-y-0 left-1/2 w-px bg-border" />{positive ? <span className="absolute left-1/2 top-1 h-3 rounded-r bg-emerald-600/75" style={{ width }} /> : <span className="absolute right-1/2 top-1 h-3 rounded-l bg-red-600/70" style={{ width }} />}</div>
            <span className={cn("text-right font-medium tabular-nums", positive ? "text-emerald-700" : "text-red-700")}>{formatMoney(row.contribution)}</span>
            <span className="col-start-2 col-span-2 -mt-2 text-[10px] text-muted-foreground">{formatSignedPct(row.priceMove)} price move · {row.weight?.toFixed(1) ?? "—"}% weight</span>
          </div>;
        })}</div>}
      </div>
    </section>
  );
}

export function DashboardAllocation({ sectors, holdings }: { sectors: Allocation[]; holdings: Allocation[] }) {
  const [view, setView] = useState<"sectors" | "holdings">("sectors");
  const rows = view === "sectors" ? sectors : compactHoldings(holdings);
  const max = Math.max(...rows.map((row) => row.weight), 1);
  return (
    <section className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Portfolio allocation</h2><p className="mt-1 text-xs text-muted-foreground">{view === "sectors" ? "Allocation by sector" : "Top holdings by market value"}</p></div><div className="flex gap-1 rounded-md bg-muted p-0.5"><button onClick={() => setView("sectors")} className={cn("rounded px-2 py-1 text-[11px]", view === "sectors" && "bg-card shadow-sm")}>Sector</button><button onClick={() => setView("holdings")} className={cn("rounded px-2 py-1 text-[11px]", view === "holdings" && "bg-card shadow-sm")}>Holding</button></div></div>
      <div className="space-y-4 pt-5">{rows.map((row) => <div key={row.label}><div className="mb-1 flex items-baseline justify-between gap-3 text-xs"><span className="truncate font-medium">{row.label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(row.value)} · {row.weight.toFixed(1)}%{view === "sectors" ? ` · ${row.holdings} holding${row.holdings === 1 ? "" : "s"}` : ""}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${(row.weight / max) * 100}%` }} /></div></div>)}</div>
    </section>
  );
}

function compactHoldings(holdings: Allocation[]) {
  const top = holdings.slice(0, 9);
  const remainder = holdings.slice(9);
  if (!remainder.length) return top;
  return [...top, { label: "Other", value: remainder.reduce((sum, item) => sum + item.value, 0), weight: remainder.reduce((sum, item) => sum + item.weight, 0), holdings: remainder.length }];
}
