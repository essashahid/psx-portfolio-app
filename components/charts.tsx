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
} from "recharts";
import {
  INK,
  SERIES_COLORS,
  EASE,
  DRAW_MS,
  useChartMotion,
  fmtCompact,
  GlassTooltip,
  CURSOR,
  FadeDefs,
  ChartEmpty,
  AXIS_TICK,
} from "@/components/chart-kit";

// ---------------------------------------------------------------------------
// Allocation donut — animated sweep-in, hover focus, live center readout
// ---------------------------------------------------------------------------

export function AllocationPie({ data }: { data: { name: string; value: number }[] }) {
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
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
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
