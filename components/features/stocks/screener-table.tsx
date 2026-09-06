"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn, formatNumber } from "@/lib/shared/format";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SectorDot } from "@/components/shared/sector-chip";
import { Sparkline } from "@/components/shared/sparkline";
import { shortSector } from "@/lib/shared/sector-colors";
import type { ScreenerStock } from "@/lib/market/screener";
import { useSortableTable, type SortValue } from "@/components/shared/use-sortable-table";

type SortKey = "ticker" | "price" | "change" | "volume" | "cap";
type Scope = "all" | "mine" | "watch";

const COLUMNS: { key: SortKey; label: string; sortName: string; align: "left" | "right" }[] = [
  { key: "ticker", label: "Company", sortName: "ticker", align: "left" },
  { key: "price", label: "Price · range", sortName: "price", align: "right" },
  { key: "change", label: "Day", sortName: "day move", align: "right" },
  { key: "volume", label: "Volume · value", sortName: "volume", align: "right" },
  { key: "cap", label: "Market cap", sortName: "market cap", align: "right" },
];

/** Column -> comparable value. Same branches the inline sorter used. */
function stockSortValue(s: ScreenerStock, key: SortKey): SortValue {
  switch (key) {
    case "ticker": return s.ticker;
    case "price": return s.price ?? 0;
    case "change": return s.changePercent ?? 0;
    case "volume": return s.volume ?? 0;
    case "cap": return s.marketCap ?? 0;
  }
}

const signed = (v: number, d = 2) => `${v < 0 ? "−" : "+"}${formatNumber(Math.abs(v), d)}`;
const compact = (v: number | null) =>
  v === null ? "—" : v >= 1e9 ? `${formatNumber(v / 1e9, 1)}bn` : v >= 1e6 ? `${formatNumber(v / 1e6, 1)}m` : formatNumber(v, 0);

/**
 * The PSX screener as a ledger: one row per company with its sector dot, the
 * price over its 52-week position, the day move, traded volume over value and
 * market cap, closed by a trend sparkline.
 */
export function ScreenerTable({ stocks, sectors }: { stocks: ScreenerStock[]; sectors: string[] }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sector, setSector] = useState<string>("");
  const [limit, setLimit] = useState(60);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks.filter((s) => {
      if (scope === "mine" && !s.owned) return false;
      if (scope === "watch" && !s.watched) return false;
      if (sector && s.sector !== sector) return false;
      if (!q) return true;
      return `${s.ticker} ${s.companyName ?? ""} ${s.sector ?? ""}`.toLowerCase().includes(q);
    });
  }, [stocks, query, scope, sector]);

  const { rows, sortKey, sortDir, sortBy } = useSortableTable<ScreenerStock, SortKey>(filtered, stockSortValue, "cap");

  const shown = rows.slice(0, limit);
  const sortLabel = COLUMNS.find((c) => c.key === sortKey)?.sortName ?? "market cap";
  const TH = "whitespace-nowrap pb-2.5 px-3 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps)";
  const TD = "px-3 py-3 align-middle";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by ticker, company or sector"
          aria-label="Filter companies"
          className="h-9 max-w-70"
        />
        <SegmentedControl
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "All PSX" },
            { value: "mine", label: "My holdings" },
            { value: "watch", label: "Watchlist" },
          ]}
          className="w-70 shrink-0"
        />
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          aria-label="Sector"
          className="h-9 rounded-md border border-rule bg-surface-raised px-2.5 text-xs text-text-strong"
        >
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{shortSector(s)}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-text-muted">
          {rows.length} compan{rows.length === 1 ? "y" : "ies"} · sorted by {sortLabel}
        </span>
      </div>

      <div className="scroll-touch w-full overflow-x-auto">
        <table className="w-full min-w-3xl text-sm">
          <thead>
            <tr className="border-b border-rule-strong">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => sortBy(col.key)}
                  className={cn(
                    TH,
                    "cursor-pointer select-none transition-colors first:pl-0",
                    col.align === "right" ? "text-right" : "text-left",
                    sortKey === col.key ? "text-text-strong" : "text-text-faint hover:text-text-muted"
                  )}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === -1 ? " ↓" : " ↑") : ""}
                </th>
              ))}
              <th className={cn(TH, "pr-0 text-right text-text-faint")}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const range =
                s.fiftyTwoWeekLow !== null && s.fiftyTwoWeekHigh !== null && s.price !== null && s.fiftyTwoWeekHigh > s.fiftyTwoWeekLow
                  ? ((s.price - s.fiftyTwoWeekLow) / (s.fiftyTwoWeekHigh - s.fiftyTwoWeekLow)) * 100
                  : null;
              return (
                <tr key={s.ticker} className="border-b border-rule transition-colors last:border-0 hover:bg-surface-sunken/50">
                  <td className={cn(TD, "pl-0")}>
                    <span className="flex items-center gap-2.5">
                      <SectorDot sector={s.sector} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <Link href={`/stocks/${s.ticker}`} className="font-semibold text-text-strong hover:underline">
                            {s.ticker}
                          </Link>
                          {s.owned && (
                            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-brand">Held</span>
                          )}
                          {!s.owned && s.watched && (
                            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Watching</span>
                          )}
                        </span>
                        <span className="block truncate text-(length:--text-2xs) text-text-muted">
                          {s.companyName ?? s.ticker} · {shortSector(s.sector)}
                        </span>
                      </span>
                    </span>
                  </td>

                  <td className={cn(TD, "text-right")}>
                    <span className="figure">{s.price !== null ? formatNumber(s.price, 2) : "—"}</span>
                    {range !== null ? (
                      <span className="mt-1.5 ml-auto block h-1 w-16 bg-surface-inset" title={`52-week ${formatNumber(s.fiftyTwoWeekLow!, 0)} to ${formatNumber(s.fiftyTwoWeekHigh!, 0)}`}>
                        <span
                          className="block h-1"
                          style={{
                            marginLeft: `${Math.min(96, Math.max(0, range))}%`,
                            width: 3,
                            background: s.nearHigh ? "var(--up-2)" : s.nearLow ? "var(--down-2)" : "var(--ink-3)",
                          }}
                        />
                      </span>
                    ) : (
                      <span className="figure block text-(length:--text-2xs) text-text-faint">no range</span>
                    )}
                  </td>

                  <td
                    className={cn(
                      TD,
                      "figure text-right font-semibold",
                      (s.changePercent ?? 0) > 0 ? "text-up" : (s.changePercent ?? 0) < 0 ? "text-down" : "text-text-muted"
                    )}
                  >
                    {s.changePercent !== null ? `${signed(s.changePercent)}%` : "—"}
                  </td>

                  <td className={cn(TD, "text-right")}>
                    <span className="figure">{compact(s.volume)}</span>
                    <span className="figure block text-(length:--text-2xs) text-text-muted">
                      {compact(s.valueTraded)}
                      {s.unusualVolume && <span className="ml-1.5 text-[var(--saffron-1)]">unusual</span>}
                    </span>
                  </td>

                  <td className={cn(TD, "figure text-right")}>{compact(s.marketCap)}</td>

                  <td className={cn(TD, "pr-0 text-right")}>
                    <span className="inline-block align-middle"><Sparkline data={s.spark} width={64} height={20} /></span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && <p className="py-12 text-center text-sm text-text-muted">No companies match this filter.</p>}

      {rows.length > shown.length && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((n) => n + 60)}
            className="rounded-(--radius-sm) border border-rule bg-surface-raised px-4 py-2 text-xs font-semibold text-text-strong transition-colors hover:bg-surface-sunken"
          >
            Show 60 more · {rows.length - shown.length} remaining
          </button>
        </div>
      )}
    </div>
  );
}
