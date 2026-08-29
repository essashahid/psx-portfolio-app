"use client";

import { useState } from "react";
import { cn } from "@/lib/shared/format";
import { sectorColor, shortSector } from "@/lib/shared/sector-colors";
import { fmtPct } from "@/lib/market/format";
import { buildReturnDistribution } from "@psx/shared/market/return-distribution";

/* ── Breadth: full-width stacked strip with square legend chips ─────────── */
export function BreadthStrip({
  advancers,
  unchanged,
  decliners,
}: {
  advancers: number;
  unchanged: number;
  decliners: number;
}) {
  const total = advancers + unchanged + decliners || 1;
  const parts = [
    { label: "Advancing", count: advancers, color: "var(--up-1)" },
    { label: "Unchanged", count: unchanged, color: "var(--flat-2)" },
    { label: "Declining", count: decliners, color: "var(--down-1)" },
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Breadth</span>
        <span className="figure text-(length:--text-2xs) text-text-muted">
          A/D ratio {(decliners ? advancers / decliners : advancers).toFixed(2)}
        </span>
      </div>
      <div className="mt-2.5 flex h-3.5 overflow-hidden">
        {parts.map((p) => (
          <span key={p.label} title={`${p.label} · ${p.count}`} style={{ flex: p.count / total, background: p.color }} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-4">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-baseline gap-[7px]">
            <span className="h-2 w-2 self-center" style={{ background: p.color }} />
            <span className="text-(length:--text-2xs) text-text-muted">{p.label}</span>
            <span className="figure text-xs font-semibold text-text-strong">{p.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Where today's range sits within the 52-week band ───────────────────── */
export function FiftyTwoWeekStrip({
  low,
  high,
  prevClose,
  last,
}: {
  low: number;
  high: number;
  prevClose: number | null;
  last: number;
}) {
  const span = high - low || 1;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - low) / span) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Within 52 weeks</span>
        <span className="figure text-(length:--text-2xs) text-text-muted">last {last.toLocaleString("en-PK", { maximumFractionDigits: 0 })}</span>
      </div>
      <div className="relative mt-2.5 h-3.5 bg-surface-inset">
        <span
          className="absolute inset-y-0"
          style={{ left: 0, width: `${pos(last)}%`, background: "color-mix(in oklab, var(--sp-plum) 34%, var(--surface-page))" }}
        />
        {prevClose !== null && (
          <span title="Previous close" className="absolute inset-y-0 w-px bg-text-faint" style={{ left: `${pos(prevClose)}%` }} />
        )}
        <span title="Last" className="absolute -inset-y-0.75 w-0.5 bg-ink-1" style={{ left: `${pos(last)}%` }} />
      </div>
      <div className="mt-2.5 flex justify-between">
        <span className="figure text-(length:--text-2xs) text-text-faint">{low.toLocaleString("en-PK", { maximumFractionDigits: 0 })}</span>
        <span className="figure text-(length:--text-2xs) text-text-faint">{high.toLocaleString("en-PK", { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}

/* ── Sector board: one tile per sector, tinted by return ────────────────── */
export interface SectorTile {
  sector: string;
  ret: number;
  weight: number | null;
  owned: boolean;
}

export function SectorTileBoard({ tiles }: { tiles: SectorTile[] }) {
  const [view, setView] = useState<"all" | "mine">("all");
  const ownedCount = tiles.filter((t) => t.owned).length;
  const shown = view === "mine" ? tiles.filter((t) => t.owned) : tiles;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Sector board</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Sector returns today</h2>
        </div>
        <div className="flex gap-5 pb-1">
          {([
            { key: "all" as const, label: "All sectors", count: tiles.length },
            { key: "mine" as const, label: "My sectors", count: ownedCount },
          ]).map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                "whitespace-nowrap border-b-2 pb-1.5 text-sm transition-colors",
                view === v.key ? "border-indigo font-semibold text-text-strong" : "border-transparent font-medium text-text-muted hover:text-text-strong"
              )}
            >
              {v.label}
              <span className="figure ml-1.5 text-(length:--text-2xs) text-text-faint">{v.count}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 grid gap-0.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.375rem, 1fr))" }}>
        {shown.map((t) => {
          const strength = Math.min(1, Math.abs(t.ret) / 3);
          const base = t.ret >= 0 ? "var(--up-2)" : "var(--down-2)";
          const dark = strength > 0.5;
          return (
            <div
              key={t.sector}
              title={`${t.sector} · ${fmtPct(t.ret)}`}
              className="flex min-h-24 flex-col justify-between gap-3.5 px-3 py-3"
              style={{ background: `color-mix(in oklab, ${base} ${10 + strength * 70}%, var(--paper-1))` }}
            >
              <span className="flex items-start justify-between gap-2">
                <span
                  className="text-(length:--text-3xs) font-bold uppercase leading-tight tracking-(--tracking-caps)"
                  style={{ color: dark ? "rgba(255,255,255,0.9)" : "var(--text-strong)" }}
                >
                  {shortSector(t.sector)}
                </span>
                {t.owned && (
                  <span
                    title="In your book"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: dark ? "#fff" : sectorColor(t.sector) }}
                  />
                )}
              </span>
              <span>
                <span className="figure block text-(length:--text-h3) font-semibold" style={{ color: dark ? "#fff" : "var(--text-strong)" }}>
                  {fmtPct(t.ret)}
                </span>
                {t.weight !== null && (
                  <span className="figure mt-1.5 block text-(length:--text-3xs)" style={{ color: dark ? "rgba(255,255,255,0.75)" : "var(--text-muted)" }}>
                    {t.weight.toFixed(1)}% of value
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Histogram of daily returns across the whole market ─────────────────── */
export interface HistogramInput {
  /** change_percent per company; nulls already filtered out */
  changes: { ticker: string; pct: number }[];
  ownedTickers: string[];
}

export function ReturnHistogram({ changes, ownedTickers }: HistogramInput) {
  if (changes.length === 0) {
    return <p className="py-10 text-center text-sm text-text-muted">No per-company return data in this snapshot.</p>;
  }
  // Bucketing lives in @psx/shared so the phone draws the same distribution
  // from the same edges rather than a second interpretation of it.
  const { buckets, best, worst } = buildReturnDistribution(changes, ownedTickers);
  const max = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div>
      <div className="flex h-48 items-end gap-[3px]">
        {buckets.map((b) => (
          <span key={b.lo} title={`${b.lo}% to ${b.hi}% · ${b.count} companies`} className="flex h-full flex-1 flex-col justify-end gap-0.5">
            <span className={cn("figure text-center text-(length:--text-2xs) font-semibold", b.count === 0 ? "text-text-faint" : "text-text-muted")}>
              {b.count || ""}
            </span>
            <span
              style={{
                height: `${(b.count / max) * 100}%`,
                background: b.hi <= 0 ? "var(--down-1)" : b.lo >= 0 ? "var(--up-1)" : "var(--flat-2)",
              }}
            />
          </span>
        ))}
      </div>
      <div className="flex gap-[3px] border-t border-rule-strong pt-2">
        {buckets.map((b) => (
          <span key={b.lo} className="figure flex-1 text-left text-(length:--text-3xs) text-text-faint">
            {b.lo}%
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-[3px]">
        {buckets.map((b) => (
          <span key={b.lo} className="flex flex-1 flex-col items-center gap-1">
            {b.mine.length > 0 && (
              <span title={b.mine.join(", ")} className="flex flex-col items-center gap-1">
                <span className="h-2.25 w-0.5 bg-(--sp-plum)" />
                <span className="text-(length:--text-3xs) font-bold tracking-[0.02em] text-(--sp-plum) [text-orientation:mixed] [writing-mode:vertical-rl]">
                  {b.mine.slice(0, 3).join(" ")}
                </span>
              </span>
            )}
          </span>
        ))}
      </div>
      {worst && best && (
        <div className="mt-3.5 flex justify-between">
          <span className="inline-flex items-baseline gap-2">
            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-down">Weakest</span>
            <span className="figure text-sm font-semibold text-down">{worst.ticker} {fmtPct(worst.pct)}</span>
          </span>
          <span className="inline-flex items-baseline gap-2">
            <span className="figure text-sm font-semibold text-up">{best.ticker} {fmtPct(best.pct)}</span>
            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-up">Strongest</span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Market internals: value, its reference tick, and the delta ─────────── */
export interface Gauge {
  label: string;
  value: string;
  delta: string;
  /** Where today sits on the bar, 0–100. */
  fill: number;
  /** Where the reference (30-day average, or parity) sits, 0–100. */
  mark: number;
  tone: "up" | "down" | "flat";
  note: string;
}

export function MarketInternals({ gauges }: { gauges: Gauge[] }) {
  return (
    <div
      className="mt-9 grid gap-7 border-t border-rule pt-7"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(11.875rem, 1fr))" }}
    >
      {gauges.map((g) => {
        const colour = g.tone === "up" ? "var(--up-1)" : g.tone === "down" ? "var(--down-1)" : "var(--flat-2)";
        return (
          <div key={g.label}>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{g.label}</p>
            <p className="figure mt-2 text-(length:--text-h2) font-semibold text-text-strong">{g.value}</p>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="relative h-1.5 flex-1 bg-surface-inset">
                <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, Math.max(0, g.fill))}%`, background: colour }} />
                <span
                  title="Reference"
                  className="absolute -inset-y-0.75 w-px bg-text-faint"
                  style={{ left: `${Math.min(100, Math.max(0, g.mark))}%` }}
                />
              </span>
              <span className={cn("figure whitespace-nowrap text-(length:--text-2xs) font-semibold", g.tone === "up" ? "text-up" : g.tone === "down" ? "text-down" : "text-text-muted")}>
                {g.delta}
              </span>
            </div>
            <p className="mt-1.5 text-(length:--text-2xs) text-text-faint">{g.note}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ── Whose money changed hands: sellers | buyers proportional strip ─────── */
export interface ParticipantRow {
  label: string;
  net: number;
}

const FLOW_COLORS = [
  "var(--sp-indigo)",
  "var(--sp-teal)",
  "var(--sp-plum)",
  "var(--sp-gold)",
  "var(--sp-steel)",
  "var(--sp-rose)",
  "var(--sp-bronze)",
  "var(--sp-cyan)",
];

export function ParticipantFlowBar({ rows, unit }: { rows: ParticipantRow[]; unit: string }) {
  const active = rows.filter((r) => r.net !== 0);
  if (active.length === 0) {
    return <p className="py-8 text-center text-sm text-text-muted">No participant flow data for this period.</p>;
  }
  const coloured = active.map((r, i) => ({ ...r, color: FLOW_COLORS[i % FLOW_COLORS.length] }));
  const sellers = coloured.filter((r) => r.net < 0).sort((a, b) => a.net - b.net);
  const buyers = coloured.filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const gross = active.reduce((n, r) => n + Math.abs(r.net), 0) || 1;

  const pct = (v: number) => `${(Math.abs(v) / gross) * 100}%`;

  return (
    <div>
      {/* Explicit widths rather than flex-grow: every segment must be visible
          even when its share of the day's gross is a fraction of a percent. */}
      <div className="flex h-9 items-stretch gap-px overflow-hidden">
        {sellers.map((r) => (
          <span
            key={r.label}
            title={`${r.label} · ${r.net.toFixed(1)} ${unit}`}
            className="min-w-px"
            style={{ width: pct(r.net), background: `color-mix(in oklab, ${r.color} 55%, var(--down-2))` }}
          />
        ))}
        <span className="w-0.5 shrink-0 bg-ink-1" />
        {buyers.map((r) => (
          <span
            key={r.label}
            title={`${r.label} · +${r.net.toFixed(1)} ${unit}`}
            className="min-w-px"
            style={{ width: pct(r.net), background: r.color }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-down">Net sellers</span>
        <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-up">Net buyers</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2.5">
        {coloured.map((r) => (
          <span key={r.label} className="inline-flex items-baseline gap-2 whitespace-nowrap">
            <span
              className="h-2.5 w-2.5 shrink-0 self-center"
              style={{ background: r.net >= 0 ? r.color : `color-mix(in oklab, ${r.color} 55%, var(--down-2))` }}
            />
            <span className="text-xs text-text-muted">{r.label}</span>
            <span className={cn("figure text-sm font-semibold", r.net >= 0 ? "text-up" : "text-down")}>
              {r.net >= 0 ? "+" : ""}{r.net.toFixed(1)} {unit}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
