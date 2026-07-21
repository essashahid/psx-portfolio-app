"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { SignalClass } from "@/lib/engine/outlook/evaluate";
import type { SignalRow, CompactCell } from "@/lib/engine/outlook/data-dashboard";

/**
 * The full signal results, as something to explore rather than a wall to read.
 *
 * The default filter is the three signals carried forward, because that is the
 * conclusion. The seventeen that failed stay one click away rather than
 * hidden: how a candidate died is evidence too, and the reasons are what stop
 * the same idea being retried later.
 */

const VERDICT_BADGE: Record<SignalClass, { label: string; variant: "green" | "blue" | "amber" | "red" | "secondary" | "outline" }> = {
  strong: { label: "Strong", variant: "green" },
  moderate: { label: "Moderate", variant: "blue" },
  weak: { label: "Weak", variant: "secondary" },
  redundant: { label: "Redundant", variant: "amber" },
  unstable: { label: "Unstable", variant: "amber" },
  insufficient: { label: "Insufficient", variant: "outline" },
};

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");
const lift = (v: number | null) => (v !== null && Number.isFinite(v) ? `${v.toFixed(2)}x` : "n/a");

type Filter = "carried" | "failed" | "all";

function CellTable({ cells }: { cells: CompactCell[] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[38rem] text-[11px]">
        <thead>
          <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
            <th className="pb-1.5 pr-3 font-medium">Cell</th>
            <th className="pb-1.5 pr-3 text-right font-medium">Base</th>
            <th className="pb-1.5 pr-3 text-right font-medium">After signal</th>
            <th className="pb-1.5 pr-3 text-right font-medium">Lift</th>
            <th className="pb-1.5 pr-3 text-right font-medium">Episodes</th>
            <th className="pb-1.5 pr-3 text-right font-medium">Halves</th>
            <th className="pb-1.5 pr-3 text-right font-medium">Beyond vol</th>
            <th className="pb-1.5 font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={`${c.horizonKey}-${c.threshold}`} className="border-b border-border/50 last:border-0">
              <td className="py-1.5 pr-3 whitespace-nowrap text-foreground">
                {Math.abs(c.threshold * 100).toFixed(0)}% / {c.horizonKey}
                {c.secondary && <span className="ml-1 text-muted-foreground/70">(secondary)</span>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{pct(c.baseRate)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{pct(c.riskyRate)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-foreground">{lift(c.lift)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{c.hitEpisodes}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                {lift(c.firstHalfLift)} / {lift(c.secondHalfLift)}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                {c.beyondVolLift === null && c.beyondVolEpisodes === null ? "benchmark" : lift(c.beyondVolLift)}
              </td>
              <td className="py-1.5 text-muted-foreground">{c.classification}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Lift is the drawdown rate after the signal&apos;s risky readings divided by the rate across all periods. Halves
        recompute it on each half of the sample; a flip means the pattern did not persist. Beyond vol repeats the
        measurement inside calm markets only, where volatility has nothing left to contribute.
      </p>
    </div>
  );
}

function SignalCard({ row }: { row: SignalRow }) {
  const [open, setOpen] = useState(false);
  const badge = VERDICT_BADGE[row.verdict];
  const d = row.defining;

  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-start gap-3 py-3 text-left",
          "transition-colors duration-(--dur-fast) ease-(--ease-ui) hover:bg-muted/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-foreground">{row.label}</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span className="text-[11px] text-muted-foreground">{row.family}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{row.verdictReason}</p>
        </div>
        {d && (
          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-xs font-medium tabular-nums text-foreground">{lift(d.lift)}</p>
            <p className="text-[10px] text-muted-foreground">
              {d.hitEpisodes} ep · {Math.abs(d.threshold * 100).toFixed(0)}%/{d.horizonKey}
            </p>
          </div>
        )}
        <ChevronDown
          aria-hidden
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast) ease-(--ease-ui)",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-(--dur-base) ease-(--ease-ui)"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mb-3 rounded-lg bg-muted p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              Measured over {row.observations.toLocaleString()} observations, {row.firstDate} to {row.lastDate}.
            </p>
            <CellTable cells={row.cells} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SignalExplorer({ signals }: { signals: SignalRow[] }) {
  const [filter, setFilter] = useState<Filter>("carried");

  const rows = useMemo(() => {
    if (filter === "carried") return signals.filter((s) => s.carriedForward);
    if (filter === "failed") return signals.filter((s) => !s.carriedForward);
    return signals;
  }, [signals, filter]);

  const carried = signals.filter((s) => s.carriedForward).length;

  return (
    <div>
      <SegmentedControl
        label="Which signals to show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "carried", label: `Carried forward (${carried})` },
          { value: "failed", label: `Did not survive (${signals.length - carried})` },
          { value: "all", label: `All (${signals.length})` },
        ]}
      />
      <div className="mt-3">
        {rows.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">No signals in this group.</p>
        ) : (
          rows.map((row) => <SignalCard key={row.key} row={row} />)
        )}
      </div>
    </div>
  );
}
