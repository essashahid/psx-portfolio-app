"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  horizonTakeaway,
  regimeTakeaway,
  turbulenceTakeaway,
  type HorizonOption,
  type RegimeOption,
  type TurbulenceOption,
} from "@/lib/engine/outlook/data-dashboard";

/**
 * Selector-driven views over the three descriptive evidence sets.
 *
 * Each shows one result at a time with a sentence saying what it means, rather
 * than a grid the reader has to decode. The full grids remain in the technical
 * appendix for anyone who wants to scan across.
 */

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");
const signed = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "n/a");

function Takeaway({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-foreground">{children}</p>;
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: "danger" | "positive" }) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <p
        className={`text-2xl font-semibold tabular-nums ${
          tone === "danger" ? "text-red-600" : tone === "positive" ? "text-emerald-600" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{label}</p>
    </div>
  );
}

/** Depth selector shared by all three sections. */
function DepthControl({
  thresholds,
  value,
  onChange,
}: {
  thresholds: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <SegmentedControl
      label="Size of fall"
      value={String(value)}
      onChange={(v) => onChange(Number(v))}
      options={thresholds.map((t) => ({
        value: String(t),
        label: `${Math.abs(t * 100).toFixed(0)}%`,
        hint: `A fall of ${Math.abs(t * 100).toFixed(0)} percent or more`,
      }))}
    />
  );
}

// --- Horizon evidence ---------------------------------------------------------

export function HorizonExplorer({ horizons }: { horizons: HorizonOption[] }) {
  const depths = [...new Set(horizons.flatMap((h) => h.thresholds.map((t) => t.threshold)))].sort((a, b) => b - a);
  const [horizonKey, setHorizonKey] = useState(horizons[1]?.key ?? horizons[0]?.key ?? "");
  const [threshold, setThreshold] = useState(depths.includes(-0.05) ? -0.05 : (depths[0] ?? -0.03));

  const horizon = horizons.find((h) => h.key === horizonKey) ?? horizons[0];
  if (!horizon) return null;
  const fell = horizon.thresholds.find((t) => t.threshold === threshold);

  return (
    <div className="space-y-3">
      <SegmentedControl
        label="Time window"
        value={horizonKey}
        onChange={setHorizonKey}
        options={horizons.map((h) => ({ value: h.key, label: h.label.replace(/\s*\(.*\)$/, "") }))}
      />
      <DepthControl thresholds={depths} value={threshold} onChange={setThreshold} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure value={fell ? pct(fell.frequency) : "n/a"} label={`Fell ${Math.abs(threshold * 100).toFixed(0)}% or more at some point`} tone="danger" />
        <Figure value={pct(horizon.positiveRate)} label="Finished higher than it started" tone="positive" />
        <Figure value={signed(horizon.returnPercentiles.median)} label="Typical close-to-close result" />
        <Figure value={String(horizon.independentWindows)} label="Independent periods behind these figures" />
      </div>

      <Takeaway>{horizonTakeaway(horizon, threshold)}</Takeaway>
    </div>
  );
}

// --- Regimes ------------------------------------------------------------------

export function RegimeExplorer({
  regimes,
  horizonKeys,
  thresholds,
}: {
  regimes: RegimeOption[];
  horizonKeys: string[];
  thresholds: number[];
}) {
  const [regimeKey, setRegimeKey] = useState(regimes[0]?.key ?? "");
  const [horizonKey, setHorizonKey] = useState(horizonKeys[0] ?? "");
  const [threshold, setThreshold] = useState(thresholds.includes(-0.05) ? -0.05 : (thresholds[0] ?? -0.03));

  const regime = regimes.find((r) => r.key === regimeKey) ?? regimes[0];
  if (!regime) return null;
  const cell = regime.cells.find((c) => c.horizonKey === horizonKey && c.threshold === threshold);

  return (
    <div className="space-y-3">
      {/* Six regimes is too many for one control row on a phone, so they wrap
          as a grid rather than compressing into unreadable slivers. */}
      <div role="radiogroup" aria-label="Market state" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {regimes.map((r) => {
          const selected = r.key === regime.key;
          return (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setRegimeKey(r.key)}
              className={`min-h-9 rounded-md border px-2 py-1.5 text-[12px] font-medium transition-[background-color,color,border-color] duration-(--dur-fast) ease-(--ease-ui) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <SegmentedControl
          label="Time window"
          value={horizonKey}
          onChange={setHorizonKey}
          options={horizonKeys.map((k) => ({ value: k, label: k }))}
        />
        <DepthControl thresholds={thresholds} value={threshold} onChange={setThreshold} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Figure value={pct(regime.occupancyShare)} label="Share of the past five years spent in this state" />
        <Figure
          value={cell ? pct(cell.rate) : "n/a"}
          label={`Fell ${Math.abs(threshold * 100).toFixed(0)}% or more within ${horizonKey}`}
          tone="danger"
        />
      </div>

      <Takeaway>{regimeTakeaway(regime, cell, regimes)}</Takeaway>
    </div>
  );
}

// --- Turbulence ---------------------------------------------------------------

export function TurbulenceExplorer({ rows }: { rows: TurbulenceOption[] }) {
  const horizonKeys = [...new Set(rows.map((r) => r.horizonKey))];
  const depths = [...new Set(rows.map((r) => r.threshold))].sort((a, b) => b - a);
  const [horizonKey, setHorizonKey] = useState(horizonKeys.includes("10d") ? "10d" : (horizonKeys[0] ?? ""));
  const [threshold, setThreshold] = useState(depths.includes(-0.05) ? -0.05 : (depths[0] ?? -0.03));

  const row = rows.find((r) => r.horizonKey === horizonKey && r.threshold === threshold);
  const max = row ? Math.max(row.calmRate, row.turbulentRate, 0) : 0;
  const height = (rate: number) => (max > 0 ? Math.max((rate / max) * 100, 3) : 3);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <SegmentedControl
          label="Time window"
          value={horizonKey}
          onChange={setHorizonKey}
          options={horizonKeys.map((k) => ({ value: k, label: k }))}
        />
        <DepthControl thresholds={depths} value={threshold} onChange={setThreshold} />
      </div>

      {row ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { label: "After a calm stretch", rate: row.calmRate, tone: "calm" as const },
                { label: "After a turbulent stretch", rate: row.turbulentRate, tone: "turbulent" as const },
              ]
            ).map((side) => (
              <div key={side.tone} className="rounded-lg bg-muted p-4">
                <p className="mb-2.5 text-[11px] text-muted-foreground">{side.label}</p>
                <div className="flex h-16 items-end">
                  <div
                    className={`w-full rounded-t transition-[height] duration-(--dur-base) ease-(--ease-ui) ${
                      side.tone === "calm" ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    style={{ height: `${height(side.rate)}%` }}
                  />
                </div>
                <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{pct(side.rate)}</p>
              </div>
            ))}
          </div>
          <Takeaway>{turbulenceTakeaway(row)}</Takeaway>
        </>
      ) : (
        <Takeaway>{turbulenceTakeaway(undefined)}</Takeaway>
      )}
    </div>
  );
}
