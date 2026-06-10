"use client";

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
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";

const PIE_COLORS = [
  "#3b5bdb", "#0ca678", "#f59f00", "#e8590c", "#9c36b5",
  "#1098ad", "#5c940d", "#d6336c", "#495057", "#7048e8",
];

const fmt = (v: number) =>
  `PKR ${Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

export function AllocationPie({
  data,
}: {
  data: { name: string; value: number }[];
}) {
  if (!data.length) return <ChartEmpty />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function GainLossBar({
  data,
}: {
  data: { ticker: string; pl: number }[];
}) {
  if (!data.length) return <ChartEmpty note="Needs latest prices to compute gain/loss." />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
        <XAxis dataKey="ticker" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <ReferenceLine y={0} stroke="#adb5bd" />
        <Bar dataKey="pl" name="Unrealized P/L" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.pl >= 0 ? "#0ca678" : "#e03131"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TargetVsActualBar({
  data,
}: {
  data: { ticker: string; actual: number; target: number }[];
}) {
  if (!data.length) return <ChartEmpty note="Set target allocations in Goals & Targets." />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
        <XAxis dataKey="ticker" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
        <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="actual" name="Actual %" fill="#3b5bdb" radius={[3, 3, 0, 0]} />
        <Bar dataKey="target" name="Target %" fill="#adb5bd" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ValueLine({
  data,
}: {
  data: { date: string; value: number; cost: number }[];
}) {
  if (data.length < 2)
    return <ChartEmpty note="Portfolio value over time appears once at least two daily snapshots exist." />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} domain={["auto", "auto"]} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="value" name="Market value" stroke="#3b5bdb" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="cost" name="Cost basis" stroke="#adb5bd" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartEmpty({ note }: { note?: string }) {
  return (
    <div className="flex h-[240px] items-center justify-center">
      <p className="max-w-[260px] text-center text-xs text-muted-foreground">
        {note ?? "No data to chart yet."}
      </p>
    </div>
  );
}
