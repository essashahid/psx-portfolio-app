import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import type { OutlookCoverageReport, SeriesCoverage, SeriesQuality } from "@/lib/engine/outlook/coverage";

/**
 * Phase 1 view of the PSX Market Outlook: what data exists, how fresh it is,
 * what is missing, and how often each outcome has historically occurred.
 *
 * Everything shown is backward-looking. No forecast, probability or expected
 * range appears here, because none has been built or validated yet. The base
 * rates below describe the past five years; they are not predictions about the
 * next five, and the copy says so wherever a number could be mistaken for one.
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
  const shortHorizons = report.horizons.filter((h) => h.family === "short");
  const mediumHorizons = report.horizons.filter((h) => h.family === "medium");
  const thresholds = report.horizons[0]?.thresholds.map((t) => t.threshold) ?? [];

  return (
    <div className="space-y-6">
      {/* Stage banner. The first thing read, so it states plainly that nothing
          here forecasts anything. */}
      <Card className="rise border-l-[3px] border-l-brand">
        <CardContent className="p-4">
          <p className="eyebrow mb-1.5">Phase 1 of 6 &middot; Data foundation</p>
          <p className="text-sm leading-relaxed text-foreground">
            This tab is under construction and does not forecast anything yet. It reports what historical data the
            platform holds, how current that data is, and how often the market has actually moved in the past. No
            model has been built or tested, so no probabilities, ranges or predictions appear here.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Next step is a review of the evidence below to decide which forecast horizons the data can genuinely
            support. Modelling begins only after that decision.
          </p>
        </CardContent>
      </Card>

      <div className="rise rise-1 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <StatCard
          label="Known missing sources"
          value={String(report.missing.length)}
          sub="Listed in full below"
        />
      </div>

      {report.bindingConstraint && (
        <Card className="rise rise-2">
          <CardContent className="p-4">
            <SectionHeading
              title="What bounds the work"
              blurb={`Any model can only be trained over a period where all its inputs exist. The shortest trainable daily series is ${report.bindingConstraint.series}, starting ${report.bindingConstraint.firstDate}, which gives about ${report.bindingConstraint.years.toFixed(1)} years. Deeper history for other inputs does not extend that limit.`}
            />
          </CardContent>
        </Card>
      )}

      <Card className="rise rise-2">
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

      <Card className="rise rise-3">
        <CardContent className="p-4">
          <SectionHeading
            title="How often the market has fallen"
            blurb="Share of historical windows in which the KSE-100 dropped by at least the given amount at some point within the window, measured from the starting close. These are what actually happened over the past five years, not forecasts. The sample column is the important one: it counts non-overlapping windows, because overlapping windows reuse the same market episodes and make a thin record look far richer than it is."
          />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[40rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Window</th>
                  {thresholds.map((t) => (
                    <th key={t} className="pb-2 pr-3 text-right font-medium">
                      Fell {Math.abs(t * 100).toFixed(0)}%
                    </th>
                  ))}
                  <th className="pb-2 pr-3 text-right font-medium">Worst seen</th>
                  <th className="pb-2 text-right font-medium">Independent sample</th>
                </tr>
              </thead>
              <tbody>
                {report.horizons.map((h) => (
                  <tr key={h.key} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-foreground">{h.label}</td>
                    {h.thresholds.map((t) => (
                      <td key={t.threshold} className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {pct(t.frequency)}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {signed(h.drawdownPercentiles.worst)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{h.independentWindows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Short windows carry {shortHorizons[0]?.independentWindows ?? 0} to{" "}
            {shortHorizons[shortHorizons.length - 1]?.independentWindows ?? 0} independent observations. The three-month
            window carries only {mediumHorizons[mediumHorizons.length - 1]?.independentWindows ?? 0}, which is too few to
            judge a model on with any confidence.
          </p>
        </CardContent>
      </Card>

      <Card className="rise rise-3">
        <CardContent className="p-4">
          <SectionHeading
            title="Where the market has finished"
            blurb="Close-to-close outcomes over the same windows. The tenth and ninetieth percentiles show the spread of results rather than an average, since an average would hide how wide the range is."
          />
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[36rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Window</th>
                  <th className="pb-2 pr-3 text-right font-medium">Finished higher</th>
                  <th className="pb-2 pr-3 text-right font-medium">10th pct</th>
                  <th className="pb-2 pr-3 text-right font-medium">Median</th>
                  <th className="pb-2 text-right font-medium">90th pct</th>
                </tr>
              </thead>
              <tbody>
                {report.horizons.map((h) => (
                  <tr key={h.key} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-foreground">{h.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{pct(h.positiveRate)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {signed(h.returnPercentiles.p10)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {signed(h.returnPercentiles.median)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {signed(h.returnPercentiles.p90)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {report.volConditional.length > 0 && (
        <Card className="rise rise-4">
          <CardContent className="p-4">
            <SectionHeading
              title="Does past turbulence say anything about what follows"
              blurb="A first check on whether an early-warning signal is even present. Each row compares how often a decline followed calm periods against turbulent ones, splitting history into thirds by recent volatility. A ratio above one means turbulent periods were followed by more declines than average. This is measured over the whole sample rather than tested on unseen periods, so treat it as a reason to investigate, not as a result."
            />
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[40rem] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Window</th>
                    <th className="pb-2 pr-3 text-right font-medium">Decline</th>
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
