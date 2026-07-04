"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dividend, EnrichedHolding } from "@/lib/types";
import type { DividendEvent } from "@/lib/dividends/engine";
import { INK } from "@/components/chart-kit";
import { taxYearOf } from "@/lib/dividends/tax-year";
import { formatMoney, cn } from "@/lib/utils";

function receivedDate(record: Dividend): string {
  return record.payment_date ?? record.pay_date ?? record.announcement_date ?? record.created_at.slice(0, 10);
}

function netOf(record: Dividend): number {
  return record.net_amount ?? record.amount - (record.tax ?? 0);
}

// ---------------------------------------------------------------------------
// Annual income trajectory with a forecast extension for the current year.
// ---------------------------------------------------------------------------

export function DividendTrajectory({ dividends, events }: { dividends: Dividend[]; events: DividendEvent[] }) {
  const data = useMemo(() => {
    const byYear = new Map<string, { year: string; received: number; forecast: number }>();
    const ensure = (year: string) => {
      const row = byYear.get(year) ?? { year, received: 0, forecast: 0 };
      byYear.set(year, row);
      return row;
    };
    for (const record of dividends) {
      if (record.status !== "received") continue;
      ensure(receivedDate(record).slice(0, 4)).received += netOf(record);
    }
    // Forecast + confirmed-but-unpaid events extend the current and next year.
    for (const event of events) {
      if (event.status === "received") continue;
      const date = event.payment_date ?? event.estimated_payment_end ?? event.estimated_payment_start;
      if (!date) continue;
      const net = event.net_expected ?? 0;
      if (net <= 0) continue;
      ensure(date.slice(0, 4)).forecast += net;
    }
    return [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year)).slice(-8);
  }, [dividends, events]);

  const hasForecast = data.some((row) => row.forecast > 0);
  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No dividend history recorded yet.</p>;
  }

  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={INK.grid} strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11, fill: INK.neutral }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: INK.neutral }} tickFormatter={(v) => `PKR ${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={55} />
            <Tooltip content={<TrajectoryTooltip />} />
            <Bar dataKey="received" name="Received (net)" stackId="a" fill={INK.line} radius={[0, 0, 0, 0]} />
            <Bar dataKey="forecast" name="Forecast / confirmed" stackId="a" fill={INK.line} radius={[3, 3, 0, 0]}>
              {data.map((row) => (
                <Cell key={row.year} fillOpacity={0.35} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {hasForecast && <p className="mt-2 text-[11px] text-muted-foreground">Lighter segments are forecast or announced-but-unpaid income, not yet received.</p>}
    </div>
  );
}

function TrajectoryTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      {payload.filter((p) => p.value > 0).map((item) => (
        <p key={item.name} className="flex justify-between gap-5 text-xs">
          <span>{item.name}</span>
          <span className="font-medium tabular-nums">{formatMoney(item.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-holding yield: trailing-12-month income against cost and market value.
// ---------------------------------------------------------------------------

type YieldRow = {
  ticker: string;
  companyName: string | null;
  ttmNet: number;
  cost: number;
  marketValue: number | null;
  yieldOnCost: number | null;
  yieldOnValue: number | null;
};

type YieldSort = "yoc" | "yov" | "ttm" | "ticker";

function YieldSortButton({ id, label, sort, setSort }: { id: YieldSort; label: string; sort: YieldSort; setSort: (s: YieldSort) => void }) {
  return (
    <button onClick={() => setSort(id)} className={cn("hover:text-foreground", sort === id ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</button>
  );
}

export function DividendYieldTable({ dividends, holdings, asOf }: { dividends: Dividend[]; holdings: EnrichedHolding[]; asOf: string }) {
  const [sort, setSort] = useState<YieldSort>("yoc");

  const rows = useMemo(() => {
    const cutoff = new Date(`${asOf}T12:00:00`);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const ttmByTicker = new Map<string, number>();
    for (const record of dividends) {
      if (record.status !== "received" || !record.ticker) continue;
      if (receivedDate(record) < cutoffKey) continue;
      ttmByTicker.set(record.ticker, (ttmByTicker.get(record.ticker) ?? 0) + netOf(record));
    }
    const out: YieldRow[] = holdings.map((h) => {
      const ttmNet = ttmByTicker.get(h.ticker) ?? 0;
      const cost = h.total_cost ?? 0;
      const marketValue = h.market_value ?? null;
      return {
        ticker: h.ticker,
        companyName: h.company_name,
        ttmNet,
        cost,
        marketValue,
        yieldOnCost: cost > 0 ? (ttmNet / cost) * 100 : null,
        yieldOnValue: marketValue && marketValue > 0 ? (ttmNet / marketValue) * 100 : null,
      };
    }).filter((row) => row.ttmNet > 0 || row.cost > 0);
    return out;
  }, [dividends, holdings, asOf]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "ttm") return b.ttmNet - a.ttmNet;
      if (sort === "yov") return (b.yieldOnValue ?? -1) - (a.yieldOnValue ?? -1);
      return (b.yieldOnCost ?? -1) - (a.yieldOnCost ?? -1);
    });
    return copy;
  }, [rows, sort]);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No holdings with cost or trailing dividend income to show yields for.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs">
            <th className="py-2 pr-3 text-left"><YieldSortButton id="ticker" label="Holding" sort={sort} setSort={setSort} /></th>
            <th className="px-3 py-2 text-right"><YieldSortButton id="ttm" label="TTM income (net)" sort={sort} setSort={setSort} /></th>
            <th className="px-3 py-2 text-right"><YieldSortButton id="yoc" label="Yield on cost" sort={sort} setSort={setSort} /></th>
            <th className="px-3 py-2 text-right"><YieldSortButton id="yov" label="Yield on value" sort={sort} setSort={setSort} /></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.ticker} className="border-b border-border last:border-0">
              <td className="py-2 pr-3">
                <span className="font-semibold">{row.ticker}</span>
                {row.companyName && <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{row.companyName}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.ttmNet)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.yieldOnCost !== null ? `${row.yieldOnCost.toFixed(2)}%` : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.yieldOnValue !== null ? `${row.yieldOnValue.toFixed(2)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">Yield on cost is trailing-12-month net income divided by your invested cost. Yield on value uses current market value.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tax-year statement: gross / withheld / net per holding for a PK tax year.
// ---------------------------------------------------------------------------

export function TaxYearStatement({ dividends, defaultYear }: { dividends: Dividend[]; defaultYear: string | null }) {
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const record of dividends) if (record.status === "received") set.add(taxYearOf(receivedDate(record)));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [dividends]);

  const [year, setYear] = useState<string>(() => (defaultYear && years.includes(defaultYear) ? defaultYear : years[0] ?? ""));

  const { rows, totals } = useMemo(() => {
    const map = new Map<string, { ticker: string; gross: number; tax: number; net: number; count: number }>();
    for (const record of dividends) {
      if (record.status !== "received") continue;
      if (taxYearOf(receivedDate(record)) !== year) continue;
      const ticker = record.ticker ?? "Unmatched";
      const row = map.get(ticker) ?? { ticker, gross: 0, tax: 0, net: 0, count: 0 };
      row.gross += record.amount;
      row.tax += record.tax ?? 0;
      row.net += netOf(record);
      row.count += 1;
      map.set(ticker, row);
    }
    const rows = [...map.values()].sort((a, b) => b.gross - a.gross);
    const totals = rows.reduce((t, r) => ({ gross: t.gross + r.gross, tax: t.tax + r.tax, net: t.net + r.net }), { gross: 0, tax: 0, net: 0 });
    return { rows, totals };
  }, [dividends, year]);

  if (years.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No received dividends to build a tax-year statement.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Tax year</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded-md border border-border bg-card px-2 py-1 text-sm">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <a href={`/api/export/tax_statement?year=${encodeURIComponent(year)}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted">Export CSV</a>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 pr-3 text-left">Holding</th>
              <th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-right">Tax withheld</th>
              <th className="px-3 py-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ticker} className="border-b border-border">
                <td className="py-2 pr-3 font-medium">{row.ticker} <span className="text-xs font-normal text-muted-foreground">· {row.count}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.gross)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.tax)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2 pr-3">Total · effective {totals.gross > 0 ? `${((totals.tax / totals.gross) * 100).toFixed(1)}%` : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.gross)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.tax)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totals.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Awaiting payment: announced/expected events whose window has passed.
// ---------------------------------------------------------------------------

export function AwaitingPayment({ events }: { events: { ticker: string | null; company_name: string | null; net_expected: number | null; dueDate: string | null; daysOverdue: number }[] }) {
  if (events.length === 0) return null;
  return (
    <section className="border-t border-border pt-4">
      <h2 className="text-base font-semibold">Awaiting payment</h2>
      <p className="mt-1 text-xs text-muted-foreground">Dividends announced or expected with a payment window that has already passed. Confirm receipt or check with your broker.</p>
      <div className="mt-3 divide-y divide-border">
        {events.map((event, i) => (
          <div key={`${event.ticker}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <span className="font-semibold">{event.ticker ?? "—"}</span>
              {event.company_name && <span className="ml-2 text-xs text-muted-foreground">{event.company_name}</span>}
            </div>
            <div className="text-right">
              <p className="tabular-nums">{event.net_expected !== null ? formatMoney(event.net_expected) : "—"}</p>
              <p className="text-[11px] text-muted-foreground">{event.dueDate ? `Due ${event.dueDate} · ${event.daysOverdue}d overdue` : "Overdue"}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
