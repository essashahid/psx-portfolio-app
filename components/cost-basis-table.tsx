"use client";

import Link from "next/link";
import { cn, formatNumber, plColor } from "@/lib/utils";
import type { CostBasisRow } from "@/lib/engine/ledger-analytics";

export function CostBasisTable({ rows }: { rows: CostBasisRow[] }) {
  return (
    <div className="scroll-touch -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-4">Ticker</th>
            <th className="pb-2 pr-4 text-right">Qty</th>
            <th className="pb-2 pr-4 text-right">Avg Cost</th>
            <th className="pb-2 pr-4 text-right">Price</th>
            <th className="pb-2 pr-4 text-right">Mkt Value</th>
            <th className="pb-2 pr-4 text-right">Gain / Loss</th>
            <th className="pb-2 pr-4 text-right">%</th>
            <th className="pb-2 pr-4 text-right">Wt</th>
            <th className="pb-2 text-left">Sector</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.ticker} className="group hover:bg-accent/40 transition-colors">
              <td className="py-2.5 pr-4">
                <Link
                  href={`/stocks/${r.ticker}`}
                  className="font-mono text-[13px] font-semibold text-foreground transition-colors hover:text-[#3450c8]"
                >
                  {r.ticker}
                </Link>
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {formatNumber(r.quantity, 0)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                {formatNumber(r.avgCost)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">
                {r.currentPrice !== null ? formatNumber(r.currentPrice) : "—"}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums font-medium">
                {r.marketValue !== null ? formatNumber(r.marketValue, 0) : "—"}
              </td>
              <td className={cn("py-2.5 pr-4 text-right tabular-nums font-medium", plColor(r.unrealizedPl))}>
                {r.unrealizedPl !== null
                  ? (r.unrealizedPl >= 0 ? "+" : "") + formatNumber(r.unrealizedPl, 0)
                  : "—"}
              </td>
              <td className={cn("py-2.5 pr-4 text-right tabular-nums text-sm", plColor(r.unrealizedPlPct))}>
                {r.unrealizedPlPct !== null
                  ? `${r.unrealizedPlPct >= 0 ? "+" : ""}${r.unrealizedPlPct}%`
                  : "—"}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">
                {r.weightPct !== null ? `${r.weightPct}%` : "—"}
              </td>
              <td className="py-2.5 text-xs text-muted-foreground">{r.sector}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
