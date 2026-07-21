import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GateDecision, ExperimentalOutlook } from "@/lib/engine/outlook/experimental-outlook";

/**
 * The Phase 3 review: gate outcomes, the experimental outlook, and the
 * said-versus-happened examples, rendered from the committed artifacts so the
 * page shows exactly the run that was evaluated, not a fresh recompute that
 * could silently drift from it.
 */

export interface Phase3Example {
  label: string;
  date: string;
  close: number;
  saidThen: {
    drawdownRisk5d3pct: { p: number } | null;
    direction10d: { fall: number; sideways: number; rise: number } | null;
    tradingRange10d: { loPct: number; hiPct: number } | null;
    nearestSupport: number | null;
    nearestResistance: number | null;
    trend: string;
  };
  whatHappened: { ret5: number | null; ret10: number | null; ret20: number | null; maxDip10: number | null; maxRise10: number | null };
}

export interface Phase3Evaluation {
  generatedAt: string;
  folds: number;
  gates: GateDecision[];
  levelStudy: { approaches: number; holdRate: number; placeboHoldRate: number; edge: number };
  examples: Phase3Example[];
}

const pct = (v: number | null | undefined, d = 0) => (v !== null && v !== undefined && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "n/a");
const signed = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "n/a");

const TASK_LABEL: Record<string, string> = {
  direction: "Direction",
  return: "Expected return",
  "closing-range": "Closing range",
  "trading-range": "Trading range",
  drawdown: "Drawdown risk",
};

function SectionHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-editorial text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
  );
}

export function Phase3Review({ evaluation, outlook }: { evaluation: Phase3Evaluation; outlook: ExperimentalOutlook }) {
  const passed = evaluation.gates.filter((g) => g.pass);

  return (
    <div className="space-y-6">
      <Card className="rise">
        <CardContent className="p-4">
          <p className="eyebrow mb-1.5">Phase 3 &middot; Model evaluation</p>
          <p className="text-sm leading-relaxed text-foreground">
            {passed.length} of {evaluation.gates.length} forecast outputs passed their walk-forward gate across{" "}
            {evaluation.folds} expanding folds. Everything below is the committed evaluation run; the outlook preview is
            experimental and not production-approved.
          </p>
        </CardContent>
      </Card>

      <Card className="rise rise-1">
        <CardContent className="p-4">
          <SectionHeading
            title="Ship or withhold, per output"
            blurb="Each forecast task was judged against its own naive baseline on the full test span and both halves. A withheld output failed and stays absent from any future product surface until it earns its place."
          />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[44rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Output</th>
                  <th className="pb-2 pr-3 font-medium">Horizon</th>
                  <th className="pb-2 pr-3 font-medium">Verdict</th>
                  <th className="pb-2 font-medium">Model or reason</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.gates.map((g, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-foreground">
                      {TASK_LABEL[g.task] ?? g.task}
                      {g.threshold !== undefined ? ` (${Math.abs(g.threshold * 100).toFixed(0)}%)` : ""}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{g.horizon} sessions</td>
                    <td className="py-2 pr-3">
                      <Badge variant={g.pass ? "green" : "secondary"}>{g.pass ? "Pass" : "Withheld"}</Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">{g.pass ? g.selectedModel : (g.reasons[0] ?? "failed its gate")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Support levels are shown as reference points only: a placebo-controlled study found no evidence they hold
            better than arbitrary nearby prices (held {pct(evaluation.levelStudy.holdRate)} vs{" "}
            {pct(evaluation.levelStudy.placeboHoldRate)} for placebo levels over {evaluation.levelStudy.approaches}{" "}
            approaches). Their break probabilities come from the validated path distribution instead.
          </p>
        </CardContent>
      </Card>

      <Card className="rise rise-2">
        <CardContent className="p-4">
          <SectionHeading
            title="Experimental outlook preview"
            blurb={`As of ${outlook.asOf}, KSE-100 at ${Math.round(outlook.close).toLocaleString()}. Risk level ${outlook.riskLevel}, trend ${outlook.context.trend}. Only outputs that passed their gate carry values; the rest state why they are withheld. Not production-approved and not shown to customers.`}
          />
          <div className="grid gap-3 lg:grid-cols-3">
            {outlook.horizons.map((h) => (
              <div key={h.sessions} className="rounded-lg bg-muted p-4">
                <p className="text-xs font-semibold text-foreground">{h.label}</p>
                <dl className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
                  <div>
                    <dt className="font-medium text-muted-foreground">Direction</dt>
                    <dd className="text-foreground">
                      {h.direction.status === "ok" && h.direction.probs
                        ? `Rise ${pct(h.direction.probs.rise)} · Sideways ${pct(h.direction.probs.sideways)} · Fall ${pct(h.direction.probs.fall)}`
                        : "Withheld: failed its walk-forward gate"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Likely trading range</dt>
                    <dd className="text-foreground">
                      {h.tradingRange.status === "ok"
                        ? `${h.tradingRange.loIndex?.toLocaleString()} to ${h.tradingRange.hiIndex?.toLocaleString()}`
                        : "Withheld"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Drawdown risk</dt>
                    <dd className="text-foreground">
                      {h.drawdownRisk
                        .map((d) =>
                          d.status === "ok" ? `${Math.abs(d.threshold * 100).toFixed(0)}% dip: ${pct(d.p)}` : `${Math.abs(d.threshold * 100).toFixed(0)}%: withheld`
                        )
                        .join(" · ")}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Nearest levels</dt>
                    <dd className="text-foreground">
                      {h.keyLevels.supports[0] ? `S ${h.keyLevels.supports[0].price.toLocaleString()} (break ${pct(h.keyLevels.supports[0].breakProb)})` : "—"}
                      {h.keyLevels.resistances[0]
                        ? ` · R ${h.keyLevels.resistances[0].price.toLocaleString()} (touch ${pct(h.keyLevels.resistances[0].breakProb)})`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Expected return / closing range / scenarios</dt>
                    <dd className="text-muted-foreground">Withheld: failed their walk-forward gates</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rise rise-3">
        <CardContent className="p-4">
          <SectionHeading
            title="What it would have said, and what happened"
            blurb="Four dates chosen mechanically from the test window: the entry into the worst month, the strongest month, the quietest month, and the most recent resolved date. The predictions shown are the walk-forward outputs of the models that passed, exactly as they stood on those dates."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {evaluation.examples.map((ex) => (
              <div key={ex.date} className="rounded-lg bg-muted p-4 text-[11px] leading-relaxed">
                <p className="text-xs font-semibold text-foreground">{ex.label}</p>
                <p className="text-muted-foreground">
                  {ex.date} · KSE-100 {Math.round(ex.close).toLocaleString()} · trend {ex.saidThen.trend}
                </p>
                <p className="mt-2 text-foreground">
                  Said then:{" "}
                  {[
                    ex.saidThen.drawdownRisk5d3pct ? `3% dip within a week ${pct(ex.saidThen.drawdownRisk5d3pct.p)}` : null,
                    ex.saidThen.direction10d ? `two-week lean rise ${pct(ex.saidThen.direction10d.rise)} / fall ${pct(ex.saidThen.direction10d.fall)}` : null,
                    ex.saidThen.tradingRange10d ? `two-week range ${signed(ex.saidThen.tradingRange10d.loPct)} to ${signed(ex.saidThen.tradingRange10d.hiPct)}` : null,
                  ]
                    .filter(Boolean)
                    .join("; ")}
                  .
                </p>
                <p className="mt-1 text-muted-foreground">
                  Happened: week {signed(ex.whatHappened.ret5)}, two weeks {signed(ex.whatHappened.ret10)}, month {signed(ex.whatHappened.ret20)}; deepest
                  two-week dip {signed(ex.whatHappened.maxDip10)}.
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            The first example is an honest miss kept on display: the direction model leaned 67% rise directly before the
            worst month in the sample, and the two-week path fell below the range&apos;s lower bound. Ranges and
            probabilities narrow the odds; they do not remove surprise.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
