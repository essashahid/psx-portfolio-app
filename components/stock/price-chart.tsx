"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn, formatNumber, formatSignedPct } from "@/lib/utils";
import {
  INK,
  EASE,
  DRAW_MS,
  useChartMotion,
  GlassTooltip,
  CURSOR,
  FadeDefs,
  AXIS_TICK,
} from "@/components/chart-kit";
import type { Candle } from "@/lib/company/types";

const RANGES: { id: string; days: number; label: string }[] = [
  { id: "1M", days: 22, label: "1M" },
  { id: "3M", days: 66, label: "3M" },
  { id: "6M", days: 132, label: "6M" },
  { id: "1Y", days: 252, label: "1Y" },
  { id: "3Y", days: 756, label: "3Y" },
  { id: "5Y", days: 1300, label: "5Y" },
];

function sma(values: number[], period: number, index: number): number | null {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) sum += values[i];
  return sum / period;
}

export function StockPriceChart({ candles }: { candles: Candle[] }) {
  const animate = useChartMotion();
  const [range, setRange] = useState("1Y");
  const [showMA, setShowMA] = useState(true);

  const data = useMemo(() => {
    const closes = candles.map((c) => c.close);
    const enriched = candles.map((c, i) => ({
      date: c.date,
      close: c.close,
      volume: c.volume,
      up: i === 0 ? true : c.close >= candles[i - 1].close,
      ma50: sma(closes, 50, i),
      ma200: sma(closes, 200, i),
    }));
    const days = RANGES.find((r) => r.id === range)?.days ?? 252;
    return enriched.slice(-days);
  }, [candles, range]);

  // Range performance readout shown next to the selector.
  const rangeChange = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0].close;
    const last = data[data.length - 1].close;
    return ((last - first) / first) * 100;
  }, [data]);

  if (candles.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center">
        <p className="text-xs text-muted-foreground">No price history available from the PSX portal.</p>
      </div>
    );
  }

  const trendUp = rangeChange === null || rangeChange >= 0;
  const lineColor = trendUp ? INK.up : INK.down;
  const tickEvery = Math.max(1, Math.floor(data.length / 6));
  // Long ranges: shorten the draw so 1,300-point sweeps still feel snappy.
  const drawMs = data.length > 400 ? 600 : DRAW_MS;

  return (
    <div className="chart-reveal">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                  range === r.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {rangeChange !== null && (
            <span
              className={cn(
                "text-xs font-semibold tabular-nums transition-colors",
                trendUp ? "text-emerald-600" : "text-red-600"
              )}
            >
              {formatSignedPct(rangeChange)}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowMA((v) => !v)}
          className={cn(
            "rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-200",
            showMA ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"
          )}
        >
          {showMA ? "Hide" : "Show"} MA 50/200
        </button>
      </div>

      {/* key={range} re-triggers the draw sweep on every range switch */}
      <ResponsiveContainer key={range} width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
          <FadeDefs defs={[{ id: `priceFade-${trendUp ? "up" : "down"}`, color: lineColor, from: 0.2, to: 0 }]} />
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={AXIS_TICK}
            interval={tickEvery}
            tickFormatter={(d: string) => d?.slice(2)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="price"
            tick={AXIS_TICK}
            domain={["auto", "auto"]}
            width={48}
            tickFormatter={(v: number) => v.toFixed(0)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={
              <GlassTooltip
                format={(v, key) =>
                  key === "volume" ? Number(v).toLocaleString("en-PK") : formatNumber(Number(v))
                }
              />
            }
            cursor={CURSOR}
          />
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="close"
            name="Close"
            stroke={lineColor}
            strokeWidth={2}
            fill={`url(#priceFade-${trendUp ? "up" : "down"})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fbfbf9", fill: lineColor }}
            isAnimationActive={animate}
            animationDuration={drawMs}
            animationEasing={EASE}
          />
          {showMA && (
            <>
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="ma50"
                name="MA50"
                stroke={INK.amber}
                strokeWidth={1.3}
                dot={false}
                connectNulls
                isAnimationActive={animate}
                animationDuration={drawMs}
                animationBegin={animate ? 150 : 0}
                animationEasing={EASE}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="ma200"
                name="MA200"
                stroke={INK.terracotta}
                strokeWidth={1.3}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                isAnimationActive={animate}
                animationDuration={drawMs}
                animationBegin={animate ? 250 : 0}
                animationEasing={EASE}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <ResponsiveContainer key={`vol-${range}`} width="100%" height={70}>
        <ComposedChart data={data} margin={{ top: 2, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[0, "auto"]} width={48} />
          <Tooltip
            content={
              <GlassTooltip format={(v) => Number(v).toLocaleString("en-PK")} />
            }
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
          />
          <Bar
            dataKey="volume"
            name="Volume"
            radius={[2, 2, 0, 0]}
            isAnimationActive={animate}
            animationDuration={drawMs}
            animationBegin={animate ? 200 : 0}
            animationEasing={EASE}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.up ? INK.upSoft : INK.downSoft} opacity={0.55} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
