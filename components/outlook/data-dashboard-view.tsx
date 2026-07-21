import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { Disclosure } from "@/components/outlook/outlook-primitives";
import { SignalExplorer } from "@/components/outlook/signal-explorer";
import { HorizonExplorer, RegimeExplorer, TurbulenceExplorer } from "@/components/outlook/evidence-explorers";
import { OutlookCoverageView } from "@/components/outlook/outlook-coverage-view";
import { SignalEvidenceView } from "@/components/outlook/signal-evidence-view";
import type { DataDashboard, CoverageGroup } from "@/lib/engine/outlook/data-dashboard";
import type { OutlookCoverageReport } from "@/lib/engine/outlook/coverage";
import type { SignalEvidenceReport } from "@/lib/engine/outlook/evaluate";

/**
 * The outlook research dashboard.
 *
 * Ordered so the conclusions come first and the workings come last: what was
 * found, which candidates survived, what the market has actually done, what
 * data stands behind it, and only then the full tables and the method. A
 * reader should be able to stop after the first screen and still have the
 * Phase 1 and Phase 2 conclusions.
 */

const TIER_STYLE: Record<CoverageGroup["tier"], { variant: "green" | "amber" | "outline"; badge: string }> = {
  ready: { variant: "green", badge: "Ready" },
  limited: { variant: "amber", badge: "Limited" },
  absent: { variant: "outline", badge: "Missing" },
};

function SectionCard({
  title,
  blurb,
  children,
  className,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold tracking-editorial text-foreground">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{blurb}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function CoverageTierBlock({ group }: { group: CoverageGroup }) {
  const style = TIER_STYLE[group.tier];
  const count = group.series.length + group.missing.length;

  return (
    <div className="border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={style.variant}>{style.badge}</Badge>
        <span className="text-xs font-medium text-foreground">{group.title}</span>
        <span className="text-[11px] text-muted-foreground">{count}</span>
      </div>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">{group.blurb}</p>
      <ul className="mt-2 space-y-1">
        {group.series.map((s) => (
          <li key={s.key} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
            <span className="text-foreground">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {s.years > 0 ? `${s.years.toFixed(1)}y` : "no history"}
              {s.quality === "stale" && s.ageDays !== null ? ` · ${s.ageDays}d stale` : ""}
            </span>
          </li>
        ))}
        {group.missing.map((m) => (
          <li key={m.key} className="text-[11px] text-muted-foreground">
            {m.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DataDashboardView({
  dashboard,
  coverage,
  evidence,
}: {
  dashboard: DataDashboard;
  coverage: OutlookCoverageReport;
  evidence: SignalEvidenceReport;
}) {
  const { summary } = dashboard;
  const strongRows = dashboard.signals.filter((s) => s.verdict === "strong");
  const moderateRows = dashboard.signals.filter((s) => s.verdict === "moderate");
  const failedCounts = (["redundant", "unstable", "weak", "insufficient"] as const).map((v) => ({
    verdict: v,
    count: dashboard.signals.filter((s) => s.verdict === v).length,
  }));

  return (
    <div className="space-y-4">
      {/* Conclusion first. */}
      <Card className="rise border-l-[3px] border-l-brand">
        <CardContent className="p-4">
          <p className="eyebrow mb-1.5">Phase 2 &middot; Signal research complete</p>
          <p className="text-sm leading-relaxed text-foreground">{summary.readiness.headline}.</p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">{summary.readiness.detail}</p>
        </CardContent>
      </Card>

      <div className="rise rise-1 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Signals tested" value={String(summary.signalsTested)} sub="Across seven families" />
        <StatCard
          label="Carried forward"
          value={String(summary.carriedForward)}
          sub={`${summary.strong} strong, ${summary.moderate} moderate`}
          tone="positive"
        />
        <StatCard label="Did not survive" value={String(summary.notCarried)} sub="Redundant, unstable, weak or insufficient" />
        <StatCard
          label="Evidence window"
          value={`${summary.evidenceWindow.sessions.toLocaleString()}`}
          sub={`Sessions, ${summary.evidenceWindow.firstDate} to ${summary.evidenceWindow.lastDate}`}
        />
      </div>

      {summary.primarySignal && (
        <Card className="rise rise-1">
          <CardContent className="p-4">
            <p className="eyebrow mb-1.5">Primary signal</p>
            <p className="text-sm font-semibold text-foreground">{summary.primarySignal.label}</p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{summary.primarySignal.detail}</p>
          </CardContent>
        </Card>
      )}

      {/* Verdict groups, before any table. */}
      <SectionCard
        className="rise rise-2"
        title="What survived, and what did not"
        blurb="Every candidate was judged on distinct market episodes rather than overlapping windows, re-measured inside calm markets to see whether it added anything beyond volatility, and recomputed on each half of the sample to see whether it held."
      >
        <div className="space-y-3">
          {[
            { rows: strongRows, variant: "green" as const, label: "Strong", note: "Clears the lift, episode, stability and beyond-volatility bars." },
            { rows: moderateRows, variant: "blue" as const, label: "Moderate", note: "Direction holds in both halves with real but smaller lift." },
          ].map((group) =>
            group.rows.length === 0 ? null : (
              <div key={group.label} className="rounded-lg bg-muted p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={group.variant}>{group.label}</Badge>
                  <span className="text-[11px] text-muted-foreground">{group.note}</span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {group.rows.map((r) => (
                    <li key={r.key} className="text-xs">
                      <span className="text-foreground">{r.label}</span>
                      {r.defining && (
                        <span className="ml-2 tabular-nums text-muted-foreground">
                          {r.defining.lift !== null && Number.isFinite(r.defining.lift)
                            ? `${r.defining.lift.toFixed(2)}x`
                            : "n/a"}{" "}
                          on {r.defining.hitEpisodes} episodes
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}

          <div className="rounded-lg bg-muted p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Not carried forward</Badge>
              <span className="text-[11px] text-muted-foreground">{summary.notCarried} signals</span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {failedCounts.map((f) => (
                <li key={f.verdict}>
                  <span className="tabular-nums text-foreground">{f.count}</span> {f.verdict}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Redundant means the lift vanished once volatility was accounted for. Unstable means it inverted between
              halves. Insufficient means too few distinct episodes to judge at all.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        className="rise rise-2"
        title="Signal explorer"
        blurb="Each signal with the cell its verdict rests on. Open one to see every horizon and depth it was tested at, including the stability and beyond-volatility checks."
      >
        <SignalExplorer signals={dashboard.signals} />
      </SectionCard>

      {/* Descriptive market behaviour, one result at a time. */}
      <SectionCard
        className="rise rise-3"
        title="How the market has behaved"
        blurb="Historical base rates over the past five years of the KSE-100. These describe what happened; they are not forecasts."
      >
        <HorizonExplorer horizons={dashboard.horizons} />
      </SectionCard>

      <SectionCard
        className="rise rise-3"
        title="Market states"
        blurb="Trend against the 200-day average crossed with the volatility tercile. Pick a state and a window to see how often falls followed it."
      >
        <RegimeExplorer regimes={dashboard.regimes} horizonKeys={dashboard.regimeHorizons} thresholds={dashboard.thresholds} />
      </SectionCard>

      <SectionCard
        className="rise rise-3"
        title="Does turbulence carry information"
        blurb="Drawdown rates after calm and turbulent stretches, split by how much the market had recently been moving. This is the comparison the primary signal rests on."
      >
        <TurbulenceExplorer rows={dashboard.turbulence} />
      </SectionCard>

      {/* Data foundation, grouped. */}
      <SectionCard
        className="rise rise-4"
        title="Data behind all of this"
        blurb="Grouped by what each series can actually be used for. Series that are current but hand-maintained sit in the middle tier, because a stale entry there is a maintenance task rather than a missing source."
      >
        <div>
          {dashboard.coverage.map((group) => (
            <CoverageTierBlock key={group.tier} group={group} />
          ))}
        </div>
      </SectionCard>

      {/* Everything technical, collapsed. */}
      <Card className="rise rise-4">
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold tracking-editorial text-foreground">Technical detail</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              The full tables, the rules the evidence was produced under, and the research notes behind the conclusions
              above.
            </p>
          </div>

          <Disclosure label="Method and leakage rules" openLabel="Hide method and leakage rules">
            <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
              {dashboard.method.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Leakage is guarded in two places and tested: signal values are checked for prefix consistency, meaning
              computing a signal on a truncated history reproduces the full-history values exactly for every date inside
              the truncation, and states come from expanding percentiles so a date is only ever ranked against its own
              past.
            </p>
          </Disclosure>

          <Disclosure label="Full signal evidence tables" openLabel="Hide full signal evidence tables">
            <SignalEvidenceView report={evidence} bare />
          </Disclosure>

          <Disclosure label="Full data coverage and gap analysis" openLabel="Hide full data coverage and gap analysis">
            <OutlookCoverageView report={coverage} bare />
          </Disclosure>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Nothing on this page is a forecast. Every figure is a historical base rate or a descriptive statistic, measured
        in-sample. No model has been fitted or selected. Generated{" "}
        {new Date(dashboard.generatedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })}.
      </p>
    </div>
  );
}
