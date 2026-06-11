"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared chart language for the whole platform. Every chart pulls its colors,
 * tooltip, gradients, and motion from here so the warm editorial aesthetic is
 * identical everywhere: ink-indigo data lines, frosted-glass tooltips, soft
 * draw-in animations that respect prefers-reduced-motion.
 */

// ── Palette (tuned for the warm paper background #f2f2f0) ─────────────────

export const INK = {
  line: "#3450c8",        // primary data ink — deep editorial indigo
  lineSoft: "#8295e3",
  up: "#0b8a5c",          // gains — deep emerald
  upSoft: "#34c08c",
  down: "#cf3a3a",        // losses — warm red
  downSoft: "#e57e7e",
  neutral: "#9b9b92",     // axis/secondary on warm paper
  grid: "#e6e6df",
  amber: "#d9920b",
  terracotta: "#cd5b2e",
} as const;

/** Categorical series — desaturated editorial tones that sit on warm paper. */
export const SERIES_COLORS = [
  "#3450c8", "#0b8a5c", "#d9920b", "#cd5b2e", "#8f3fae",
  "#0f7e96", "#5e7d16", "#c23a6b", "#5b5b53", "#6a4fd0",
];

// ── Motion ─────────────────────────────────────────────────────────────────

export const EASE = "ease-out" as const;
export const DRAW_MS = 850;

/** True once mounted when the user allows motion — gates chart animations. */
export function useChartMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const coarsePointer = window.matchMedia("(pointer: coarse)");
      reducedMotion.addEventListener("change", onStoreChange);
      coarsePointer.addEventListener("change", onStoreChange);
      return () => {
        reducedMotion.removeEventListener("change", onStoreChange);
        coarsePointer.removeEventListener("change", onStoreChange);
      };
    },
    () =>
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !window.matchMedia("(pointer: coarse)").matches,
    () => false
  );
}

// ── Formatting ─────────────────────────────────────────────────────────────

export const fmtPkr = (v: number) =>
  `PKR ${Number(v).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

export const fmtCompact = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return `${v}`;
};

// ── Frosted-glass tooltip ──────────────────────────────────────────────────

interface TooltipRow {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function GlassTooltip({
  active,
  payload,
  label,
  format = fmtPkr,
  labelFormat,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string | number;
  /** Value formatter; can vary per dataKey via the second argument. */
  format?: (v: number, dataKey?: string) => string;
  labelFormat?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && label !== "" && (
        <p className="chart-tooltip-label">{labelFormat ? labelFormat(label) : String(label)}</p>
      )}
      <div className="space-y-1">
        {payload.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color ?? INK.line }} />
              {String(row.name ?? "")}
            </span>
            <span className="text-[11px] font-semibold tabular-nums">
              {typeof row.value === "number" ? format(row.value, String(row.dataKey ?? "")) : String(row.value ?? "—")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shared cursor style for hover crosshairs. */
export const CURSOR = { stroke: INK.neutral, strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.6 };

// ── Reusable gradient defs ─────────────────────────────────────────────────

/** <defs> block: vertical fade gradients keyed by id, from a solid color to transparent. */
export function FadeDefs({ defs }: { defs: { id: string; color: string; from?: number; to?: number }[] }) {
  return (
    <defs>
      {defs.map((d) => (
        <linearGradient key={d.id} id={d.id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={d.color} stopOpacity={d.from ?? 0.28} />
          <stop offset="100%" stopColor={d.color} stopOpacity={d.to ?? 0.02} />
        </linearGradient>
      ))}
    </defs>
  );
}

export function ChartEmpty({ note, height = 240 }: { note?: string; height?: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <p className="max-w-[280px] text-center text-xs text-muted-foreground">
        {note ?? "No data to chart yet."}
      </p>
    </div>
  );
}

export const AXIS_TICK = { fontSize: 10.5, fill: "#82827a" } as const;
