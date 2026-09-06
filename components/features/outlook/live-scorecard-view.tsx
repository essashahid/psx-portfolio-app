import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MIN_SCORED_FOR_SKILL, type LiveScorecard, type TaskScore } from "@/lib/engine/outlook/scorecard";

/**
 * The live track record.
 *
 * Phase 3 measured the models on history. This measures them on predictions
 * made before the outcome existed, which is the only evidence that settles
 * whether the walk-forward result holds going forward. Until a group has
 * enough scored results it is shown as accumulating rather than as a
 * measurement, because a handful of outcomes says nothing.
 */

const TASK_LABEL: Record<string, string> = {
  direction: "Direction",
  "trading-range": "Trading range",
  drawdown: "Drawdown risk",
};

const pct = (v: number | null, d = 0) => (v !== null && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—");
const num = (v: number | null) => (v !== null && Number.isFinite(v) ? v.toFixed(3) : "—");

/** What the record currently says, phrased for the evidence available. */
function verdictOf(s: TaskScore): { text: string; variant: "green" | "amber" | "secondary" } {
  if (!s.reportable) {
    return { text: `${s.scored} of ${MIN_SCORED_FOR_SKILL}`, variant: "secondary" };
  }
  if (s.task === "direction" && s.hitRate !== null && s.baselineHitRate !== null) {
    return s.hitRate > s.baselineHitRate
      ? { text: "Ahead of baseline", variant: "green" }
      : { text: "Not ahead of baseline", variant: "amber" };
  }
  if (s.task === "trading-range" && s.coverage !== null) {
    // The band is built to contain 80% of paths; far outside that is miscalibrated.
    return s.coverage >= 0.72 && s.coverage <= 0.92
      ? { text: "Calibrated", variant: "green" }
      : { text: "Miscalibrated", variant: "amber" };
  }
  if (s.task === "drawdown" && s.brier !== null && s.baselineBrier !== null) {
    return s.brier < s.baselineBrier
      ? { text: "Ahead of base rate", variant: "green" }
      : { text: "Not ahead of base rate", variant: "amber" };
  }
  return { text: "Accumulating", variant: "secondary" };
}

/** The measurement that matters for each task. */
function measureOf(s: TaskScore): string {
  if (!s.reportable) return "Not yet reportable";
  if (s.task === "direction") return `Called correctly ${pct(s.hitRate)} vs ${pct(s.baselineHitRate)} for always guessing the commonest outcome`;
  if (s.task === "trading-range") return `Path stayed inside the band ${pct(s.coverage)} of the time, against a design target of 80%`;
  if (s.task === "drawdown") return `Brier ${num(s.brier)} against ${num(s.baselineBrier)} for the base rate, lower being better`;
  return "—";
}

export function LiveScorecardView({ scorecard }: { scorecard: LiveScorecard }) {
  const anyReportable = scorecard.scores.some((s) => s.reportable);

  return (
    <Card className="rise">
      <CardContent className="p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold tracking-editorial text-text-strong">Live track record</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-muted">
            Every prediction the models make is recorded before the outcome exists, and scored once the window has
            elapsed. Phase 3 showed how the models behaved on history; this shows how they behave going forward, which
            is the evidence that decides whether they are worth shipping.
          </p>
        </div>

        {scorecard.totalScored === 0 && scorecard.totalPending === 0 ? (
          <p className="text-xs text-text-muted">
            No predictions recorded yet. The daily job starts the record on its next run.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span className="text-text-muted">
                Scored: <span className="font-medium tabular-nums text-text-strong">{scorecard.totalScored}</span>
              </span>
              <span className="text-text-muted">
                Awaiting their outcome: <span className="font-medium tabular-nums text-text-strong">{scorecard.totalPending}</span>
              </span>
            </div>

            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[44rem] text-xs">
                <thead>
                  <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="pb-2 pr-3 font-medium">Output</th>
                    <th className="pb-2 pr-3 font-medium">Window</th>
                    <th className="pb-2 pr-3 text-right font-medium">Scored</th>
                    <th className="pb-2 pr-3 font-medium">Result so far</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.scores.map((s) => {
                    const verdict = verdictOf(s);
                    return (
                      <tr key={`${s.task}-${s.horizon}-${s.threshold ?? ""}-${s.model}`} className="border-b border-rule/60 last:border-0">
                        <td className="py-2 pr-3 text-text-strong">
                          {TASK_LABEL[s.task] ?? s.task}
                          {s.threshold !== null && ` (${Math.abs(s.threshold * 100).toFixed(0)}%)`}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-text-muted">{s.horizon} sessions</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-text-muted">{s.scored}</td>
                        <td className="py-2 pr-3 text-text-muted">{measureOf(s)}</td>
                        <td className="py-2">
                          <Badge variant={verdict.variant}>{verdict.text}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
              {scorecard.note}
              {!anyReportable && " Nothing here is a measurement yet; the record is still being built."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
