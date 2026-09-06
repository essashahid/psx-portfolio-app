import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { confidenceFor, MAIN_VIEW_HORIZONS } from "@/lib/engine/outlook/presentation";
import { MIN_EPISODES_TO_QUOTE } from "@/lib/engine/outlook/breadth-signal";
import type { OutlookCoverageReport, SeriesCoverage, SeriesQuality } from "@/lib/engine/outlook/coverage";

/**
 * The technical companion to the Outlook tab: what data exists, how current it
 * is, what is missing, and the full statistics behind the main view including
 * the horizons the main view deliberately leaves out.
 *
 * This is the page to check before trusting anything on the main tab. It is
 * kept separate rather than collapsed into it, because a reader who wants to
 * know how often the market falls should not have to scroll past a
 * fifteen-row freshness audit to find out.
 */

const QUALITY_LABEL: Record<SeriesQuality, string> = {
  good: "Current",
  limited: "Thin",
  stale: "Stale",
  missing: "Absent",
};

/** Colour is reserved for the two states that need action. */
function qualityClass(q: SeriesQuality): string {
  if (q === "stale") return "text-amber-700";
  if (q === "missing") return "text-down";
  return "text-text-muted";
}

const pct = (v: number, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "n/a");
const signed = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "n/a");

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

function CoverageRow({ s }: { s: SeriesCoverage }) {
  return (
    <TR>
      <TD>
        <span className="text-text-strong">{s.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-text-muted">{s.note}</span>
      </TD>
      <TD className="text-text-muted">{s.granularity}</TD>
      <TD className="text-right tabular-nums text-text-muted">{s.rows.toLocaleString()}</TD>
      <TD className="whitespace-nowrap tabular-nums text-text-muted">
        {s.firstDate ? `${s.firstDate} to ${s.lastDate}` : "none"}
      </TD>
      <TD className="text-right tabular-nums text-text-muted">
        {s.years > 0 ? `${s.years.toFixed(1)}y` : "n/a"}
      </TD>
      <TD className={`${qualityClass(s.quality)}`}>
        {QUALITY_LABEL[s.quality]}
        {s.quality === "stale" && s.ageDays !== null ? ` (${s.ageDays}d)` : ""}
      </TD>
      <TD className="text-text-muted">{s.modelReady ? "Yes" : "No"}</TD>
    </TR>
  );
}

export function OutlookCoverageView({ report, bare = false }: { report: OutlookCoverageReport; bare?: boolean }) {
  const staleSeries = report.series.filter((s) => s.quality === "stale");
  const trainable = report.series.filter((s) => s.modelReady);
  const shown = new Set<string>(MAIN_VIEW_HORIZONS);
  const thresholds = report.horizons[0]?.thresholds.map((t) => t.threshold) ?? [];

  return (
    <div className="space-y-6">
      <div className="rise grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Index history"
          value={report.index ? `${report.index.years.toFixed(1)} years` : "none"}
          sub={report.index ? `${report.index.points.toLocaleString()} trading sessions` : undefined}
        />
        <StatCard
          label="Series trainable"
          value={`${trainable.length} of ${report.series.length}`}
          sub="Three or more years of regular history"
        />
        <StatCard
          label="Series needing attention"
          value={String(staleSeries.length)}
          sub={staleSeries.length ? staleSeries.map((s) => s.label).join(", ") : "All current"}
          tone={staleSeries.length ? "negative" : undefined}
        />
        <StatCard label="Known missing sources" value={String(report.missing.length)} sub="Listed in full below" />
      </div>

      {report.bindingConstraint && (
        <Section bare={bare} className="rise rise-1">
            <SectionHeading
              title="What bounds the work"
              blurb={`Any model can only be trained over a period where all its inputs exist. The shortest trainable daily series is ${report.bindingConstraint.series}, starting ${report.bindingConstraint.firstDate}, which gives about ${report.bindingConstraint.years.toFixed(1)} years. Deeper history for other inputs does not extend that limit.`}
            />
        </Section>
      )}

      <Section bare={bare} className="rise rise-1">
          <SectionHeading
            title="Every horizon measured"
            blurb="Including the two the main view leaves out. The 20-session window is within a rounding error of the 21-session one, so showing both would imply a distinction that does not exist. The three-month window is excluded because its sample is too thin to judge and the turbulence signal disappears there entirely."
          />
          <Table variant="reader" wrapperClassName="-mx-4 px-4" className="min-w-[46rem]">
            <THead>
              <TR>
                <TH>Window</TH>
                {thresholds.map((t) => (
                  <TH key={t} className="text-right">
                    Fell {Math.abs(t * 100).toFixed(0)}%
                  </TH>
                ))}
                <TH className="text-right">Higher</TH>
                <TH className="text-right">Worst</TH>
                <TH className="text-right">Sample</TH>
                <TH>Evidence</TH>
              </TR>
            </THead>
            <TBody>
              {report.horizons.map((h) => {
                const confidence = confidenceFor(h.independentWindows);
                return (
                  <TR key={h.key}>
                    <TD className="text-text-strong">
                      {h.label}
                      {!shown.has(h.key) && (
                        <span className="ml-1.5 text-[11px] text-text-muted">(not shown)</span>
                      )}
                    </TD>
                    {h.thresholds.map((t) => (
                      <TD key={t.threshold} className="text-right tabular-nums text-text-muted">
                        {pct(t.frequency)}
                        <span className="block text-[10px] text-text-muted/70">{t.hits} events</span>
                      </TD>
                    ))}
                    <TD className="text-right tabular-nums text-text-muted">{pct(h.positiveRate)}</TD>
                    <TD className="text-right tabular-nums text-text-muted">
                      {signed(h.drawdownPercentiles.worst)}
                    </TD>
                    <TD className="text-right tabular-nums text-text-muted">
                      {h.independentWindows}
                    </TD>
                    <TD>
                      <Badge variant={confidence.variant}>{confidence.label}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
            Sample counts non-overlapping windows. Overlapping windows reuse the same market episodes, so quoting them
            would make a five-year record look like several thousand independent observations.
          </p>
      </Section>

      {report.volConditional.length > 0 && (
        <Section bare={bare} className="rise rise-2">
            <SectionHeading
              title="Turbulence signal at every horizon"
              blurb="Drawdown rates after calm and turbulent stretches, split by trailing volatility terciles. A ratio above one means turbulent periods were followed by more declines than the overall rate. Measured in-sample, so this indicates whether a model is worth building rather than proving one would work."
            />
            <Table variant="reader" wrapperClassName="-mx-4 px-4" className="min-w-[40rem]">
              <THead>
                <TR>
                  <TH>Window</TH>
                  <TH className="text-right">Drop</TH>
                  <TH className="text-right">All periods</TH>
                  <TH className="text-right">After calm</TH>
                  <TH className="text-right">After turbulence</TH>
                  <TH className="text-right">Ratio</TH>
                </TR>
              </THead>
              <TBody>
                {report.volConditional.map((v) => {
                  const h = report.horizons.find((x) => x.key === v.horizonKey);
                  const informative = Number.isFinite(v.lift) && v.lift >= 1.25;
                  return (
                    <TR key={`${v.horizonKey}-${v.threshold}`}>
                      <TD className="text-text-strong">{h?.label ?? v.horizonKey}</TD>
                      <TD className="text-right tabular-nums text-text-muted">
                        {Math.abs(v.threshold * 100).toFixed(0)}%
                      </TD>
                      <TD className="text-right tabular-nums text-text-muted">{pct(v.baseRate)}</TD>
                      <TD className="text-right tabular-nums text-text-muted">{pct(v.lowVolRate)}</TD>
                      <TD className="text-right tabular-nums text-text-muted">{pct(v.highVolRate)}</TD>
                      <TD
                        className={`text-right tabular-nums ${informative ? "font-medium text-text-strong" : "text-text-muted"}`}
                      >
                        {Number.isFinite(v.lift) ? `${v.lift.toFixed(2)}x` : "n/a"}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
        </Section>
      )}

      {report.breadthSignal && report.breadthSignal.quadrants.length > 0 && (
        <Section bare={bare} className="rise rise-2">
            <SectionHeading
              title="Breadth as a candidate signal (Phase 2 research note)"
              blurb="Whether a market being carried by fewer stocks has preceded declines, and more importantly whether that says anything volatility does not already say. Both groups below are calm periods, so any difference is information the volatility probe misses. Not shown on the main tab: read the episode column before trusting any ratio here."
            />
            <Table variant="reader" wrapperClassName="-mx-4 px-4" className="min-w-[44rem]">
              <THead>
                <TR>
                  <TH>Window</TH>
                  <TH className="text-right">Drop</TH>
                  <TH className="text-right">Calm + broad</TH>
                  <TH className="text-right">Calm + narrow</TH>
                  <TH className="text-right">Ratio</TH>
                  <TH className="text-right">Distinct episodes</TH>
                </TR>
              </THead>
              <TBody>
                {report.breadthSignal.quadrants.map((q) => {
                  const h = report.horizons.find((x) => x.key === q.horizonKey);
                  return (
                    <TR key={`${q.horizonKey}-${q.threshold}`}>
                      <TD className="text-text-strong">{h?.label ?? q.horizonKey}</TD>
                      <TD className="text-right tabular-nums text-text-muted">
                        {Math.abs(q.threshold * 100).toFixed(0)}%
                      </TD>
                      <TD className="text-right tabular-nums text-text-muted">
                        {pct(q.calmBroad.rate)}
                      </TD>
                      <TD className="text-right tabular-nums text-text-muted">
                        {pct(q.calmNarrow.rate)}
                      </TD>
                      <TD
                        className={`text-right tabular-nums ${q.quotable ? "font-medium text-text-strong" : "text-text-muted/50"}`}
                      >
                        {q.quotable && Number.isFinite(q.narrowLiftWithinCalm)
                          ? `${q.narrowLiftWithinCalm.toFixed(2)}x`
                          : "too thin"}
                      </TD>
                      <TD className="text-right tabular-nums text-text-muted">
                        {q.calmNarrowEpisodes}
                        {q.calmNarrowHits > 0 && (
                          <span className="ml-1 text-[10px] text-text-muted/70">({q.calmNarrowHits} windows)</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
              Ratios are withheld below {MIN_EPISODES_TO_QUOTE} distinct episodes. Several of the largest figures here
              rest on one or two market episodes seen through overlapping windows, which describes those episodes rather
              than a pattern. Measured over {report.breadthSignal.usableSessions} sessions from{" "}
              {report.breadthSignal.firstDate} to {report.breadthSignal.lastDate}; the window starts later than the price
              history because a 200-day average needs 200 sessions before it means anything.
            </p>
        </Section>
      )}

      <Section bare={bare} className="rise rise-3">
          <SectionHeading
            title="Data coverage"
            blurb="Every series the outlook would draw on, with its actual range and freshness. Trainable means the series has enough regular history to fit a model on. Series marked no can still describe current conditions, but cannot teach a model what past conditions led to."
          />
          <Table variant="reader" wrapperClassName="-mx-4 px-4" className="min-w-[52rem]">
            <THead>
              <TR>
                <TH>Series</TH>
                <TH>Grain</TH>
                <TH className="text-right">Rows</TH>
                <TH>Range</TH>
                <TH className="text-right">Span</TH>
                <TH>State</TH>
                <TH>Trainable</TH>
              </TR>
            </THead>
            <TBody>
              {report.series.map((s) => (
                <CoverageRow key={s.key} s={s} />
              ))}
            </TBody>
          </Table>
      </Section>

      <Section bare={bare} className="rise rise-4">
          <SectionHeading
            title="What we do not have"
            blurb="Gaps matter as much as coverage, and an absent source is invisible in any report that only lists what exists. These are the sources that would improve a forecast and the reason each one is unavailable."
          />
          <ul className="space-y-3">
            {report.missing.map((m) => (
              <li key={m.key} className="border-b border-rule/60 pb-3 last:border-0 last:pb-0">
                <p className="text-xs font-medium text-text-strong">{m.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{m.why}</p>
              </li>
            ))}
          </ul>
      </Section>

      {report.index && (
        <p className="text-[11px] leading-relaxed text-text-muted">
          Index continuity: {report.index.points.toLocaleString()} sessions from {report.index.firstDate} to{" "}
          {report.index.lastDate}, with {report.index.gaps.totalMissingWeekdays} weekdays absent across the span, the
          longest run being {report.index.gaps.longestGapWeekdays} weekdays. Those absences are market holidays and
          closures rather than missing records. Figures generated{" "}
          {new Date(report.generatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })}.
        </p>
      )}
    </div>
  );
}
