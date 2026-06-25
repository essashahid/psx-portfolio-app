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
  ReferenceLine,
  AreaChart,
  Area,
  ComposedChart,
  Line,
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
  CURSOR,
  FadeDefs,
  ChartEmpty,
  AXIS_TICK,
} from "@/components/chart-kit";
import { sectorColor } from "@/lib/sectors";

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
        <p className="max-w-[110px] truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
// Gain/loss bars — directional gradients, soft hover wash
// ---------------------------------------------------------------------------

export function GainLossBar({ data }: { data: { ticker: string; pl: number }[] }) {
  const animate = useChartMotion();
  if (!data.length) return <ChartEmpty note="Needs latest prices to compute gain/loss." />;
  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
          <FadeDefs
            defs={[
              { id: "plUp", color: INK.up, from: 0.95, to: 0.5 },
              { id: "plDown", color: INK.down, from: 0.5, to: 0.95 },
            ]}
          />
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis dataKey="ticker" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickFormatter={fmtCompact} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "rgba(0,0,0,0.035)" }} />
          <ReferenceLine y={0} stroke={INK.neutral} strokeWidth={1} />
          <Bar
            dataKey="pl"
            name="Unrealized P/L"
            radius={[5, 5, 1, 1]}
            maxBarSize={42}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.pl >= 0 ? "url(#plUp)" : "url(#plDown)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily holding performance — rupee contribution per position
// ---------------------------------------------------------------------------

export function DailyHoldingPerformanceBar({
  data,
}: {
  data: { ticker: string; dayPnl: number | null; dayChangePct: number | null; marketValue: number | null }[];
}) {
  const animate = useChartMotion();
  const rows = useMemo(
    () =>
      data
        .filter((d) => d.dayPnl !== null)
        .sort((a, b) => Math.abs(b.dayPnl ?? 0) - Math.abs(a.dayPnl ?? 0))
        .slice(0, 14),
    [data]
  );

  if (!rows.length) return <ChartEmpty note="Needs daily market quotes to compute per-holding impact." />;

  const height = Math.min(380, Math.max(230, rows.length * 34 + 58));

  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 6, right: 16, bottom: 8, left: 4 }}>
          <FadeDefs
            defs={[
              { id: "dayPnlUp", color: INK.up, from: 0.95, to: 0.58 },
              { id: "dayPnlDown", color: INK.down, from: 0.58, to: 0.95 },
            ]}
          />
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickFormatter={fmtCompact} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="ticker" tick={AXIS_TICK} width={58} axisLine={false} tickLine={false} />
          <ReferenceLine x={0} stroke={INK.neutral} strokeWidth={1} />
          <Tooltip
            content={
              <GlassTooltip
                format={(v, key) => (key === "dayChangePct" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : fmtPkr(v))}
              />
            }
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
          />
          <Bar
            dataKey="dayPnl"
            name="Day P/L"
            radius={[0, 5, 5, 0]}
            maxBarSize={28}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          >
            {rows.map((d) => (
              <Cell key={d.ticker} fill={d.dayPnl != null && d.dayPnl >= 0 ? "url(#dayPnlUp)" : "url(#dayPnlDown)"} />
            ))}
          </Bar>
          <Bar dataKey="dayChangePct" name="Day %" hide />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ratio factor snapshot — normalized 0-100 fundamentals profile
// ---------------------------------------------------------------------------

export function RatioSnapshotChart({
  data,
}: {
  data: { factor: string; score: number; summary: string }[];
}) {
  const animate = useChartMotion();
  const rows = useMemo(
    () => data.filter((d) => Number.isFinite(d.score)).sort((a, b) => b.score - a.score),
    [data]
  );

  if (!rows.length) return <ChartEmpty note="Computed ratios will appear here once enough fundamentals are available." />;

  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={Math.max(230, rows.length * 42 + 36)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, bottom: 6, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="factor" tick={AXIS_TICK} width={118} axisLine={false} tickLine={false} />
          <ReferenceLine x={50} stroke={INK.neutral} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : null;
              if (!row) return null;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{row.factor}</p>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Score</span>
                      <span className="font-semibold tabular-nums">{row.score.toFixed(0)} / 100</span>
                    </div>
                    <p className="max-w-[260px] leading-snug text-muted-foreground">{row.summary}</p>
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="score"
            name="Factor score"
            radius={[0, 5, 5, 0]}
            maxBarSize={28}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          >
            {rows.map((row) => (
              <Cell
                key={row.factor}
                fill={row.score >= 70 ? INK.up : row.score >= 50 ? INK.line : row.score >= 35 ? INK.amber : INK.down}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
// Portfolio value — luminous gradient area with cost-basis ghost line
// ---------------------------------------------------------------------------

export function ValueLine({ data }: { data: { date: string; value: number; cost: number }[] }) {
  const animate = useChartMotion();
  if (data.length < 2)
    return <ChartEmpty note="Portfolio value over time appears once at least two daily snapshots exist." />;
  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 10, bottom: 5, left: 10 }}>
          <FadeDefs defs={[{ id: "valueFade", color: INK.line, from: 0.22, to: 0 }]} />
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis
            tick={AXIS_TICK}
            tickFormatter={fmtCompact}
            domain={["auto", "auto"]}
            axisLine={false}
            tickLine={false}
            width={46}
          />
          <Tooltip content={<GlassTooltip />} cursor={CURSOR} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={7} />
          <Area
            type="monotone"
            dataKey="cost"
            name="Cost basis"
            stroke={INK.neutral}
            strokeWidth={1.4}
            strokeDasharray="5 4"
            fill="none"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: INK.neutral }}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          />
          <Area
            type="monotone"
            dataKey="value"
            name="Market value"
            stroke={INK.line}
            strokeWidth={2.2}
            fill="url(#valueFade)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fbfbf9", fill: INK.line }}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          />
        </AreaChart>
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

export function PerformanceWaterfall({
  data,
}: {
  data: { label: string; value: number; kind: "start" | "increase" | "decrease" | "end" | "audit"; includedInReconciliation: boolean }[];
}) {
  const animate = useChartMotion();
  const rows = useMemo(() => {
    return data
      .filter((row) => row.kind !== "audit")
      .reduce<{
        running: number;
        rows: (typeof data[number] & { base: number; amount: number; signed: number })[];
      }>((acc, row) => {
        if (row.kind === "start" || row.kind === "end") {
          return {
            running: row.kind === "start" ? row.value : acc.running,
            rows: [...acc.rows, { ...row, base: 0, amount: Math.abs(row.value), signed: row.value }],
          };
        }
        const next = acc.running + row.value;
        const base = Math.min(acc.running, next);
        const amount = Math.abs(row.value);
        return {
          running: next,
          rows: [...acc.rows, { ...row, base, amount, signed: row.value }],
        };
      }, { running: 0, rows: [] }).rows;
  }, [data]);

  if (!rows.length) return <ChartEmpty note="No bridge components available." />;

  return (
    <div className="chart-reveal">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => downloadCsv("wealth-bridge.csv", rows)}
        >
          Export CSV
        </button>
      </div>
      <ResponsiveContainer width="100%" height={310}>
        <BarChart data={rows} margin={{ top: 8, right: 14, bottom: 36, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-18}
            textAnchor="end"
            height={58}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={fmtCompact} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : null;
              if (!row) return null;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{row.label}</p>
                  <div className="flex items-center justify-between gap-5 text-[11px]">
                    <span className="text-muted-foreground">Value</span>
                    <span className="font-semibold tabular-nums">{fmtPkr(row.signed)}</span>
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="base" stackId="bridge" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="amount"
            stackId="bridge"
            name="Bridge"
            radius={[5, 5, 1, 1]}
            maxBarSize={44}
            isAnimationActive={animate}
            animationDuration={DRAW_MS}
            animationEasing={EASE}
          >
            {rows.map((row) => (
              <Cell
                key={row.label}
                fill={
                  row.kind === "start" || row.kind === "end"
                    ? INK.line
                    : row.value >= 0
                      ? INK.up
                      : INK.down
                }
              />
            ))}
          </Bar>
          <ReferenceLine y={0} stroke={INK.neutral} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceTimeline({
  data,
}: {
  data: {
    date: string;
    cumulativeContributions: number;
    grossPurchases: number;
    grossSales: number;
    charges: number;
    cashBalance: number;
    netWorth: number | null;
    eventLabels: string[];
  }[];
}) {
  const animate = useChartMotion();
  const [visible, setVisible] = useState({
    cumulativeContributions: true,
    grossPurchases: true,
    grossSales: true,
    charges: false,
    cashBalance: true,
    netWorth: true,
  });

  if (data.length < 2) return <ChartEmpty note="Ledger timeline requires at least two dated events." height={300} />;

  const series = [
    ["cumulativeContributions", "Contributions", INK.line],
    ["grossPurchases", "Purchases", INK.amber],
    ["grossSales", "Sales", INK.up],
    ["charges", "Charges", INK.down],
    ["cashBalance", "Cash", INK.neutral],
    ["netWorth", "Net worth endpoint", INK.terracotta],
  ] as const;

  return (
    <div className="chart-reveal">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {series.map(([key, label, color]) => (
            <button
              key={key}
              type="button"
              onClick={() => setVisible((prev) => ({ ...prev, [key]: !prev[key] }))}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px]"
              style={{ color: visible[key] ? color : "#8b8b84" }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: visible[key] ? color : "#d6d6cf" }} />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => downloadCsv("performance-timeline.csv", data)}
        >
          Export CSV
        </button>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={data} margin={{ top: 8, right: 14, bottom: 8, left: 10 }}>
          <FadeDefs defs={[{ id: "timelineContrib", color: INK.line, from: 0.16, to: 0.02 }]} />
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tick={AXIS_TICK} tickFormatter={fmtCompact} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            cursor={CURSOR}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as (typeof data)[number] | undefined;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{String(label)}</p>
                  <div className="space-y-1">
                    {payload
                      .filter((p) => p.value !== null && p.value !== undefined)
                      .map((p) => (
                        <div key={String(p.dataKey)} className="flex items-center justify-between gap-5 text-[11px]">
                          <span className="text-muted-foreground">{p.name}</span>
                          <span className="font-semibold tabular-nums">{fmtPkr(Number(p.value))}</span>
                        </div>
                      ))}
                  </div>
                  {!!row?.eventLabels.length && (
                    <p className="mt-2 max-w-[240px] text-[11px] text-muted-foreground">{row.eventLabels.join(" · ")}</p>
                  )}
                </div>
              );
            }}
          />
          {visible.cumulativeContributions && (
            <Area
              type="monotone"
              dataKey="cumulativeContributions"
              name="Contributions"
              stroke={INK.line}
              fill="url(#timelineContrib)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={animate}
              animationDuration={DRAW_MS}
              animationEasing={EASE}
            />
          )}
          {visible.grossPurchases && <Line type="monotone" dataKey="grossPurchases" name="Purchases" stroke={INK.amber} strokeWidth={1.8} dot={false} />}
          {visible.grossSales && <Line type="monotone" dataKey="grossSales" name="Sales" stroke={INK.up} strokeWidth={1.8} dot={false} />}
          {visible.charges && <Line type="monotone" dataKey="charges" name="Charges" stroke={INK.down} strokeWidth={1.8} dot={false} />}
          {visible.cashBalance && <Line type="monotone" dataKey="cashBalance" name="Cash" stroke={INK.neutral} strokeWidth={1.6} strokeDasharray="5 4" dot={false} />}
          {visible.netWorth && <Line type="monotone" dataKey="netWorth" name="Net worth endpoint" stroke={INK.terracotta} strokeWidth={2} connectNulls dot={{ r: 3 }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
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
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
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
                    <span className="text-muted-foreground">Recorded</span>
                    <span className="font-semibold tabular-nums">{fmtPkr(row.amount)}</span>
                  </div>
                  <p className="mt-2 max-w-[240px] text-[11px] text-muted-foreground">{row.note}</p>
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
