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
  Legend,
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
} from "@/components/chart-kit";
import { cn, formatMoney, formatSignedPct } from "@/lib/utils";

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
  { key: "portfolio", name: "Your portfolio", color: INK.line, width: 2.6, dash: undefined },
  { key: "kse100", name: "KSE-100 equivalent", color: INK.up, width: 1.8, dash: undefined },
  { key: "inflation", name: "Inflation-protected", color: INK.amber, width: 1.8, dash: undefined },
  { key: "contributed", name: "Contributed capital", color: INK.neutral, width: 1.6, dash: "5 4" },
] as const;

const MODE_CAPTION: Record<Mode, string> = {
  value: "Actual rupee value of each path over time.",
  indexed: "Every path rebased to 100 at the start, so you compare growth, not size.",
  real: "Each path expressed in today's rupees, so inflation is taken out and only real purchasing power remains.",
};

function monthLabel(iso: string) {
  return new Intl.DateTimeFormat("en-PK", { month: "short", year: "2-digit" }).format(
    new Date(`${iso}T12:00:00`)
  );
}

export function BenchmarkGrowthChart({ data }: { data: BenchmarkPointRow[] }) {
  const animate = useChartMotion();
  const [mode, setMode] = useState<Mode>("value");

  const series = useMemo(() => {
    if (data.length === 0) return [];
    const first = data[0];
    const latestCpi = data[data.length - 1].cpi ?? null;
    return data.map((row) => {
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
  }, [data, mode]);

  const latest = data[data.length - 1];
  const headline = useMemo(() => {
    if (!latest) return null;
    const gainVsContrib = latest.portfolio - latest.contributed;
    return {
      portfolio: latest.portfolio,
      gainVsContrib,
      gainPct: latest.contributed > 0 ? (gainVsContrib / latest.contributed) * 100 : null,
      vsKse: latest.portfolio - latest.kse100,
      vsInflation: latest.portfolio - latest.inflation,
    };
  }, [latest]);

  if (data.length < 2) {
    return (
      <section className="border-y border-border py-5">
        <h2 className="text-base font-semibold">Growth of invested capital</h2>
        <div className="pt-4"><ChartEmpty note="Benchmark history appears once the portfolio series has been built." /></div>
      </section>
    );
  }

  const valueFmt = (v: number) =>
    mode === "indexed" ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : fmtCompact(v);
  const tooltipFmt = (v: number) =>
    mode === "indexed" ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : formatMoney(v);

  return (
    <section className="border-y border-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-1">
        <div>
          <h2 className="text-base font-semibold">Growth of invested capital</h2>
          <p className="mt-1 text-xs text-muted-foreground">Your portfolio against the KSE-100 (total return) and inflation, using your real contribution schedule.</p>
        </div>
        <div className="flex rounded-md bg-muted p-0.5" aria-label="Display mode">
          {MODES.map((item) => (
            <button
              key={item.key}
              onClick={() => setMode(item.key)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                mode === item.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {headline && mode !== "indexed" && (
        <div className="flex flex-wrap items-baseline gap-x-7 gap-y-1 pb-3 pt-1">
          <div>
            <span className="text-2xl font-semibold tabular-nums">{formatMoney(headline.portfolio)}</span>
            <span className={cn("ml-2 text-xs font-medium tabular-nums", headline.gainVsContrib >= 0 ? "text-emerald-700" : "text-red-700")}>
              {formatMoney(headline.gainVsContrib)} ({formatSignedPct(headline.gainPct)}) on capital
            </span>
          </div>
          <MetricInline label="vs KSE-100" value={headline.vsKse} />
          <MetricInline label="vs inflation" value={headline.vsInflation} />
        </div>
      )}

      <div className="pt-1">
        <div className="chart-reveal">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={monthLabel} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={36} />
              <YAxis tickFormatter={valueFmt} tick={AXIS_TICK} domain={["auto", "auto"]} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<GlassTooltip format={tooltipFmt} labelFormat={(l) => monthLabel(String(l))} />} cursor={CURSOR} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="plainline" iconSize={14} />
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
        <p className="mt-2 text-xs text-muted-foreground">{MODE_CAPTION[mode]}</p>
      </div>
    </section>
  );
}

function MetricInline({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label} </span>
      <span className={cn("font-semibold tabular-nums", value >= 0 ? "text-emerald-700" : "text-red-700")}>{formatMoney(value)}</span>
    </div>
  );
}
