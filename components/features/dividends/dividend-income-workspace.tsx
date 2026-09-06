"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dividend, EnrichedHolding } from "@/lib/shared/types";
import type { DividendEvent } from "@/lib/dividends/engine";
import { DividendReceivables } from "@/components/features/dividends/dividend-receivables";
import { DividendManager } from "@/components/features/dividends/dividend-form";
import { formatMoney, cn } from "@/lib/shared/format";
import { sectorColor } from "@/lib/shared/sector-colors";

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
  readOnly = false,
}: {
  dividends: Dividend[];
  events: DividendEvent[];
  holdings: EnrichedHolding[];
  asOf: string;
  readOnly?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("ytd");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const range = periodRange(period, asOf, customStart, customEnd);
  const received = useMemo(() => dividends.filter((record) => record.status === "received" && inRange(recordDate(record), range.start, range.end)), [dividends, range.start, range.end]);
  const periodEvents = useMemo(() => events.filter((event) => {
    if (event.status === "received") return false;
    const eventDate = event.payment_date ?? event.estimated_payment_end ?? event.announcement_date ?? event.created_at.slice(0, 10);
    // Future-dated events (upcoming announcements, forecasts) are current state,
    // not history: the period selector must never hide them.
    return eventDate >= asOf || inRange(eventDate, range.start, range.end);
  }), [events, range.start, range.end, asOf]);
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

  const sectorByTicker = useMemo(
    () => Object.fromEntries(holdings.map((h) => [h.ticker, h.sector ?? null])),
    [holdings]
  );
  const effectiveRate = gross > 0 ? ((tax / gross) * 100).toFixed(1) : null;
  const nextUpcoming = upcoming
    .filter((event) => event.ex_date)
    .sort((a, b) => (a.ex_date! < b.ex_date! ? -1 : 1))[0];

  return (
    <div>
      {/* ── Period pills + the Gross − Tax = Net equation (hero band) ── */}
      <div className="flex flex-wrap items-center gap-4">
        <div role="radiogroup" aria-label="Period" className="inline-flex items-center gap-0.5 rounded-full border border-rule bg-surface-inset p-[3px]">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={item.key === period}
              onClick={() => setPeriod(item.key)}
              className={cn(
                "whitespace-nowrap rounded-full px-[15px] py-1.5 text-xs font-semibold transition-colors",
                item.key === period
                  ? "bg-surface-raised text-text-strong shadow-[0_1px_2px_rgba(13,18,15,0.08)]"
                  : "text-text-muted hover:text-text-strong"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="figure text-(length:--text-2xs) text-text-faint">{range.start === "0000-01-01" ? "All recorded history" : `${range.start} – ${range.end}`}</span>
      </div>
      {period === "custom" && <div className="mt-3 flex flex-wrap gap-2"><label className="text-xs text-text-muted">From <input className="ml-1 rounded border border-rule bg-surface-raised px-2 py-1.5 text-text-strong" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label className="text-xs text-text-muted">To <input className="ml-1 rounded border border-rule bg-surface-raised px-2 py-1.5 text-text-strong" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}

      <div className="flex flex-wrap items-end gap-11 pt-6">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Gross</p>
            <p className="figure mt-1 text-(length:--text-h2) font-medium text-text-muted">{formatMoney(gross)}</p>
          </div>
          <p className="mb-1.5 text-(length:--text-h3) text-text-faint">−</p>
          <div>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Tax withheld{effectiveRate ? ` · ${effectiveRate}%` : ""}</p>
            <p className="figure mt-1 text-(length:--text-h2) font-medium text-[var(--clay-1)]">{formatMoney(tax)}</p>
          </div>
          <p className="mb-1.5 text-(length:--text-h3) text-text-faint">=</p>
          <div className="border-l-[3px] border-saffron pl-5">
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-muted">Net received · {received.length} record{received.length === 1 ? "" : "s"}</p>
            <p className="figure mt-1 text-(length:--text-display) font-semibold leading-none tracking-editorial text-text-strong">{formatMoney(net)}</p>
          </div>
        </div>
        <div className="ml-auto text-right">
          <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Upcoming confirmed</p>
          <p className="figure mt-1 text-(length:--text-h2) font-semibold text-up">{formatMoney(upcomingNet)}</p>
          <p className="mt-0.5 text-(length:--text-2xs) text-text-muted">
            {upcoming.length ? `${upcoming.length} record${upcoming.length === 1 ? "" : "s"}${nextUpcoming ? ` · next ${nextUpcoming.ticker}, ${nextUpcoming.ex_date}` : ""}` : "No announcements"}
          </p>
        </div>
      </div>
      {(reviews.length > 0 || manualIssues > 0) && <p className="mt-4 text-xs text-amber-800"><strong>{reviews.length + manualIssues} record{reviews.length + manualIssues === 1 ? "" : "s"} need review.</strong> Includes unmatched, overdue, duplicate, tax-review, or inconsistent payment records.</p>}

      {/* ── Income over time + who paid (second band) ── */}
      <div className="mt-8 grid gap-12 border-t border-rule pt-7 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Income over time</p>
              <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Gross, tax and net</h2>
            </div>
            <div className="flex gap-4 pb-1">
              {(["monthly", "quarterly", "annual"] as Granularity[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setGranularity(item)}
                  className={cn(
                    "border-b-2 pb-1.5 text-sm capitalize transition-colors",
                    item === granularity ? "border-indigo font-semibold text-text-strong" : "border-transparent font-medium text-text-muted hover:text-text-strong"
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {timeline.length ? <div className="mt-4 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid, #e6e6df)" strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 10, fill: "#82827a" }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: "#82827a" }} tickFormatter={(value) => `PKR ${(value / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={55} /><Tooltip content={<IncomeTooltip />} cursor={{ fill: "var(--surface-sunken)", opacity: 0.5 }} /><Bar dataKey="gross" name="Gross" fill="var(--paper-4)" /><Bar dataKey="tax" name="Tax withheld" fill="var(--clay-3)" /><Bar dataKey="net" name="Net" fill="var(--saffron-2)" /></BarChart></ResponsiveContainer></div> : <p className="py-16 text-center text-sm text-text-muted">No received dividend income in the selected period.</p>}
        </section>
        <section>
          <p className="eyebrow">Net income by holding</p>
          <h2 className="mt-1.5 mb-4 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Who paid, and how often</h2>
          <div className="ledger">
            {byHolding.length ? byHolding.map((row) => {
              const sector = holdings.find((h) => h.ticker === row.ticker)?.sector ?? null;
              const colour = row.ticker === "Other" ? "var(--flat-2)" : sectorColor(sector);
              return (
                <div key={row.ticker} className="ledger-row flex flex-col gap-1.5">
                  <span className="flex items-baseline gap-2.5">
                    <span className="inline-flex w-21 items-center gap-2 text-sm font-semibold text-text-strong">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colour }} />
                      {row.ticker}
                    </span>
                    <span className="figure flex-1 text-right text-sm font-semibold text-text-strong">{formatMoney(row.net)}</span>
                    <span className="figure w-13 text-right text-xs text-text-muted">{net > 0 ? ((row.net / net) * 100).toFixed(1) : "0.0"}%</span>
                    <span className="w-23 text-right text-(length:--text-2xs) text-text-faint">{row.payments} payment{row.payments === 1 ? "" : "s"}</span>
                  </span>
                  <span className="block h-1.5 bg-surface-inset"><span className="block h-1.5" style={{ width: `${(row.net / maxHolding) * 100}%`, background: colour }} /></span>
                </div>
              );
            }) : <p className="py-10 text-center text-sm text-text-muted">No holding income to display.</p>}
          </div>
        </section>
      </div>

      {/* ── Records (third band) ── */}
      <div className="mt-8 border-t border-rule pt-7">
        <DividendReceivables events={periodEvents} received={received} showLowConfidence={false} sectors={sectorByTicker} readOnly={readOnly} />
      </div>

      {!readOnly && <details className="mt-8 border-t border-rule pt-5"><summary className="cursor-pointer text-sm font-semibold text-text-strong">Manage recorded dividends</summary><p className="mt-1 text-xs text-text-muted">Add, edit or remove manual and imported dividend records.</p><div className="mt-4"><DividendManager dividends={received} holdings={holdings} /></div></details>}
    </div>
  );
}

function IncomeTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; payload?: { payments: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const payments = payload[0]?.payload?.payments ?? 0;
  return (
    <div className="rounded-(--radius-sm) bg-surface-nav px-2.5 py-2 text-[var(--text-on-dark)] shadow-[0_6px_18px_-12px_rgba(13,18,15,0.5)]">
      <p className="mb-1.5 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-[var(--text-on-dark-muted)]">{label}</p>
      {payload.map((item) => (
        <p key={item.name} className="flex items-center gap-2 whitespace-nowrap text-(length:--text-2xs) leading-relaxed">
          <span className="h-[5px] w-[5px] rounded-full" style={{ background: item.color }} />
          <span className="text-[var(--text-on-dark-muted)]">{item.name}</span>
          <span className="figure ml-auto pl-4 font-semibold">{formatMoney(item.value)}</span>
        </p>
      ))}
      <p className="mt-1 text-(length:--text-3xs) text-[var(--text-on-dark-muted)]">{payments} payment{payments === 1 ? "" : "s"}</p>
    </div>
  );
}
