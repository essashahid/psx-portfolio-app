import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SignalClass, SignalEvidenceReport, CellEvidence } from "@/lib/engine/outlook/evaluate";

/**
 * Phase 2 signal evidence, rendered for review on the data page.
 *
 * A research artifact, not a product surface: verdicts, the cells they rest
 * on, and the methodology, with the negative results given the same billing as
 * the positive ones. Nothing here is a forecast and nothing is fitted.
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
const x = (v: number | null) => (v !== null && Number.isFinite(v) ? `${v.toFixed(2)}x` : "n/a");

/** The primary cell that best represents a signal: its verdict-defining one. */
function headlineCell(cells: CellEvidence[], verdict: SignalClass): CellEvidence {
  const primary = cells.filter((c) => !c.secondary);
  return primary.find((c) => c.classification === verdict) ?? primary[0];
}

function SectionHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-editorial text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
  );
}

export function SignalEvidenceView({ report }: { report: SignalEvidenceReport }) {
  const order: SignalClass[] = ["strong", "moderate", "redundant", "unstable", "weak", "insufficient"];
  const sorted = [...report.signals].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));
  const pairCellsWithEvidence = report.pairs.flatMap((p) => p.cells).filter((c) => c.quotable);

  return (
    <div className="space-y-6">
      <Card className="rise">
        <CardContent className="p-4">
          <SectionHeading
            title="Phase 2 signal evidence"
            blurb={`Every candidate signal tested against 3% and 5% drawdowns over 5, 10 and 20 sessions (1 month measured but never decisive), with states assigned from each signal's own expanding history so a date is only ever judged by cut-offs that existed on that date. Verdicts weigh distinct market episodes, stability across sample halves, and whether the signal adds anything beyond volatility. Descriptive and in-sample; no model has been fitted.`}
          />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[52rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Signal</th>
                  <th className="pb-2 pr-3 font-medium">Family</th>
                  <th className="pb-2 pr-3 text-right font-medium">Coverage</th>
                  <th className="pb-2 pr-3 text-right font-medium">Defining cell</th>
                  <th className="pb-2 pr-3 text-right font-medium">Lift</th>
                  <th className="pb-2 pr-3 text-right font-medium">Episodes</th>
                  <th className="pb-2 pr-3 text-right font-medium">Beyond vol</th>
                  <th className="pb-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const cell = headlineCell(s.cells, s.verdict);
                  const badge = VERDICT_BADGE[s.verdict];
                  return (
                    <tr key={s.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3">
                        <span className="text-foreground">{s.label}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{s.verdictReason}</span>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{s.family}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {s.coverage.observations.toLocaleString()} obs
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {Math.abs(cell.threshold * 100).toFixed(0)}% / {cell.horizonKey}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{x(cell.lift)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{cell.hitEpisodes}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {cell.beyondVol ? x(cell.beyondVol.lift) : "benchmark"}
                      </td>
                      <td className="py-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="rise rise-1">
        <CardContent className="p-4">
          <SectionHeading
            title="The Phase 1 breadth lead did not survive point-in-time testing"
            blurb="Phase 1 found that narrow participation during calm markets looked informative. That analysis defined narrow using cut-offs computed over the whole sample, which quietly used knowledge of where breadth would later sit. Re-run with cut-offs a date could actually have known, the calm-and-narrow combination never occurred at all: every point-in-time narrow reading fell inside a single turbulent stretch. Negative results like this are the reason the stricter method exists, and the pair remains worth re-testing as more history accrues."
          />
          {pairCellsWithEvidence.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No signal pair currently carries enough distinct episodes to quote. Pair analysis resumes as coverage grows.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.pairs
                .filter((p) => p.cells.some((c) => c.quotable))
                .map((p) => (
                  <li key={`${p.anchor}-${p.other}`} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {p.anchor} with {p.other}:
                    </span>{" "}
                    {p.cells
                      .filter((c) => c.quotable)
                      .map(
                        (c) =>
                          `${Math.abs(c.threshold * 100).toFixed(0)}%/${c.horizonKey} lift ${x(c.liftWithinAnchorSafe)} on ${c.hitEpisodes} episodes`
                      )
                      .join("; ")}
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="rise rise-2">
        <CardContent className="p-4">
          <SectionHeading
            title="Market regimes, descriptively"
            blurb="Trend against the 200-day average crossed with the volatility tercile, with the share of history spent in each state and the drawdown rates that followed. Read alongside the episode counts: the downtrend states are rare in this sample, so their rates rest on a handful of events."
          />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[44rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Regime</th>
                  <th className="pb-2 pr-3 text-right font-medium">Share of history</th>
                  {report.regimes[0]?.cells.map((c) => (
                    <th key={`${c.horizonKey}-${c.threshold}`} className="pb-2 pr-3 text-right font-medium">
                      {Math.abs(c.threshold * 100).toFixed(0)}% / {c.horizonKey}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.regimes.map((r) => (
                  <tr key={r.key} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-foreground">{r.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{pct(r.occupancyShare)}</td>
                    {r.cells.map((c) => (
                      <td key={`${c.horizonKey}-${c.threshold}`} className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {pct(c.rate)}
                        <span className="block text-[10px] text-muted-foreground/70">{c.hitEpisodes} ep</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="rise rise-3">
        <CardContent className="p-4">
          <SectionHeading title="Method" blurb="The rules this evidence was produced under, in full." />
          <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
            {report.method.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Window: {report.window.firstDate} to {report.window.lastDate}, {report.window.sessions.toLocaleString()} sessions.
            Generated {new Date(report.generatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
