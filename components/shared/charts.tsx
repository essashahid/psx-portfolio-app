"use client";

import { useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  INK,
  SERIES_COLORS,
  EASE,
  DRAW_MS,
  useChartMotion,
  fmtCompact,
  fmtPkr,
  GlassTooltip,
  FadeDefs,
  ChartEmpty,
  AXIS_TICK,
} from "@/components/shared/chart-kit";
import { sectorColor } from "@/lib/shared/sector-colors";

// ---------------------------------------------------------------------------
// Allocation donut — animated sweep-in, hover focus, live center readout
// ---------------------------------------------------------------------------

export function AllocationPie({
  data,
  palette = "series",
}: {
  data: { name: string; value: number }[];
  /** "sector" keys each slice to its stable sector colour; "series" cycles the editorial palette. */
  palette?: "series" | "sector";
}) {
  const animate = useChartMotion();
  const [active, setActive] = useState<number | null>(null);
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  if (!data.length) return <ChartEmpty />;

  const focused = active !== null ? data[active] : null;

  return (
    <div className="chart-reveal relative">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={58}
            outerRadius={86}
            paddingAngle={2.5}
            cornerRadius={5}
            strokeWidth={0}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={palette === "sector" ? sectorColor(d.name) : SERIES_COLORS[i % SERIES_COLORS.length]}
                opacity={active === null || active === i ? 1 : 0.25}
                style={{ transition: "opacity 200ms ease" }}
              />
            ))}
          </Pie>
          <Tooltip content={<GlassTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            iconType="circle"
            iconSize={7}
            formatter={(v) => <span style={{ color: "#5c5c54" }}>{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Center readout — total at rest, slice share on hover */}
      <div className="pointer-events-none absolute inset-x-0 top-[86px] flex flex-col items-center">
        <p className="max-w-[6.875rem] truncate text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {focused ? focused.name : "Total"}
        </p>
        <p className="text-sm font-semibold tabular-nums">
          {focused
            ? `${total > 0 ? ((focused.value / total) * 100).toFixed(1) : "0"}%`
            : fmtCompact(total)}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Target vs actual — solid ink vs airy outline pairing
// ---------------------------------------------------------------------------

export function TargetVsActualBar({
  data,
}: {
  data: { ticker: string; actual: number; target: number }[];
}) {
  const animate = useChartMotion();
  if (!data.length) return <ChartEmpty note="Set target allocations in Goals & Targets." />;
  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }} barGap={3}>
          <FadeDefs defs={[{ id: "actualInk", color: INK.line, from: 0.95, to: 0.6 }]} />
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis dataKey="ticker" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            content={<GlassTooltip format={(v) => `${Number(v).toFixed(1)}%`} />}
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
          <Bar
            dataKey="actual"
            name="Actual %"
            fill="url(#actualInk)"
            radius={[5, 5, 1, 1]}
            maxBarSize={30}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          />
          <Bar
            dataKey="target"
            name="Target %"
            fill={INK.grid}
            stroke={INK.neutral}
            strokeWidth={1}
            radius={[5, 5, 1, 1]}
            maxBarSize={30}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationBegin={animate ? 120 : 0}
            animationEasing={EASE}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance workspace charts
// ---------------------------------------------------------------------------

function downloadCsv(fileName: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function CostFrictionBars({
  data,
}: {
  data: { category: string; amount: number; note: string }[];
}) {
  const animate = useChartMotion();
  const rows = data.filter((row) => row.amount > 0);
  if (!rows.length) return <ChartEmpty note="No recorded costs available." />;
  return (
    <div className="chart-reveal">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="rounded-md border border-rule px-2 py-1 text-[11px] text-text-muted hover:text-text-strong"
          onClick={() => downloadCsv("cost-friction.csv", data)}
        >
          Export CSV
        </button>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 42 + 54)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 14, bottom: 8, left: 14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickFormatter={fmtCompact} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="category" tick={AXIS_TICK} width={140} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : null;
              if (!row) return null;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{row.category}</p>
                  <div className="flex items-center justify-between gap-5 text-[11px]">
                    <span className="text-text-muted">Recorded</span>
                    <span className="font-semibold tabular-nums">{fmtPkr(row.amount)}</span>
                  </div>
                  <p className="mt-2 max-w-[15rem] text-[11px] text-text-muted">{row.note}</p>
                </div>
              );
            }}
          />
          <Bar
            dataKey="amount"
            name="Cost"
            fill={INK.down}
            radius={[0, 5, 5, 0]}
            maxBarSize={30}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
