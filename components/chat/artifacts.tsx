"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
  ReferenceLine, Cell,
} from "recharts";
import { INK, GlassTooltip, FadeDefs, CURSOR, useChartMotion, SERIES_COLORS } from "@/components/chart-kit";
import { cn } from "@/lib/utils";
import type {
  ArtifactSpec,
  PriceChartArtifact,
  BarChartArtifact,
  ComparisonTableArtifact,
  MetricStripArtifact,
  TableArtifact,
  TimelineArtifact,
  PortfolioAttributionArtifact,
} from "@/lib/chat/artifacts";

// ── Public entry point ────────────────────────────────────────────────────────

export function ArtifactRenderer({ spec }: { spec: ArtifactSpec }) {
  switch (spec.kind) {
    case "price-chart":        return <PriceChart spec={spec} />;
    case "bar-chart":          return <EmbeddedBarChart spec={spec} />;
    case "comparison-table":   return <ComparisonTable spec={spec} />;
    case "metric-strip":       return <MetricStrip spec={spec} />;
    case "table":              return <DataTable spec={spec} />;
    case "timeline":           return <EventTimeline spec={spec} />;
    case "portfolio-attribution": return <PortfolioAttribution spec={spec} />;
    default:                   return null;
  }
}

// ── Shared shell ─────────────────────────────────────────────────────────────

function ArtifactShell({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("my-4 overflow-hidden rounded-xl border border-border/70 bg-card", className)}>
      {(title || description) && (
        <div className="border-b border-border/50 px-4 py-3">
          {title && <p className="text-[13px] font-semibold tracking-[-0.01em]">{title}</p>}
          {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Price chart ───────────────────────────────────────────────────────────────

interface PriceCandle { date: string; close: number; volume?: number | null; }
interface ChartDataState {
  candles: PriceCandle[];
  avgCost: number | null;
  dividends: { date: string; amount: number }[];
  loading: boolean;
  error: string | null;
}

function PriceChart({ spec }: { spec: PriceChartArtifact }) {
  const [state, setState] = useState<ChartDataState>({ candles: [], avgCost: null, dividends: [], loading: true, error: null });
  const motion = useChartMotion();

  useEffect(() => {
    let cancelled = false;
    const url = `/api/chart-data?ticker=${encodeURIComponent(spec.ticker)}&period=${spec.period}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) { setState((s) => ({ ...s, loading: false, error: d.error as string })); return; }
        setState({ candles: d.candles ?? [], avgCost: d.avgCost ?? null, dividends: d.dividends ?? [], loading: false, error: null });
      })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: "Failed to load price data" })); });
    return () => { cancelled = true; };
  }, [spec.ticker, spec.period]);

  const showCostBasis = spec.overlay?.includes("cost-basis") && state.avgCost != null;
  const showDividends = spec.overlay?.includes("dividends") && state.dividends.length > 0;

  const yVals = state.candles.map((c) => c.close);
  const yMin = yVals.length ? Math.floor(Math.min(...yVals) * 0.97) : 0;
  const yMax = yVals.length ? Math.ceil(Math.max(...yVals) * 1.03) : 100;

  const fmt = (v: number) => `PKR ${v.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string | number) => {
    const dt = new Date(String(d) + "T00:00:00Z");
    return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  const fmtDateFull = (d: string | number) => {
    const dt = new Date(String(d) + "T00:00:00Z");
    return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  };

  // Thin the x-axis tick labels for readability.
  const tickCount = Math.min(6, state.candles.length);
  const tickInterval = state.candles.length > 1 ? Math.floor(state.candles.length / tickCount) : 1;
  const xTicks = state.candles
    .filter((_, i) => i % tickInterval === 0 || i === state.candles.length - 1)
    .map((c) => c.date);

  if (state.loading) {
    return (
      <ArtifactShell title={spec.title} description={spec.description}>
        <div className="flex h-52 items-center justify-center">
          <p className="text-[12px] text-muted-foreground">Loading price data…</p>
        </div>
      </ArtifactShell>
    );
  }
  if (state.error || state.candles.length === 0) {
    return (
      <ArtifactShell title={spec.title} description={spec.description}>
        <p className="px-4 py-4 text-[12px] text-muted-foreground">
          {spec.fallback ?? state.error ?? "No price data available for this period."}
        </p>
      </ArtifactShell>
    );
  }

  return (
    <ArtifactShell title={spec.title} description={spec.description}>
      <div className="px-2 pb-3 pt-4">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={state.candles} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
            <defs>
              <FadeDefs defs={[{ id: "price-area", color: INK.line }]} />
            </defs>
            <CartesianGrid vertical={false} stroke={INK.grid} strokeDasharray="3 0" />
            <XAxis
              dataKey="date"
              ticks={xTicks}
              tickFormatter={fmtDate}
              tick={{ fontSize: 10, fill: INK.neutral }}
              axisLine={false}
              tickLine={false}
              dy={6}
            />
            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 10, fill: INK.neutral }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              content={<GlassTooltip format={fmt} labelFormat={fmtDateFull} />}
              cursor={CURSOR}
            />
            {showCostBasis && (
              <ReferenceLine
                y={state.avgCost!}
                stroke={INK.amber}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{ value: `Cost ${fmt(state.avgCost!)}`, position: "insideTopRight", fill: INK.amber, fontSize: 10 }}
              />
            )}
            {showDividends && state.dividends.map((d) => (
              <ReferenceLine key={d.date} x={d.date} stroke={INK.up} strokeWidth={1} strokeDasharray="2 2" />
            ))}
            <Line
              type="monotone"
              dataKey="close"
              name={spec.ticker}
              stroke={INK.line}
              strokeWidth={1.75}
              dot={false}
              activeDot={{ r: 3, fill: INK.line }}
              isAnimationActive={motion}
              animationDuration={700}
            />
          </LineChart>
        </ResponsiveContainer>
        {showDividends && (
          <p className="mt-1 px-2 text-[10px] text-muted-foreground">
            Vertical marks indicate ex-dividend dates.
          </p>
        )}
      </div>
    </ArtifactShell>
  );
}

// ── Embedded bar chart ────────────────────────────────────────────────────────

function EmbeddedBarChart({ spec }: { spec: BarChartArtifact }) {
  const motion = useChartMotion();
  if (!spec.data?.length) {
    return (
      <ArtifactShell title={spec.title} description={spec.description}>
        <p className="px-4 py-4 text-[12px] text-muted-foreground">{spec.fallback ?? "No data to display."}</p>
      </ArtifactShell>
    );
  }

  const fmt = (v: number) =>
    spec.yUnit === "%" ? `${v.toFixed(1)}%`
    : spec.yUnit === "PKR" ? `PKR ${v.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`
    : v.toLocaleString("en-PK", { maximumFractionDigits: 1 });

  return (
    <ArtifactShell title={spec.title} description={spec.description}>
      <div className="px-2 pb-3 pt-4">
        <ResponsiveContainer width="100%" height={Math.max(160, spec.data.length * 40)}>
          <BarChart data={spec.data} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke={INK.grid} strokeDasharray="3 0" />
            <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 10, fill: INK.neutral }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey={spec.xKey} tick={{ fontSize: 11, fill: INK.neutral }} axisLine={false} tickLine={false} width={80} />
            <Tooltip content={<GlassTooltip format={fmt} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            {spec.bars.map((bar, idx) => (
              <Bar key={bar.key} dataKey={bar.key} name={bar.label} fill={bar.color ?? SERIES_COLORS[idx % SERIES_COLORS.length]} radius={[0, 4, 4, 0]} isAnimationActive={motion} animationDuration={600} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ArtifactShell>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────

function ComparisonTable({ spec }: { spec: ComparisonTableArtifact }) {
  if (!spec.rows?.length) {
    return (
      <ArtifactShell title={spec.title} description={spec.description}>
        <p className="px-4 py-4 text-[12px] text-muted-foreground">{spec.fallback ?? "No data to display."}</p>
      </ArtifactShell>
    );
  }
  return (
    <ArtifactShell title={spec.title} description={spec.description}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="bg-muted/50">
            <tr>
              {spec.columns.map((col) => (
                <th key={col.key} className="border-b border-border px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {spec.rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-muted/30">
                {spec.columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 align-top tabular-nums text-foreground/90">
                    {row[col.key] != null ? String(row[col.key]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ArtifactShell>
  );
}

// ── Metric strip ──────────────────────────────────────────────────────────────

function MetricStrip({ spec }: { spec: MetricStripArtifact }) {
  return (
    <div className={cn("my-4 grid gap-2", spec.metrics.length <= 2 ? "grid-cols-2" : spec.metrics.length === 3 ? "sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
      {spec.title && <p className="col-span-full text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{spec.title}</p>}
      {spec.metrics.map((m, i) => (
        <div key={i} className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
          <p className={cn(
            "mt-0.5 text-[17px] font-semibold tabular-nums leading-tight",
            m.tone === "positive" ? "text-emerald-600" : m.tone === "negative" ? "text-red-600" : "text-foreground"
          )}>
            {m.value}
          </p>
          {m.delta && (
            <p className={cn("mt-0.5 text-[11px] tabular-nums", m.tone === "positive" ? "text-emerald-600" : m.tone === "negative" ? "text-red-600" : "text-muted-foreground")}>
              {m.delta}
            </p>
          )}
          {m.detail && <p className="mt-0.5 text-[10px] text-muted-foreground">{m.detail}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────

function fmtCell(value: string | number | null, format?: TableArtifact["columns"][number]["format"]): string {
  if (value == null) return "—";
  const n = Number(value);
  switch (format) {
    case "currency": return `PKR ${n.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
    case "percent":  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    case "number":   return n.toLocaleString("en-PK", { maximumFractionDigits: 2 });
    case "date":     return new Date(String(value) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    default:         return String(value);
  }
}

function DataTable({ spec }: { spec: TableArtifact }) {
  if (!spec.rows?.length) {
    return (
      <ArtifactShell title={spec.title} description={spec.description}>
        <p className="px-4 py-4 text-[12px] text-muted-foreground">{spec.fallback ?? "No rows to display."}</p>
      </ArtifactShell>
    );
  }
  return (
    <ArtifactShell title={spec.title} description={spec.description}>
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr>
              {spec.columns.map((col) => (
                <th key={col.key} className={cn("border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground", col.align === "right" ? "text-right" : "text-left")}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {spec.rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-muted/30">
                {spec.columns.map((col) => (
                  <td key={col.key} className={cn("px-4 py-2 align-top tabular-nums text-foreground/90", col.align === "right" ? "text-right" : "text-left")}>
                    {fmtCell(row[col.key] as string | number | null, col.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ArtifactShell>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

const TIMELINE_COLORS: Record<string, string> = {
  filing:      "bg-blue-500",
  dividend:    "bg-emerald-500",
  earnings:    "bg-amber-500",
  news:        "bg-slate-400",
  transaction: "bg-violet-500",
  corporate:   "bg-orange-500",
  other:       "bg-muted-foreground",
};

function EventTimeline({ spec }: { spec: TimelineArtifact }) {
  if (!spec.events?.length) {
    return (
      <ArtifactShell title={spec.title} description={spec.description}>
        <p className="px-4 py-4 text-[12px] text-muted-foreground">{spec.fallback ?? "No events to display."}</p>
      </ArtifactShell>
    );
  }
  const sorted = [...spec.events].sort((a, b) => b.date.localeCompare(a.date));
  const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <ArtifactShell title={spec.title} description={spec.description}>
      <div className="px-4 py-3">
        <div className="space-y-3">
          {sorted.map((evt, i) => (
            <div key={i} className="flex gap-3">
              <div className="mt-1 flex flex-col items-center">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", TIMELINE_COLORS[evt.type] ?? "bg-muted-foreground")} />
                {i < sorted.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <div className="pb-3">
                <p className="text-[10px] text-muted-foreground">{fmtDate(evt.date)}</p>
                <p className="text-[13px] font-medium leading-snug text-foreground">
                  {evt.label}
                  {evt.value && <span className="ml-1.5 text-muted-foreground">{evt.value}</span>}
                </p>
                {evt.detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{evt.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ArtifactShell>
  );
}

// ── Portfolio attribution ─────────────────────────────────────────────────────

function PortfolioAttribution({ spec }: { spec: PortfolioAttributionArtifact }) {
  if (!spec.items?.length) {
    return (
      <ArtifactShell title={spec.title} description={spec.description}>
        <p className="px-4 py-4 text-[12px] text-muted-foreground">{spec.fallback ?? "No data to display."}</p>
      </ArtifactShell>
    );
  }
  const maxAbs = Math.max(...spec.items.map((it) => Math.abs(it.value)));

  return (
    <ArtifactShell title={spec.title} description={spec.description}>
      <div className="space-y-1.5 px-4 py-3">
        {spec.items.map((item, i) => {
          const pct = maxAbs > 0 ? Math.abs(item.value) / maxAbs : 0;
          const tone = item.tone ?? (item.value >= 0 ? "positive" : "negative");
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-right text-[12px] text-muted-foreground">{item.label}</span>
              <div className="relative flex-1">
                <div
                  className={cn("h-5 rounded-r-sm", tone === "positive" ? "bg-emerald-500/80" : tone === "negative" ? "bg-red-500/80" : "bg-muted")}
                  style={{ width: `${Math.max(pct * 100, 2)}%` }}
                />
              </div>
              <span className={cn("w-20 shrink-0 text-right text-[12px] font-semibold tabular-nums", tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : "text-muted-foreground")}>
                {item.value >= 0 ? "+" : ""}{item.value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}
                {item.percent != null && <span className="ml-1 text-[10px] text-muted-foreground">({item.percent >= 0 ? "+" : ""}{item.percent.toFixed(1)}%)</span>}
              </span>
            </div>
          );
        })}
      </div>
    </ArtifactShell>
  );
}
