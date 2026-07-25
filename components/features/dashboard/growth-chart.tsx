"use client";

import { useMemo, useState } from "react";
import { cn, formatNumber } from "@/lib/shared/format";
import { ActionButton } from "@/components/ui/action-button";
import { RefreshCw } from "lucide-react";

export interface GrowthPoint {
  date: string; // ISO yyyy-mm-dd
  portfolio: number;
  contributed: number;
}

const SERIES = [
  { key: "portfolio" as const, name: "Portfolio value", color: "var(--chart-line)", width: 2.25, dash: undefined },
  { key: "contributed" as const, name: "Net contributions", color: "var(--flat-2)", width: 1.5, dash: "4 4" },
];

const RANGES = [
  { id: "3m", label: "3M" },
  { id: "ytd", label: "YTD" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const compact = (v: number) => (v >= 1_000_000 ? `${formatNumber(v / 1_000_000, 2)}m` : formatNumber(v, 0));
const monthLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

function rangeCaption(id: RangeId, first: string | undefined): string {
  if (id === "3m") return "Last three months";
  if (id === "ytd") return "Year to date";
  if (id === "1y") return "Last twelve months";
  return first ? `Since first transaction, ${monthLabel(first)}` : "Since first transaction";
}

/**
 * Portfolio-against-contributions line chart, ported from the design's
 * charts.jsx: hairline grid, area fade under the portfolio line, dashed
 * contributions, crosshair with dots and a frosted tooltip.
 */
export function GrowthChart({ data, asOf, canRefresh }: { data: GrowthPoint[]; asOf: string | null; canRefresh: boolean }) {
  const [range, setRange] = useState<RangeId>("all");
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<number | null>(null);

  const rows = useMemo(() => {
    if (data.length === 0) return [];
    const lastDate = data[data.length - 1].date;
    const cutoff = (() => {
      const d = new Date(`${lastDate}T12:00:00`);
      if (range === "3m") d.setMonth(d.getMonth() - 3);
      else if (range === "1y") d.setFullYear(d.getFullYear() - 1);
      else if (range === "ytd") return `${lastDate.slice(0, 4)}-01-01`;
      else return "0000-01-01";
      return d.toISOString().slice(0, 10);
    })();
    const filtered = data.filter((p) => p.date >= cutoff);
    return filtered.length >= 2 ? filtered : data;
  }, [data, range]);

  if (data.length < 2) {
    return <p className="py-14 text-center text-sm text-text-muted">The growth series builds after the first portfolio rebuild.</p>;
  }

  const visible = SERIES.filter((s) => !hidden[s.key]);
  const last = data[data.length - 1];

  const W = 1000;
  const H = 250;
  const padL = 8, padR = 8, padT = 12, padB = 22;
  const all = (visible.length ? visible : SERIES).flatMap((s) => rows.map((r) => r[s.key]));
  const min = Math.min(...all) * 0.985;
  const max = Math.max(...all) * 1.01 || 1;
  const x = (i: number) => padL + (i / (rows.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  const path = (key: "portfolio" | "contributed") =>
    rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(r[key]).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));
  const labelEvery = Math.max(1, Math.floor(rows.length / 6));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Growth of capital</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Portfolio against the KSE-100</h2>
          <p className="mt-1.5 text-xs text-text-muted">{rangeCaption(range, data[0]?.date)}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-4">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={cn(
                  "border-b-2 pb-1.5 text-sm transition-colors",
                  range === r.id ? "border-indigo font-bold text-text-strong" : "border-transparent font-medium text-text-muted hover:text-text-strong"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {canRefresh && (
            <ActionButton
              endpoint="/api/prices"
              body={{ refresh: true }}
              label={<><RefreshCw className="h-3 w-3" /> Refresh prices</>}
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-(length:--text-2xs) text-text-faint hover:text-text-strong"
            />
          )}
        </div>
      </div>

      <div className="mb-3.5 flex flex-wrap gap-2">
        {SERIES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))}
            className="inline-flex items-center gap-2 rounded-full border border-rule bg-surface-page py-[5px] pl-2 pr-3 text-xs text-text-strong transition-colors hover:bg-surface-sunken"
            style={{ opacity: hidden[s.key] ? 0.4 : 1 }}
          >
            <span className="h-0.5 w-3.5 rounded-sm" style={{ background: s.color }} />
            <span>{s.name}</span>
            <span className="figure font-semibold">{compact(last[s.key])}</span>
          </button>
        ))}
        {asOf && <span className="self-center text-(length:--text-2xs) text-text-faint">Values as of {asOf}</span>}
      </div>

      <div
        className="relative"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (rows.length - 1));
          setHover(Math.max(0, Math.min(rows.length - 1, i)));
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block overflow-visible">
          <defs>
            <linearGradient id="growth-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <line key={i} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
          ))}
          {!hidden.portfolio && (
            <path
              d={`${path("portfolio")} L ${x(rows.length - 1)} ${H - padB} L ${padL} ${H - padB} Z`}
              fill="url(#growth-fade)"
            />
          )}
          {visible.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--flat-2)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              {visible.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(rows[hover][s.key])} r="3.5" fill={s.color} stroke="var(--surface-raised)" strokeWidth="1.5" />
              ))}
            </g>
          )}
          {rows.map((r, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={x(i)} y={H - 6} fontSize="10.5" fill="var(--chart-axis)" textAnchor={i === 0 ? "start" : "middle"}>
                {monthLabel(r.date)}
              </text>
            ) : null
          )}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2"
            style={{
              left: `calc(${(hover / (rows.length - 1)) * 100}% + 12px)`,
              transform: hover > rows.length * 0.7 ? "translateX(-115%)" : undefined,
            }}
          >
            <div className="chart-tooltip">
              <p className="chart-tooltip-label">{monthLabel(rows[hover].date)}</p>
              {visible.map((s) => (
                <p key={s.key} className="flex justify-between gap-5 text-xs">
                  <span style={{ color: s.color }}>{s.name}</span>
                  <span className="figure font-medium">PKR {formatNumber(rows[hover][s.key], 0)}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
