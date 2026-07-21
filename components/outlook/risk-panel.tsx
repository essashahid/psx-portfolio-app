"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ConfidenceChip, Disclosure, DetailRow, RangeIndicator } from "@/components/outlook/outlook-primitives";
import { returnDomain, type HorizonView, type OutlookViewModel } from "@/lib/engine/outlook/presentation";
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

/** Deeper declines are rarer, so each bar is scaled against the widest bar shown. */
function barWidth(frequency: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max((frequency / max) * 100, 1.5);
}

/** Depth of decline drives the colour ramp, from a wash to full danger. */
function barTone(index: number, total: number): string {
  if (total <= 1) return "bg-red-500";
  const ramp = ["bg-red-200", "bg-red-300", "bg-red-400", "bg-red-500"];
  return ramp[Math.min(index, ramp.length - 1)];
}

function ThresholdBars({ horizon }: { horizon: HorizonView }) {
  const max = Math.max(...horizon.thresholds.map((t) => t.frequency), 0);
  return (
    <div className="space-y-3">
      {horizon.thresholds.map((t, i) => (
        <div key={t.threshold}>
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Fell {t.pct}% or more</span>
            <span className="font-medium tabular-nums text-foreground">{pct1(t.frequency)}</span>
          </div>
          <div className="h-2 rounded-full bg-card">
            <div
              className={`h-2 rounded-full transition-[width] duration-(--dur-base) ease-(--ease-ui) ${barTone(i, horizon.thresholds.length)}`}
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

  return (
    <Card className="rise rise-1">
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-editorial text-foreground">
            How often the market has dropped
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Based on the past five years of the KSE-100. These are the rates at which declines actually happened, not
            predictions about what happens next.
          </p>
        </div>

        <SegmentedControl
          label="Time window"
          value={active}
          onChange={setActive}
          options={model.horizons.map((h) => ({ value: h.key, label: h.short }))}
        />

        <div className="rounded-lg bg-muted p-4">
          <p className="text-xs text-muted-foreground">Chance of a notable drop</p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums text-red-600">
              {horizon.headlineFrequency !== null ? pct1(horizon.headlineFrequency) : "n/a"}
            </span>
            <span className="text-sm text-muted-foreground">
              of periods saw a fall of 5% or more {horizon.forward}
            </span>
          </div>
          <div className="mt-4">
            <ThresholdBars horizon={horizon} />
          </div>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <p className="mb-3 text-xs text-muted-foreground">Where the market usually landed {horizon.forward}</p>
          <RangeIndicator
            p10={horizon.returnPercentiles.p10}
            median={horizon.returnPercentiles.median}
            p90={horizon.returnPercentiles.p90}
            domain={domain}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            The band covers the middle 80% of outcomes. One period in ten finished below the left figure, and one in ten
            above the right.
          </p>
        </div>

        <ConfidenceChip
          confidence={horizon.confidence}
          independentWindows={horizon.independentWindows}
          since={model.evidence?.firstDate ?? null}
        />

        <Disclosure label="Show the detailed numbers">
          <DetailRow label="Finished the period higher" value={pct1(horizon.positiveRate)} />
          <DetailRow label="Worst drop recorded in this window" value={fmtSigned(horizon.worstDrawdown)} />
          <DetailRow label="Weakest tenth of periods finished at or below" value={fmtSigned(horizon.returnPercentiles.p10)} />
          <DetailRow label="Strongest tenth finished at or above" value={fmtSigned(horizon.returnPercentiles.p90)} />
          <DetailRow label="Independent periods measured" value={`${horizon.independentWindows} non-overlapping`} />
          <DetailRow label="Window length" value={`${horizon.sessions} trading sessions`} />
        </Disclosure>
      </CardContent>
    </Card>
  );
}
