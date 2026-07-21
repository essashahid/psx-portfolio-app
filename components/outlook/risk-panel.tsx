"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ConfidenceChip, Disclosure, DetailRow, RangeIndicator } from "@/components/outlook/outlook-primitives";
import { returnDomain, type OutlookViewModel, type ThresholdView } from "@/lib/engine/outlook/presentation";
import type { HorizonKey } from "@/lib/engine/outlook/history-stats";

/**
 * How often the market has fallen, and where it has finished, over a chosen
 * window. One headline number carries the section; the supporting thresholds
 * are bars rather than a column of percentages, and the raw figures sit behind
 * a toggle.
 *
 * Every number is historical. The copy says "has fallen", never "will fall",
 * because no model exists yet and a base rate is not a forecast.
 */

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtSigned = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/** Larger moves are rarer, so each bar is scaled against the widest bar shown. */
function barWidth(frequency: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max((frequency / max) * 100, 1.5);
}

/** Size of the move drives the colour ramp, from a wash to full strength. */
function barTone(index: number, direction: "down" | "up"): string {
  const ramp =
    direction === "down"
      ? ["bg-red-200", "bg-red-300", "bg-red-400", "bg-red-500"]
      : ["bg-emerald-200", "bg-emerald-300", "bg-emerald-400", "bg-emerald-500"];
  return ramp[Math.min(index, ramp.length - 1)];
}

/**
 * Both directions share one scale. Scaling each side to its own widest bar
 * would make a rare event look as common as a frequent one purely because it
 * led its own column, which is exactly the comparison this section exists to
 * let a reader make.
 */
function ThresholdBars({
  thresholds,
  direction,
  max,
}: {
  thresholds: ThresholdView[];
  direction: "down" | "up";
  max: number;
}) {
  const verb = direction === "down" ? "Fell" : "Rose";
  return (
    <div className="space-y-3">
      {thresholds.map((t, i) => (
        <div key={t.threshold}>
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">
              {verb} {t.pct}% or more
            </span>
            <span className="font-medium tabular-nums text-foreground">{pct1(t.frequency)}</span>
          </div>
          <div className="h-2 rounded-full bg-card">
            <div
              className={`h-2 rounded-full transition-[width] duration-(--dur-base) ease-(--ease-ui) ${barTone(i, direction)}`}
              style={{ width: `${barWidth(t.frequency, max)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RiskPanel({ model }: { model: OutlookViewModel }) {
  const [active, setActive] = useState<HorizonKey>(model.horizons[1]?.key ?? model.horizons[0]?.key);
  const horizon = model.horizons.find((h) => h.key === active) ?? model.horizons[0];
  const domain = returnDomain(model.horizons);

  if (!horizon) return null;

  const sharedMax = Math.max(
    ...horizon.thresholds.map((t) => t.frequency),
    ...horizon.rallyThresholds.map((t) => t.frequency),
    0
  );

  return (
    <Card className="rise rise-1">
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-editorial text-foreground">
            How the market has moved
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Based on the past five years of the KSE-100. These are the rates at which moves actually happened, not
            predictions about what happens next.
          </p>
        </div>

        <SegmentedControl
          label="Time window"
          value={active}
          onChange={setActive}
          options={model.horizons.map((h) => ({ value: h.key, label: h.short }))}
        />

        {/* The headline is the balanced fact. Leading with the fall rate alone
            would describe a market that, over this history, rose more often
            than it fell. */}
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">Where the period ended</p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums text-emerald-600">{pct1(horizon.positiveRate)}</span>
            <span className="text-sm text-muted-foreground">
              of periods finished higher than they started {horizon.forward}
            </span>
          </div>
          <div className="mt-4">
            <RangeIndicator
              p10={horizon.returnPercentiles.p10}
              median={horizon.returnPercentiles.median}
              p90={horizon.returnPercentiles.p90}
              domain={domain}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              The band covers the middle 80% of closing outcomes. One period in ten finished below the left figure, and
              one in ten above the right.
            </p>
          </div>
        </div>

        {/* Intra-window extremes, both directions, on a shared scale. */}
        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">How far it travelled along the way</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Measured at the lowest and highest points reached inside the period, not where it closed. A period can show
            up in both columns, and most do.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Fell at some point
              </p>
              <ThresholdBars thresholds={horizon.thresholds} direction="down" max={sharedMax} />
            </div>
            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Rose at some point
              </p>
              <ThresholdBars thresholds={horizon.rallyThresholds} direction="up" max={sharedMax} />
            </div>
          </div>
        </div>

        <ConfidenceChip
          confidence={horizon.confidence}
          independentWindows={horizon.independentWindows}
          since={model.evidence?.firstDate ?? null}
        />

        <Disclosure label="Show the detailed numbers">
          <DetailRow label="Finished the period higher" value={pct1(horizon.positiveRate)} />
          <DetailRow label="Typical close-to-close result" value={fmtSigned(horizon.returnPercentiles.median)} />
          <DetailRow label="Weakest tenth of periods finished at or below" value={fmtSigned(horizon.returnPercentiles.p10)} />
          <DetailRow label="Strongest tenth finished at or above" value={fmtSigned(horizon.returnPercentiles.p90)} />
          <DetailRow label="Deepest fall recorded inside a period" value={fmtSigned(horizon.worstDrawdown)} />
          <DetailRow label="Largest rise recorded inside a period" value={fmtSigned(horizon.bestRunup)} />
          <DetailRow label="Independent periods measured" value={`${horizon.independentWindows} non-overlapping`} />
          <DetailRow label="Window length" value={`${horizon.sessions} trading sessions`} />
        </Disclosure>
      </CardContent>
    </Card>
  );
}
