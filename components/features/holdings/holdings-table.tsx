"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EnrichedHolding, PortfolioSummary } from "@/lib/shared/types";
import { cn, formatNumber } from "@/lib/shared/format";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { AddTransactionDialog } from "@/components/features/holdings/add-transaction-dialog";
import { SectorDot } from "@/components/shared/sector-chip";
import { sectorColor, shortSector } from "@/lib/shared/sector-colors";

type SortKey = "ticker" | "qty" | "price" | "value" | "pl";
type Grouping = "flat" | "sector";

interface Row {
  ticker: string;
  name: string | null;
  sector: string | null;
  qty: number;
  avg: number | null;
  price: number | null;
  day: number | null;
  value: number;
  pl: number;
  ret: number | null;
  weight: number;
}

const COLUMNS: { key: SortKey; label: string; sortName: string; align: "left" | "right" }[] = [
  { key: "ticker", label: "Holding", sortName: "ticker", align: "left" },
  { key: "qty", label: "Position", sortName: "quantity", align: "right" },
  { key: "price", label: "Price · day", sortName: "price", align: "right" },
  { key: "value", label: "Value · weight", sortName: "value", align: "right" },
  { key: "pl", label: "Unrealised · return", sortName: "unrealised", align: "right" },
];

const signed = (v: number, d = 0) => `${v < 0 ? "−" : "+"}${formatNumber(Math.abs(v), d)}`;

/**
 * Holdings ledger, exactly as the design draws it: five columns of two-line
 * cells, sortable heads, optional sector grouping under tinted collapsible
 * headers, and a ruled totals row.
 */
export function HoldingsTable({
  holdings,
  summary,
  dailyRows,
  readOnly = false,
}: {
  holdings: EnrichedHolding[];
  summary: PortfolioSummary;
  dailyRows: { ticker: string; dayChangePct: number | null; dayPnl: number | null }[];
  readOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("flat");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const dayByTicker = useMemo(
    () => new Map(dailyRows.map((r) => [r.ticker, r.dayChangePct])),
    [dailyRows]
  );

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return holdings
      .map((h) => ({
        ticker: h.ticker,
        name: h.company_name ?? null,
        sector: h.sector ?? null,
        qty: h.quantity ?? 0,
        avg: h.avg_cost ?? null,
        price: h.latest_price,
        day: dayByTicker.get(h.ticker) ?? null,
        value: h.market_value ?? h.total_cost ?? 0,
        pl: h.unrealized_pl ?? 0,
        ret: h.unrealized_pl_pct,
        weight: h.weight ?? 0,
      }))
      .filter((r) => !q || `${r.ticker} ${r.name ?? ""} ${r.sector ?? ""}`.toLowerCase().includes(q));
  }, [holdings, query, dayByTicker]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === "ticker") return a.ticker.localeCompare(b.ticker) * -sortDir;
      const av = sortKey === "qty" ? a.qty : sortKey === "price" ? (a.price ?? 0) : sortKey === "value" ? a.value : a.pl;
      const bv = sortKey === "qty" ? b.qty : sortKey === "price" ? (b.price ?? 0) : sortKey === "value" ? b.value : b.pl;
      return (av - bv) * sortDir;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const groups = useMemo(() => {
    if (grouping !== "sector") {
      return [{ labelled: false as const, sector: "", rows: sorted, value: 0, pl: 0, weight: 0 }];
    }
    const order: string[] = [];
    const bySector = new Map<string, Row[]>();
    for (const r of sorted) {
      const s = r.sector?.trim() || "Unclassified";
      if (!bySector.has(s)) {
        bySector.set(s, []);
        order.push(s);
      }
      bySector.get(s)!.push(r);
    }
    return order.map((sector) => {
      const items = bySector.get(sector)!;
      return {
        labelled: true as const,
        sector,
        rows: items,
        value: items.reduce((n, r) => n + r.value, 0),
        pl: items.reduce((n, r) => n + r.pl, 0),
        weight: items.reduce((n, r) => n + r.weight, 0),
      };
    });
  }, [sorted, grouping]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  const totalValue = sorted.reduce((n, r) => n + r.value, 0);
  const totalPl = sorted.reduce((n, r) => n + r.pl, 0);
  const totalCost = totalValue - totalPl;
  const totalRet = totalCost > 0 ? (totalPl / totalCost) * 100 : null;
  const sortLabel = COLUMNS.find((c) => c.key === sortKey)?.sortName ?? "value";

  const TH = "whitespace-nowrap pb-2.5 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps)";
  const TD = "px-3 py-3 align-middle";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by ticker, name or sector"
          aria-label="Filter holdings"
          className="h-9 max-w-70"
        />
        <SegmentedControl
          label="Grouping"
          value={grouping}
          onChange={setGrouping}
          options={[
            { value: "flat", label: "All positions" },
            { value: "sector", label: "By sector" },
          ]}
          className="w-55 shrink-0"
        />
        <span className="ml-auto text-xs text-text-muted">
          {sorted.length} position{sorted.length === 1 ? "" : "s"} · sorted by {sortLabel}
        </span>
        {!readOnly && <AddTransactionDialog variant="outline" />}
      </div>

      <div className="scroll-touch w-full overflow-x-auto">
        <table className="w-full min-w-2xl text-sm">
          <thead>
            <tr className="border-b border-rule-strong">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => sortBy(col.key)}
                  className={cn(
                    TH,
                    "cursor-pointer select-none px-3 transition-colors first:pl-0 last:pr-0",
                    col.align === "right" ? "text-right" : "text-left",
                    sortKey === col.key ? "text-text-strong" : "text-text-faint hover:text-text-muted"
                  )}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === -1 ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>

          {groups.map((group) => {
            const open = !group.labelled || !collapsed.has(group.sector);
            const colour = group.labelled ? sectorColor(group.sector) : "transparent";
            return (
              <tbody key={group.labelled ? group.sector : "all"}>
                {group.labelled && (
                  <tr
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.sector)) next.delete(group.sector);
                        else next.add(group.sector);
                        return next;
                      })
                    }
                    className="cursor-pointer"
                    style={{ background: `color-mix(in oklab, ${colour} 9%, var(--surface-page))` }}
                  >
                    <td colSpan={3} className="px-3 py-2.5 pl-0" style={{ borderLeft: `3px solid ${colour}` }}>
                      <span className="inline-flex items-center gap-2.5 pl-3">
                        <span className="text-sm font-bold text-text-strong">{shortSector(group.sector)}</span>
                        <span className="text-(length:--text-2xs) text-text-muted">
                          {group.rows.length} position{group.rows.length === 1 ? "" : "s"}
                        </span>
                        <span className="text-(length:--text-2xs) text-text-faint">{open ? "▾" : "▸"}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="figure font-semibold text-text-strong">{formatNumber(group.value, 0)}</span>
                      <span className="ml-auto mt-1 block h-1 w-16 bg-surface-inset">
                        <span className="block h-1" style={{ width: `${Math.min(100, group.weight)}%`, background: colour }} />
                      </span>
                    </td>
                    <td className={cn("px-3 py-2.5 pr-0 text-right font-semibold", group.pl >= 0 ? "text-up" : "text-down")}>
                      <span className="figure">{signed(group.pl, 0)}</span>
                    </td>
                  </tr>
                )}

                {open &&
                  group.rows.map((r) => (
                    <tr key={r.ticker} className="border-b border-rule transition-colors last:border-0 hover:bg-surface-sunken/50">
                      <td className={cn(TD, "pl-0")}>
                        <span className="flex items-center gap-2.5">
                          <SectorDot sector={r.sector} />
                          <span className="min-w-0">
                            <Link href={`/stocks/${r.ticker}`} className="font-semibold text-text-strong hover:underline">
                              {r.ticker}
                            </Link>
                            <span className="block truncate text-(length:--text-2xs) text-text-muted">
                              {r.name ?? r.ticker} · {shortSector(r.sector)}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className={cn(TD, "text-right")}>
                        <span className="figure">{formatNumber(r.qty, 0)}</span>
                        <span className="figure block text-(length:--text-2xs) text-text-muted">
                          @ {r.avg !== null ? formatNumber(r.avg, 2) : "—"}
                        </span>
                      </td>
                      <td className={cn(TD, "text-right")}>
                        <span className="figure">{r.price !== null ? formatNumber(r.price, 2) : "—"}</span>
                        <span
                          className={cn(
                            "figure block text-(length:--text-2xs) font-semibold",
                            (r.day ?? 0) > 0 ? "text-up" : (r.day ?? 0) < 0 ? "text-down" : "text-text-muted"
                          )}
                        >
                          {r.day !== null ? `${signed(r.day, 2)}%` : "—"}
                        </span>
                      </td>
                      <td className={cn(TD, "text-right")}>
                        <span className="figure">{formatNumber(r.value, 0)}</span>
                        <span className="figure block text-(length:--text-2xs) text-text-muted">
                          {formatNumber(r.weight, 1)}% of book
                        </span>
                      </td>
                      <td className={cn(TD, "pr-0 text-right", r.pl >= 0 ? "text-up" : "text-down")}>
                        <span className="figure font-semibold">{signed(r.pl, 0)}</span>
                        <span className="figure block text-(length:--text-2xs) font-semibold">
                          {r.ret !== null ? `${signed(r.ret, 2)}%` : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            );
          })}

          {sorted.length > 0 && (
            <tfoot>
              <tr className="border-t border-rule-strong">
                <td colSpan={3} className="px-3 py-3 pl-0 text-sm font-bold text-text-strong">
                  Total · {sorted.length} position{sorted.length === 1 ? "" : "s"}
                </td>
                <td className="figure px-3 py-3 text-right text-sm font-bold text-text-strong">
                  {formatNumber(totalValue, 0)}
                </td>
                <td className={cn("px-3 py-3 pr-0 text-right text-sm font-bold", totalPl >= 0 ? "text-up" : "text-down")}>
                  <span className="figure">{signed(totalPl, 0)}</span>
                  {totalRet !== null && <span className="figure block text-(length:--text-2xs)">{signed(totalRet, 2)}%</span>}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {sorted.length === 0 && (
        <p className="py-12 text-center text-sm text-text-muted">No holdings match this filter.</p>
      )}

      <p className="mt-4 text-(length:--text-2xs) text-text-faint">
        Cost basis {formatNumber(summary.totalCost, 0)} · market value {formatNumber(summary.totalValue, 0)}
      </p>
    </div>
  );
}
