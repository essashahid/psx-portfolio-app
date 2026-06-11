"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, ReferenceLine, Tooltip } from "recharts";
import { INK, EASE, DRAW_MS, useChartMotion, AXIS_TICK } from "@/components/chart-kit";
import { fmtPct, fmtCompact } from "@/lib/market/format";
import type { SectorRow } from "@/lib/market/read";
import { cn } from "@/lib/utils";

type Metric = "return" | "volume";

/**
 * Sector performance — horizontal bars of average return (green/red by sign),
 * toggleable to sector volume. Animated draw-in, glass tooltip with breadth.
 * Sectors with too few stocks to be meaningful are filtered out.
 */
export function SectorBars({ sectors }: { sectors: SectorRow[] }) {
  const animate = useChartMotion();
  const [metric, setMetric] = useState<Metric>("return");

  const data = useMemo(() => {
    const rows = sectors.filter((s) => s.stock_count >= 2);
    if (metric === "return") {
      return rows
        .filter((s) => s.average_return != null)
        .sort((a, b) => (b.average_return ?? 0) - (a.average_return ?? 0))
        .map((s) => ({ ...s, value: s.average_return ?? 0 }));
    }
    return rows
      .slice()
      .sort((a, b) => b.total_volume - a.total_volume)
      .slice(0, 14)
      .map((s) => ({ ...s, value: s.total_volume }));
  }, [sectors, metric]);

  const height = Math.max(260, data.length * 26);

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1">
        {(["return", "volume"] as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
              metric === m ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {m === "return" ? "Avg return" : "Volume"}
          </button>
        ))}
      </div>
      <div className="chart-reveal">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={4}>
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => (metric === "return" ? `${v}%` : fmtCompact(v))} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="sector" tick={{ ...AXIS_TICK, fontSize: 10 }} width={120} axisLine={false} tickLine={false} interval={0} />
            {metric === "return" && <ReferenceLine x={0} stroke={INK.neutral} strokeWidth={1} />}
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const s = payload[0].payload as SectorRow;
                const rows: [string, string][] = [
                  ["Avg return", fmtPct(s.average_return)],
                  ["Median", fmtPct(s.median_return)],
                  ["Volume", fmtCompact(s.total_volume)],
                  ["Breadth", `${s.advancers}↑ / ${s.decliners}↓ (${s.stock_count})`],
                ];
                return (
                  <div className="chart-tooltip">
                    <p className="chart-tooltip-label">{s.sector}</p>
                    <div className="space-y-1">
                      {rows.map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-4">
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          <span className="text-[11px] font-semibold tabular-nums">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" isAnimationActive={animate} animationDuration={DRAW_MS} animationEasing={EASE} radius={[0, 3, 3, 0]}>
              {data.map((s, i) => (
                <Cell key={i} fill={metric === "volume" ? INK.line : (s.value >= 0 ? INK.up : INK.down)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
