"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
 
} from "recharts";
import {
  INK,
  EASE,
  DRAW_MS,
  useChartMotion,
  fmtCompact,
  GlassTooltip,
  CURSOR,
  ChartEmpty,
  AXIS_TICK,
} from "@/components/shared/chart-kit";
import { cn, formatMoney, formatSignedPct } from "@/lib/shared/format";

export interface BenchmarkPointRow {
  date: string; // YYYY-MM-DD
  contributed: number;
  portfolio: number;
  kse100: number;
  inflation: number;
  cpi: number | null;
}

const MODES = [
  { key: "value", label: "Actual PKR" },
  { key: "indexed", label: "Growth of 100" },
  { key: "real", label: "Real value" },
] as const;
type Mode = (typeof MODES)[number]["key"];

const LINES = [
  { key: "portfolio", name: "Your portfolio", color: "var(--chart-line)", width: 2.25, dash: undefined },
  { key: "kse100", name: "KSE-100 equivalent", color: "var(--up-1)", width: 1.75, dash: undefined },
  { key: "inflation", name: "Inflation-protected", color: "var(--saffron-2)", width: 1.5, dash: undefined },
  { key: "contributed", name: "Contributed capital", color: "var(--flat-2)", width: 1.5, dash: "4 4" },
] as const;

const MODE_CAPTION: Record<Mode, string> = {
  value: "Actual rupee value of each path over time.",
  indexed: "Every path rebased to 100 at the start, so you compare growth, not size.",
  real: "Each path expressed in today's rupees, so inflation is taken out and only real purchasing power remains.",
};

const RANGES = [
  { key: "1y", label: "1Y", months: 12 },
  { key: "3y", label: "3Y", months: 36 },
  { key: "5y", label: "5Y", months: 60 },
  { key: "all", label: "All", months: null },
] as const;
type Range = (typeof RANGES)[number]["key"];

function rangeCutoff(range: Range, latestDate: string): string | null {
  const found = RANGES.find((r) => r.key === range);
  if (!found?.months) return null;
  const d = new Date(`${latestDate}T12:00:00`);
  d.setMonth(d.getMonth() - found.months);
  return d.toISOString().slice(0, 10);
}

function monthLabel(iso: string) {
  return new Intl.DateTimeFormat("en-PK", { month: "short", year: "2-digit" }).format(
    new Date(`${iso}T12:00:00`)
  );
}

export function BenchmarkGrowthChart({ data }: { data: BenchmarkPointRow[] }) {
  const animate = useChartMotion();
  const [mode, setMode] = useState<Mode>("value");
  const [range, setRange] = useState<Range>("all");

  const ranged = useMemo(() => {
    if (data.length === 0) return data;
    const cutoff = rangeCutoff(range, data[data.length - 1].date);
    if (!cutoff) return data;
    const sliced = data.filter((row) => row.date >= cutoff);
    return sliced.length >= 2 ? sliced : data;
  }, [data, range]);

  const series = useMemo(() => {
    if (ranged.length === 0) return [];
    const first = ranged[0];
    const latestCpi = ranged[ranged.length - 1].cpi ?? null;
    return ranged.map((row) => {
      const out: Record<string, number | string> = { date: row.date };
      for (const line of LINES) {
        const raw = row[line.key] as number;
        if (mode === "indexed") {
          const base = first[line.key] as number;
          out[line.key] = base > 0 ? (raw / base) * 100 : 0;
        } else if (mode === "real" && row.cpi && latestCpi) {
          out[line.key] = (raw * latestCpi) / row.cpi;
        } else {
          out[line.key] = raw;
        }
      }
      return out;
    });
  }, [ranged, mode]);

  if (data.length < 2) {
    return <ChartEmpty note="Benchmark history appears once the portfolio series has been built." />;
  }

  const valueFmt = (v: number) =>
    mode === "indexed" ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : fmtCompact(v);
  const tooltipFmt = (v: number) =>
    mode === "indexed" ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : formatMoney(v);
  const latestRow = series[series.length - 1] as Record<string, number | string> | undefined;
  const pill = (selected: boolean) =>
    cn(
      "whitespace-nowrap rounded-full px-[13px] py-[5px] text-xs font-semibold transition-colors",
      selected ? "bg-surface-raised text-text-strong shadow-[0_1px_2px_rgba(13,18,15,0.08)]" : "text-text-muted hover:text-text-strong"
    );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-end gap-3.5 pb-4">
        <div role="radiogroup" aria-label="Time range" className="inline-flex gap-0.5 rounded-full border border-rule bg-surface-inset p-[3px]">
          {RANGES.map((item) => (
            <button key={item.key} type="button" role="radio" aria-checked={range === item.key} onClick={() => setRange(item.key)} className={pill(range === item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Basis" className="inline-flex gap-0.5 rounded-full border border-rule bg-surface-inset p-[3px]">
          {MODES.map((item) => (
            <button key={item.key} type="button" role="radio" aria-checked={mode === item.key} onClick={() => setMode(item.key)} className={pill(mode === item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        {LINES.map((line) => (
          <span key={line.key} className="inline-flex items-baseline gap-2">
            <span className="h-[2.5px] w-3.5 self-center rounded-sm" style={{ background: line.color }} />
            <span className="text-xs text-text-muted">{line.name}</span>
            <span className={cn("figure text-sm font-semibold", line.key === "portfolio" ? "text-text-strong" : "text-text-muted")}>
              {latestRow ? valueFmt(Number(latestRow[line.key])) : "—"}
            </span>
          </span>
        ))}
      </div>

      <div className="pt-1">
        <div className="chart-reveal">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={monthLabel} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={36} />
              <YAxis tickFormatter={valueFmt} tick={AXIS_TICK} domain={["auto", "auto"]} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<GlassTooltip format={tooltipFmt} labelFormat={(l) => monthLabel(String(l))} />} cursor={CURSOR} />
              {LINES.map((line) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.name}
                  stroke={line.color}
                  strokeWidth={line.width}
                  strokeDasharray={line.dash}
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 0, fill: line.color }}
                  isAnimationActive={animate}
                  animationDuration={DRAW_MS}
                  animationEasing={EASE}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-text-muted">{MODE_CAPTION[mode]}</p>
      </div>
    </section>
  );
}

