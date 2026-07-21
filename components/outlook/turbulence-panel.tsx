"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Disclosure, DetailRow } from "@/components/outlook/outlook-primitives";
import type { OutlookViewModel, TurbulenceView } from "@/lib/engine/outlook/presentation";

/**
 * Whether a stretch of turbulence has been followed by more declines than usual.
 *
 * This is the one question that decides whether an early-warning model is worth
 * building, so it gets a comparison a reader can take in at a glance rather than
 * a twenty-row table of conditional rates.
 *
 * Measured over the whole history, including the periods used to set the calm
 * and turbulent cut-offs, so it is not evidence that the effect would hold on
 * unseen data. The caption says so.
 */

/** The window this comparison is drawn over. Ten sessions carries 125 independent
 *  periods and shows the effect clearly; it is stated rather than selectable so
 *  the panel asks one question at a time. */
const COMPARISON_HORIZON = "10d";
const COMPARISON_WINDOW_COPY = "two weeks";

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

function headline(row: TurbulenceView): string {
  if (row.verdict === "raises-risk") {
    return `A ${row.pct}% drop was ${row.lift.toFixed(1)} times more common than usual after a turbulent stretch`;
  }
  if (row.verdict === "lowers-risk") {
    return `A ${row.pct}% drop was actually less common than usual after a turbulent stretch`;
  }
  return `Turbulence made little difference to the chance of a ${row.pct}% drop`;
}

function caption(row: TurbulenceView): string {
  if (row.calmRate === 0) {
    return `A fall this large never followed a calm stretch in this history. After a turbulent one it happened in ${pct1(row.turbulentRate)} of periods.`;
  }
  if (row.verdict === "raises-risk") {
    return `Turbulent stretches were followed by this fall in ${pct1(row.turbulentRate)} of periods, against ${pct1(row.calmRate)} after calm ones.`;
  }
  if (row.verdict === "lowers-risk") {
    return `The pattern runs the other way here. Calm stretches were followed by this fall slightly more often than turbulent ones, which is a sign the signal does not hold at every depth.`;
  }
  return `The two are close enough that recent turbulence told us little at this depth.`;
}

function ComparisonBar({
  label,
  rate,
  max,
  tone,
}: {
  label: string;
  rate: number;
  max: number;
  tone: "calm" | "turbulent";
}) {
  // Floor the height so a zero rate still reads as an empty column rather than
  // a missing one, which would look like absent data instead of a real zero.
  const height = max > 0 ? Math.max((rate / max) * 100, 3) : 3;
  return (
    <div className="rounded-lg bg-muted p-4">
      <p className="mb-2.5 text-xs text-muted-foreground">{label}</p>
      <div className="flex h-20 items-end">
        <div
          className={`w-full rounded-t transition-[height] duration-(--dur-base) ease-(--ease-ui) ${
            tone === "calm" ? "bg-emerald-500" : "bg-red-500"
          }`}
          style={{ height: `${height}%` }}
        />
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{pct1(rate)}</p>
    </div>
  );
}

export function TurbulencePanel({ model }: { model: OutlookViewModel }) {
  const rows = model.turbulence.filter((r) => r.horizonKey === COMPARISON_HORIZON);
  const [threshold, setThreshold] = useState<string>(() => String(rows[1]?.threshold ?? rows[0]?.threshold ?? ""));
  const row = rows.find((r) => String(r.threshold) === threshold) ?? rows[0];

  if (!row) return null;

  const max = Math.max(row.calmRate, row.turbulentRate, 0);

  return (
    <Card className="rise rise-2">
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-editorial text-foreground">
            Does a rough patch tend to be followed by another
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Splitting the past five years into calm and turbulent stretches by how much the market had been moving, then
            counting what happened over the {COMPARISON_WINDOW_COPY} that followed each.
          </p>
        </div>

        <SegmentedControl
          label="Size of drop"
          value={threshold}
          onChange={setThreshold}
          // Bare percentages keep four options inside a phone's width; the hint
          // restores the full meaning for screen readers.
          options={rows.map((r) => ({
            value: String(r.threshold),
            label: `${r.pct}%`,
            hint: `A drop of ${r.pct} percent or more`,
          }))}
        />

        <p className="text-center text-base font-semibold leading-snug text-foreground">{headline(row)}</p>

        <div className="grid grid-cols-2 gap-3">
          <ComparisonBar label="After a calm market" rate={row.calmRate} max={max} tone="calm" />
          <ComparisonBar label="After a turbulent market" rate={row.turbulentRate} max={max} tone="turbulent" />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{caption(row)}</p>

        <Disclosure label="Show the detailed numbers">
          <DetailRow label="Rate after calm stretches" value={pct1(row.calmRate)} />
          <DetailRow label="Rate after turbulent stretches" value={pct1(row.turbulentRate)} />
          <DetailRow label="Rate across all periods" value={pct1(row.baseRate)} />
          <DetailRow
            label="Turbulent rate against the overall rate"
            value={Number.isFinite(row.lift) ? `${row.lift.toFixed(2)} times` : "n/a"}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            The calm and turbulent groups are the outer thirds of the same history these rates are measured on, so this
            shows the pattern was present in the past. It is not a test on unseen periods, and it is not a forecast.
          </p>
        </Disclosure>
      </CardContent>
    </Card>
  );
}
