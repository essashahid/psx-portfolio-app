"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkline } from "@/components/market/sparkline";
import { fmtPct, fmtPrice, fmtCompact, tone } from "@/lib/market/format";
import type { ScreenerStock } from "@/lib/market/screener";
import { cn } from "@/lib/utils";
import { Search, ArrowUp, ArrowDown, Star, Briefcase, Flame, TrendingUp, TrendingDown } from "lucide-react";

type SortKey = "value" | "change" | "volume" | "price" | "marketCap" | "ticker";
type Quick = "all" | "gainers" | "losers" | "near_high" | "near_low" | "unusual" | "owned" | "watchlist";

const QUICK_FILTERS: { id: Quick; label: string; icon?: typeof Flame }[] = [
  { id: "all", label: "All" },
  { id: "gainers", label: "Gainers", icon: TrendingUp },
  { id: "losers", label: "Losers", icon: TrendingDown },
  { id: "near_high", label: "Near 52w high" },
  { id: "near_low", label: "Near 52w low" },
  { id: "unusual", label: "Unusual volume", icon: Flame },
  { id: "owned", label: "Owned", icon: Briefcase },
  { id: "watchlist", label: "Watchlist", icon: Star },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Value" },
  { key: "change", label: "Change %" },
  { key: "volume", label: "Volume" },
  { key: "price", label: "Price" },
  { key: "marketCap", label: "Mkt cap" },
  { key: "ticker", label: "A–Z" },
];

const PAGE = 60;

function FiftyTwoWeekBar({ s }: { s: ScreenerStock }) {
  if (s.price == null || s.fiftyTwoWeekHigh == null || s.fiftyTwoWeekLow == null || s.fiftyTwoWeekHigh <= s.fiftyTwoWeekLow) {
    return <div className="h-1.5 w-full rounded-full bg-muted" />;
  }
  const pos = Math.max(0, Math.min(1, (s.price - s.fiftyTwoWeekLow) / (s.fiftyTwoWeekHigh - s.fiftyTwoWeekLow)));
  return (
    <div className="relative h-1.5 w-full rounded-full bg-gradient-to-r from-red-200 via-amber-200 to-emerald-200">
      <span
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-foreground shadow"
        style={{ left: `${pos * 100}%` }}
      />
    </div>
  );
}

export function StockScreener({ stocks }: { stocks: ScreenerStock[] }) {
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [sector, setSector] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [desc, setDesc] = useState(true);
  const [visible, setVisible] = useState(PAGE);

  const sectors = useMemo(() => [...new Set(stocks.map((s) => s.sector).filter((x): x is string => !!x))].sort(), [stocks]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let rows = stocks;
    if (q) rows = rows.filter((s) => s.ticker.includes(q) || (s.companyName ?? "").toUpperCase().includes(q));
    if (sector) rows = rows.filter((s) => s.sector === sector);
    switch (quick) {
      case "gainers": rows = rows.filter((s) => (s.changePercent ?? 0) > 0); break;
      case "losers": rows = rows.filter((s) => (s.changePercent ?? 0) < 0); break;
      case "near_high": rows = rows.filter((s) => s.nearHigh); break;
      case "near_low": rows = rows.filter((s) => s.nearLow); break;
      case "unusual": rows = rows.filter((s) => s.unusualVolume); break;
      case "owned": rows = rows.filter((s) => s.owned); break;
      case "watchlist": rows = rows.filter((s) => s.watched); break;
    }
    const val = (s: ScreenerStock): number | string => {
      switch (sortKey) {
        case "value": return s.valueTraded ?? 0;
        case "change": return s.changePercent ?? -Infinity;
        case "volume": return s.volume ?? 0;
        case "price": return s.price ?? 0;
        case "marketCap": return s.marketCap ?? 0;
        case "ticker": return s.ticker;
      }
    };
    const sorted = [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * (desc ? -1 : 1);
      return (va - vb) * (desc ? -1 : 1);
    });
    return sorted;
  }, [stocks, query, quick, sector, sortKey, desc]);

  function applySort(key: SortKey) {
    if (key === sortKey) setDesc((d) => !d);
    else { setSortKey(key); setDesc(key !== "ticker"); }
    setVisible(PAGE);
  }
  function resetVisible() { setVisible(PAGE); }

  const shown = filtered.slice(0, visible);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetVisible(); }}
            placeholder="Filter by ticker or company…"
            className="h-11 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-base outline-none focus:ring-2 focus:ring-emerald-500/30 md:h-9 md:text-sm"
          />
        </div>
        <select
          value={sector}
          onChange={(e) => { setSector(e.target.value); resetVisible(); }}
          className="h-11 rounded-lg border border-border bg-card px-2 text-base outline-none focus:ring-2 focus:ring-emerald-500/30 md:h-9 md:text-xs"
        >
          <option value="">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="scroll-touch -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {QUICK_FILTERS.map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              onClick={() => { setQuick(f.id); resetVisible(); }}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors md:h-auto md:px-2.5 md:py-1",
                quick === f.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {Icon && <Icon className="h-3 w-3" />}{f.label}
            </button>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Sort</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => applySort(s.key)}
              className={cn(
                "flex h-10 shrink-0 items-center gap-0.5 rounded-md px-2 text-[11px] font-medium transition-colors md:h-auto md:py-1",
                sortKey === s.key ? "bg-emerald-50 text-emerald-700" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}{sortKey === s.key && (desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">{filtered.length} stocks</p>

      {/* Header (desktop) */}
      <div className="hidden grid-cols-[minmax(0,2.2fr)_72px_minmax(0,1fr)_90px_88px_88px_92px] items-center gap-2 border-b border-border px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
        <span>Company</span>
        <span className="text-center">Trend</span>
        <span>52-week range</span>
        <span className="text-right">Price</span>
        <span className="text-right">Change</span>
        <span className="text-right">Volume</span>
        <span className="text-right">Value</span>
      </div>

      {/* Rows */}
      {shown.length === 0 ? (
        <p className="py-12 text-center text-xs text-muted-foreground">No stocks match these filters.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {shown.map((s) => {
            const t = tone(s.changePercent);
            return (
              <Link
                key={s.ticker}
                href={`/stocks/${s.ticker}`}
                className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/50 lg:min-h-0 lg:grid-cols-[minmax(0,2.2fr)_72px_minmax(0,1fr)_90px_88px_88px_92px] lg:py-2"
              >
                {/* Company */}
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold">{s.ticker}</span>
                      {s.owned && <Briefcase className="h-3 w-3 text-emerald-600" aria-label="Owned" />}
                      {!s.owned && s.watched && <Star className="h-3 w-3 text-amber-500" aria-label="Watchlist" />}
                      {s.nearHigh && <span className="rounded bg-emerald-50 px-1 text-[8px] font-semibold text-emerald-700">52W HI</span>}
                      {s.nearLow && <span className="rounded bg-red-50 px-1 text-[8px] font-semibold text-red-700">52W LO</span>}
                      {s.unusualVolume && <Flame className="h-3 w-3 text-amber-500" aria-label="Unusual volume" />}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{s.companyName ?? s.sector ?? ""}</p>
                  </div>
                </div>

                {/* Sparkline */}
                <div className="hidden justify-center lg:flex">
                  <Sparkline data={s.spark} />
                </div>

                {/* 52w range */}
                <div className="hidden lg:block">
                  <FiftyTwoWeekBar s={s} />
                  <div className="mt-1 flex justify-between text-[9px] tabular-nums text-muted-foreground">
                    <span>{fmtPrice(s.fiftyTwoWeekLow)}</span>
                    <span>{fmtPrice(s.fiftyTwoWeekHigh)}</span>
                  </div>
                </div>

                {/* Price + change (mobile groups these on the right) */}
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{fmtPrice(s.price)}</p>
                  <p className={cn("text-[11px] tabular-nums lg:hidden", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-muted-foreground")}>{fmtPct(s.changePercent)}</p>
                </div>
                <div className="hidden text-right lg:block">
                  <span className={cn("inline-block rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums", t === "positive" ? "bg-emerald-50 text-emerald-700" : t === "negative" ? "bg-red-50 text-red-700" : "text-muted-foreground")}>
                    {fmtPct(s.changePercent)}
                  </span>
                </div>
                <div className="hidden text-right text-xs tabular-nums text-muted-foreground lg:block">{fmtCompact(s.volume)}</div>
                <div className="hidden text-right text-xs tabular-nums text-muted-foreground lg:block">₨{fmtCompact(s.valueTraded)}</div>
              </Link>
            );
          })}
        </div>
      )}

      {filtered.length > visible && (
        <div className="text-center">
          <button onClick={() => setVisible((v) => v + PAGE)} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium transition-colors hover:bg-muted">
            Show more ({filtered.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
