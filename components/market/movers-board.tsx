"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtPct, fmtPrice, fmtCompact, tone } from "@/lib/market/format";
import type { MoverRow } from "@/lib/market/read";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, BarChart3, Coins, Zap, ArrowUpToLine, ArrowDownToLine } from "lucide-react";

const CATEGORIES: { id: string; label: string; icon: typeof TrendingUp; valueKey: "change_percent" | "volume" | "value_traded" }[] = [
  { id: "gainers", label: "Top gainers", icon: TrendingUp, valueKey: "change_percent" },
  { id: "losers", label: "Top losers", icon: TrendingDown, valueKey: "change_percent" },
  { id: "active_volume", label: "Volume leaders", icon: BarChart3, valueKey: "volume" },
  { id: "active_value", label: "Value leaders", icon: Coins, valueKey: "value_traded" },
  { id: "unusual_volume", label: "Unusual volume", icon: Zap, valueKey: "volume" },
  { id: "near_high", label: "Near 52w high", icon: ArrowUpToLine, valueKey: "change_percent" },
  { id: "near_low", label: "Near 52w low", icon: ArrowDownToLine, valueKey: "change_percent" },
];

/**
 * Top movers board — ranked lists across categories with an owned/watchlist
 * filter. Each row links to the stock cockpit and carries ownership badges.
 * All data is precomputed in the snapshot, so switching tabs is instant.
 */
export function MoversBoard({
  movers,
  owned,
  watched,
}: {
  movers: Record<string, MoverRow[]>;
  owned: string[];
  watched: string[];
}) {
  const ownedSet = useMemo(() => new Set(owned), [owned]);
  const watchSet = useMemo(() => new Set(watched), [watched]);
  const [cat, setCat] = useState<string>("gainers");
  const [mineOnly, setMineOnly] = useState(false);

  const active = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0];
  const rows = useMemo(() => {
    let list = movers[cat] ?? [];
    if (mineOnly) list = list.filter((r) => ownedSet.has(r.ticker) || watchSet.has(r.ticker));
    return list;
  }, [movers, cat, mineOnly, ownedSet, watchSet]);

  function valueLabel(r: MoverRow): string {
    if (active.valueKey === "change_percent") return fmtPct(r.change_percent);
    if (active.valueKey === "volume") return fmtCompact(r.volume);
    return fmtCompact(r.value_traded);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const count = (movers[c.id] ?? []).length;
          return (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              disabled={count === 0}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
                cat === c.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3 w-3" /> {c.label}
            </button>
          );
        })}
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={cn(
            "ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            mineOnly ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
          )}
        >
          Owned / watchlist
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          {mineOnly ? "None of your stocks are in this list today." : "No stocks in this category today."}
        </p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {rows.map((r, i) => {
            const isOwned = ownedSet.has(r.ticker);
            const isWatch = watchSet.has(r.ticker);
            const t = tone(active.valueKey === "change_percent" ? r.change_percent : r.change_percent);
            return (
              <Link
                key={r.ticker}
                href={`/stocks/${r.ticker}`}
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60"
              >
                <span className="w-5 shrink-0 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold">{r.ticker}</span>
                    {isOwned && <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-semibold text-emerald-700">OWNED</span>}
                    {!isOwned && isWatch && <span className="rounded bg-muted px-1 py-px text-[9px] font-semibold text-muted-foreground">WATCH</span>}
                  </div>
                  <p className="truncate text-[10px] text-muted-foreground">{r.company_name ?? r.sector ?? ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={cn(
                      "text-xs font-bold tabular-nums",
                      t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-foreground"
                    )}
                  >
                    {valueLabel(r)}
                  </span>
                  <p className="text-[10px] tabular-nums text-muted-foreground">{fmtPrice(r.price)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
