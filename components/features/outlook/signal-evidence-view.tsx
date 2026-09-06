import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
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
      <h2 className="text-sm font-semibold tracking-editorial text-text-strong">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-muted">{blurb}</p>
    </div>
  );
}

/**
 * Sections drop their card chrome when rendered inside a disclosure panel,
 * which already supplies a surface. Cards nested inside cards read as clutter.
 */
function Section({ bare, className, children }: { bare: boolean; className?: string; children: React.ReactNode }) {
  if (bare) return <div className="border-b border-rule/60 pb-4 last:border-0 last:pb-0">{children}</div>;
  return (
    <Card className={className}>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

export function SignalEvidenceView({ report, bare = false }: { report: SignalEvidenceReport; bare?: boolean }) {
  const order: SignalClass[] = ["strong", "moderate", "redundant", "unstable", "weak", "insufficient"];
  const sorted = [...report.signals].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));
  const pairCellsWithEvidence = report.pairs.flatMap((p) => p.cells).filter((c) => c.quotable);

  return (
    <div className="space-y-6">
      <Section bare={bare} className="rise">
          <SectionHeading
            title="Phase 2 signal evidence"
            blurb={`Every candidate signal tested against 3% and 5% drawdowns over 5, 10 and 20 sessions (1 month measured but never decisive), with states assigned from each signal's own expanding history so a date is only ever judged by cut-offs that existed on that date. Verdicts weigh distinct market episodes, stability across sample halves, and whether the signal adds anything beyond volatility. Descriptive and in-sample; no model has been fitted.`}
          />
          <Table variant="reader" wrapperClassName="-mx-4 px-4" className="min-w-[52rem]">
            <THead>
              <TR>
                <TH>Signal</TH>
                <TH>Family</TH>
                <TH className="text-right">Coverage</TH>
                <TH className="text-right">Defining cell</TH>
                <TH className="text-right">Lift</TH>
                <TH className="text-right">Episodes</TH>
                <TH className="text-right">Beyond vol</TH>
                <TH>Verdict</TH>
              </TR>
            </THead>
            <TBody>
              {sorted.map((s) => {
                const cell = headlineCell(s.cells, s.verdict);
                const badge = VERDICT_BADGE[s.verdict];
                return (
                  <TR key={s.key}>
                    <TD>
                      <span className="text-text-strong">{s.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">{s.verdictReason}</span>
                    </TD>
                    <TD className="text-text-muted">{s.family}</TD>
                    <TD className="text-right tabular-nums text-text-muted">
                      {s.coverage.observations.toLocaleString()} obs
                    </TD>
                    <TD className="text-right tabular-nums text-text-muted">
                      {Math.abs(cell.threshold * 100).toFixed(0)}% / {cell.horizonKey}
                    </TD>
                    <TD className="text-right tabular-nums text-text-muted">{x(cell.lift)}</TD>
                    <TD className="text-right tabular-nums text-text-muted">{cell.hitEpisodes}</TD>
                    <TD className="text-right tabular-nums text-text-muted">
                      {cell.beyondVol ? x(cell.beyondVol.lift) : "benchmark"}
                    </TD>
                    <TD>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
      </Section>

      <Section bare={bare} className="rise rise-1">
          <SectionHeading
            title="The Phase 1 breadth lead did not survive point-in-time testing"
            blurb="Phase 1 found that narrow participation during calm markets looked informative. That analysis defined narrow using cut-offs computed over the whole sample, which quietly used knowledge of where breadth would later sit. Re-run with cut-offs a date could actually have known, the calm-and-narrow combination never occurred at all: every point-in-time narrow reading fell inside a single turbulent stretch. Negative results like this are the reason the stricter method exists, and the pair remains worth re-testing as more history accrues."
          />
          {pairCellsWithEvidence.length === 0 ? (
            <p className="text-xs text-text-muted">
              No signal pair currently carries enough distinct episodes to quote. Pair analysis resumes as coverage grows.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.pairs
                .filter((p) => p.cells.some((c) => c.quotable))
                .map((p) => (
                  <li key={`${p.anchor}-${p.other}`} className="text-xs text-text-muted">
                    <span className="font-medium text-text-strong">
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
      </Section>

      <Section bare={bare} className="rise rise-2">
          <SectionHeading
            title="Market regimes, descriptively"
            blurb="Trend against the 200-day average crossed with the volatility tercile, with the share of history spent in each state and the drawdown rates that followed. Read alongside the episode counts: the downtrend states are rare in this sample, so their rates rest on a handful of events."
          />
          <Table variant="reader" wrapperClassName="-mx-4 px-4" className="min-w-[44rem]">
            <THead>
              <TR>
                <TH>Regime</TH>
                <TH className="text-right">Share of history</TH>
                {report.regimes[0]?.cells.map((c) => (
                  <TH key={`${c.horizonKey}-${c.threshold}`} className="text-right">
                    {Math.abs(c.threshold * 100).toFixed(0)}% / {c.horizonKey}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {report.regimes.map((r) => (
                <TR key={r.key}>
                  <TD className="text-text-strong">{r.label}</TD>
                  <TD className="text-right tabular-nums text-text-muted">{pct(r.occupancyShare)}</TD>
                  {r.cells.map((c) => (
                    <TD key={`${c.horizonKey}-${c.threshold}`} className="text-right tabular-nums text-text-muted">
                      {pct(c.rate)}
                      <span className="block text-[10px] text-text-muted/70">{c.hitEpisodes} ep</span>
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
      </Section>

      <Section bare={bare} className="rise rise-3">
          <SectionHeading title="Method" blurb="The rules this evidence was produced under, in full." />
          <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-text-muted">
            {report.method.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-text-muted">
            Window: {report.window.firstDate} to {report.window.lastDate}, {report.window.sessions.toLocaleString()} sessions.
            Generated {new Date(report.generatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })}.
          </p>
      </Section>
    </div>
  );
}
