import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
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

            <Table variant="reader" wrapperClassName="-mx-4 px-4" className="min-w-[44rem]">
              <THead>
                <TR>
                  <TH>Output</TH>
                  <TH>Window</TH>
                  <TH className="text-right">Scored</TH>
                  <TH>Result so far</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {scorecard.scores.map((s) => {
                  const verdict = verdictOf(s);
                  return (
                    <TR key={`${s.task}-${s.horizon}-${s.threshold ?? ""}-${s.model}`}>
                      <TD className="text-text-strong">
                        {TASK_LABEL[s.task] ?? s.task}
                        {s.threshold !== null && ` (${Math.abs(s.threshold * 100).toFixed(0)}%)`}
                      </TD>
                      <TD className="tabular-nums text-text-muted">{s.horizon} sessions</TD>
                      <TD className="text-right tabular-nums text-text-muted">{s.scored}</TD>
                      <TD className="text-text-muted">{measureOf(s)}</TD>
                      <TD>
                        <Badge variant={verdict.variant}>{verdict.text}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>

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
