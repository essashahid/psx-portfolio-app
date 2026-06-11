"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtPct, fmtPrice, fmtCompact, heatColor } from "@/lib/market/format";
import type { ItemRow } from "@/lib/market/read";
import { cn } from "@/lib/utils";

type Filter = "all" | "owned" | "watchlist" | "gainers" | "losers";

/**
 * Interactive PSX heatmap. Tiles are sized by market value traded (falling back
 * to volume), coloured by day change %, and weighted so the biggest movers in
 * value dominate the canvas. Filters (sector / owned / watchlist / gainers /
 * losers) re-flow instantly on the client; tiles link to the stock cockpit.
 * Renders a bounded set for performance and lets the user expand.
 */
export function MarketHeatmap({
  items,
  sectors,
  owned,
  watched,
}: {
  items: ItemRow[];
  sectors: string[];
  owned: string[];
  watched: string[];
}) {
  const ownedSet = useMemo(() => new Set(owned), [owned]);
  const watchSet = useMemo(() => new Set(watched), [watched]);
  const [filter, setFilter] = useState<Filter>("all");
  const [sector, setSector] = useState<string>("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    let rows = items.filter((i) => i.price != null);
    if (sector) rows = rows.filter((i) => i.sector === sector);
    if (filter === "owned") rows = rows.filter((i) => ownedSet.has(i.ticker));
    else if (filter === "watchlist") rows = rows.filter((i) => watchSet.has(i.ticker));
    else if (filter === "gainers") rows = rows.filter((i) => (i.change_percent ?? 0) > 0);
    else if (filter === "losers") rows = rows.filter((i) => (i.change_percent ?? 0) < 0);
    const weight = (i: ItemRow) => i.value_traded ?? i.volume ?? 0;
    return rows.sort((a, b) => weight(b) - weight(a));
  }, [items, filter, sector, ownedSet, watchSet]);

  const shown = expanded ? filtered.slice(0, 200) : filtered.slice(0, 80);

  // Size tiles by a damped value weight so a single mega-cap doesn't swallow the grid.
  const weights = shown.map((i) => Math.sqrt((i.value_traded ?? i.volume ?? 1) + 1));
  const maxW = Math.max(...weights, 1);

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "gainers", label: "Gainers" },
    { id: "losers", label: "Losers" },
    { id: "owned", label: "Owned" },
    { id: "watchlist", label: "Watchlist" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                filter === c.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="ml-auto h-7 rounded-md border border-border bg-card px-2 text-[11px] outline-none focus:ring-2 focus:ring-emerald-500/30"
        >
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">No stocks match this filter in today&apos;s snapshot.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {shown.map((i, idx) => {
            const w = weights[idx] / maxW; // 0..1
            // Map weight to a tile basis between ~70px and ~190px.
            const basis = 70 + w * 120;
            const isOwned = ownedSet.has(i.ticker);
            const isWatch = watchSet.has(i.ticker);
            return (
              <Link
                key={i.ticker}
                href={`/stocks/${i.ticker}`}
                title={`${i.ticker} · ${i.company_name ?? ""}\n${i.sector ?? ""}\nPrice ${fmtPrice(i.price)} · ${fmtPct(i.change_percent)}\nVolume ${fmtCompact(i.volume)} · Value ${fmtCompact(i.value_traded)}${isOwned ? "\nOwned" : isWatch ? "\nWatchlist" : ""}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-md p-1.5 text-white transition-transform duration-150 hover:z-10 hover:scale-[1.04] hover:shadow-lg"
                style={{ backgroundColor: heatColor(i.change_percent), flex: `1 1 ${basis}px`, minHeight: 56 + w * 26 }}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate text-[11px] font-semibold leading-none tracking-tight">{i.ticker}</span>
                  {isOwned && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" title="Owned" />}
                  {!isOwned && isWatch && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" title="Watchlist" />}
                </div>
                <span className="text-[11px] font-bold leading-none tabular-nums">{fmtPct(i.change_percent)}</span>
              </Link>
            );
          })}
        </div>
      )}

      {filtered.length > shown.length && (
        <div className="text-center">
          <button onClick={() => setExpanded(true)} className="text-[11px] font-medium text-emerald-600 hover:underline">
            Show more ({filtered.length - shown.length} hidden)
          </button>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Tile size ∝ value traded · colour ∝ day change % · {filtered.length} stocks match. White dot = owned, grey = watchlist.
      </p>
    </div>
  );
}
