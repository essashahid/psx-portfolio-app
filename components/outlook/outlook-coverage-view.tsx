import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { confidenceFor, MAIN_VIEW_HORIZONS } from "@/lib/engine/outlook/presentation";
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
  if (q === "missing") return "text-red-600";
  return "text-muted-foreground";
}

const pct = (v: number, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "n/a");
const signed = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "n/a");

function SectionHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-editorial text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{blurb}</p>
    </div>
  );
}

function CoverageRow({ s }: { s: SeriesCoverage }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-2 pr-3">
        <span className="text-foreground">{s.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{s.note}</span>
      </td>
      <td className="py-2 pr-3 text-muted-foreground">{s.granularity}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{s.rows.toLocaleString()}</td>
      <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
        {s.firstDate ? `${s.firstDate} to ${s.lastDate}` : "none"}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
        {s.years > 0 ? `${s.years.toFixed(1)}y` : "n/a"}
      </td>
      <td className={`py-2 pr-3 ${qualityClass(s.quality)}`}>
        {QUALITY_LABEL[s.quality]}
        {s.quality === "stale" && s.ageDays !== null ? ` (${s.ageDays}d)` : ""}
      </td>
      <td className="py-2 text-muted-foreground">{s.modelReady ? "Yes" : "No"}</td>
    </tr>
  );
}

export function OutlookCoverageView({ report }: { report: OutlookCoverageReport }) {
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
        <Card className="rise rise-1">
          <CardContent className="p-4">
            <SectionHeading
              title="What bounds the work"
              blurb={`Any model can only be trained over a period where all its inputs exist. The shortest trainable daily series is ${report.bindingConstraint.series}, starting ${report.bindingConstraint.firstDate}, which gives about ${report.bindingConstraint.years.toFixed(1)} years. Deeper history for other inputs does not extend that limit.`}
            />
          </CardContent>
        </Card>
      )}

      <Card className="rise rise-1">
        <CardContent className="p-4">
          <SectionHeading
            title="Every horizon measured"
            blurb="Including the two the main view leaves out. The 20-session window is within a rounding error of the 21-session one, so showing both would imply a distinction that does not exist. The three-month window is excluded because its sample is too thin to judge and the turbulence signal disappears there entirely."
          />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[46rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Window</th>
                  {thresholds.map((t) => (
                    <th key={t} className="pb-2 pr-3 text-right font-medium">
                      Fell {Math.abs(t * 100).toFixed(0)}%
                    </th>
                  ))}
                  <th className="pb-2 pr-3 text-right font-medium">Higher</th>
                  <th className="pb-2 pr-3 text-right font-medium">Worst</th>
                  <th className="pb-2 pr-3 text-right font-medium">Sample</th>
                  <th className="pb-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {report.horizons.map((h) => {
                  const confidence = confidenceFor(h.independentWindows);
                  return (
                    <tr key={h.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 text-foreground">
                        {h.label}
                        {!shown.has(h.key) && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">(not shown)</span>
                        )}
                      </td>
                      {h.thresholds.map((t) => (
                        <td key={t.threshold} className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {pct(t.frequency)}
                          <span className="block text-[10px] text-muted-foreground/70">{t.hits} events</span>
                        </td>
                      ))}
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{pct(h.positiveRate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {signed(h.drawdownPercentiles.worst)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {h.independentWindows}
                      </td>
                      <td className="py-2">
                        <Badge variant={confidence.variant}>{confidence.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Sample counts non-overlapping windows. Overlapping windows reuse the same market episodes, so quoting them
            would make a five-year record look like several thousand independent observations.
          </p>
        </CardContent>
      </Card>

      {report.volConditional.length > 0 && (
        <Card className="rise rise-2">
          <CardContent className="p-4">
            <SectionHeading
              title="Turbulence signal at every horizon"
              blurb="Drawdown rates after calm and turbulent stretches, split by trailing volatility terciles. A ratio above one means turbulent periods were followed by more declines than the overall rate. Measured in-sample, so this indicates whether a model is worth building rather than proving one would work."
            />
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[40rem] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Window</th>
                    <th className="pb-2 pr-3 text-right font-medium">Drop</th>
                    <th className="pb-2 pr-3 text-right font-medium">All periods</th>
                    <th className="pb-2 pr-3 text-right font-medium">After calm</th>
                    <th className="pb-2 pr-3 text-right font-medium">After turbulence</th>
                    <th className="pb-2 text-right font-medium">Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {report.volConditional.map((v) => {
                    const h = report.horizons.find((x) => x.key === v.horizonKey);
                    const informative = Number.isFinite(v.lift) && v.lift >= 1.25;
                    return (
                      <tr key={`${v.horizonKey}-${v.threshold}`} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 text-foreground">{h?.label ?? v.horizonKey}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {Math.abs(v.threshold * 100).toFixed(0)}%
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{pct(v.baseRate)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{pct(v.lowVolRate)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{pct(v.highVolRate)}</td>
                        <td
                          className={`py-2 text-right tabular-nums ${informative ? "font-medium text-foreground" : "text-muted-foreground"}`}
                        >
                          {Number.isFinite(v.lift) ? `${v.lift.toFixed(2)}x` : "n/a"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rise rise-3">
        <CardContent className="p-4">
          <SectionHeading
            title="Data coverage"
            blurb="Every series the outlook would draw on, with its actual range and freshness. Trainable means the series has enough regular history to fit a model on. Series marked no can still describe current conditions, but cannot teach a model what past conditions led to."
          />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[52rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Series</th>
                  <th className="pb-2 pr-3 font-medium">Grain</th>
                  <th className="pb-2 pr-3 text-right font-medium">Rows</th>
                  <th className="pb-2 pr-3 font-medium">Range</th>
                  <th className="pb-2 pr-3 text-right font-medium">Span</th>
                  <th className="pb-2 pr-3 font-medium">State</th>
                  <th className="pb-2 font-medium">Trainable</th>
                </tr>
              </thead>
              <tbody>
                {report.series.map((s) => (
                  <CoverageRow key={s.key} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="rise rise-4">
        <CardContent className="p-4">
          <SectionHeading
            title="What we do not have"
            blurb="Gaps matter as much as coverage, and an absent source is invisible in any report that only lists what exists. These are the sources that would improve a forecast and the reason each one is unavailable."
          />
          <ul className="space-y-3">
            {report.missing.map((m) => (
              <li key={m.key} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                <p className="text-xs font-medium text-foreground">{m.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{m.why}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {report.index && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
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
