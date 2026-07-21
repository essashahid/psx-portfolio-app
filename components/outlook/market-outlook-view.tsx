"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Disclosure } from "@/components/outlook/outlook-primitives";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/market/sparkline";
import type { CustomerOutlook, CustomerLevel, SectorBasis, Tone } from "@/lib/engine/outlook/customer-outlook";
import type { OutlookDriver } from "@/lib/engine/outlook/drivers";
import type { WfHorizon } from "@/lib/engine/outlook/walkforward";

/**
 * The customer-facing Market Outlook.
 *
 * One page, ordered by what a reader wants first: where the market is, which
 * way it leans, what could happen over their chosen window, the levels that
 * matter, what is driving it, and which sectors are exposed. Every figure comes
 * from a validated model or a deterministic calculation; nothing that failed
 * validation appears in any form.
 */

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-emerald-700",
  neutral: "text-foreground",
  negative: "text-red-600",
};

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums tracking-editorial", tone ? TONE_TEXT[tone] : "text-foreground")}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

/** Where the current level sits inside the expected range. */
function RangeBar({ lo, hi, current }: { lo: number; hi: number; current: number }) {
  const span = hi - lo || 1;
  const position = Math.min(Math.max((current - lo) / span, 0), 1);
  return (
    <div>
      <div className="relative h-2 rounded-full bg-linear-to-r from-amber-300 via-brand-soft to-emerald-300">
        <span
          aria-hidden
          className="absolute -top-1 h-4 w-4 -translate-x-2 rounded-full border-2 border-card bg-foreground shadow-sm transition-[left] duration-(--dur-base) ease-(--ease-ui)"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{fmt(lo)}</span>
        <span className="font-medium text-foreground">Now {fmt(current)}</span>
        <span>{fmt(hi)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Lower end</span>
        <span>Upper end</span>
      </div>
    </div>
  );
}

function LevelRow({ level, kind }: { level: CustomerLevel; kind: "support" | "resistance" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="text-[11px] text-muted-foreground">
        {kind === "support" ? "Support" : "Resistance"} · {pct(Math.abs(level.distancePct), 1)} away
      </span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(level.price)}</span>
    </div>
  );
}

/**
 * Says what stands behind each sector line. A rule-based relationship must
 * never look like a model output, so the basis is always on screen.
 */
const BASIS_LABEL: Record<SectorBasis, string> = {
  validated: "Tested on history",
  contextual: "Descriptive, not a forecast",
  "rule-based": "Assumption, not yet tested",
};

const EFFECT_LABEL: Record<OutlookDriver["effect"], { text: string; dot: string; className: string }> = {
  positive: { text: "Supportive", dot: "bg-emerald-500", className: "text-emerald-700" },
  risk: { text: "Risk", dot: "bg-red-500", className: "text-red-600" },
  mixed: { text: "Mixed", dot: "bg-amber-400", className: "text-amber-700" },
};

/**
 * One driver: meaning first, then the numbers behind it, then the evidence on
 * demand. A reading that could not be computed says so rather than vanishing,
 * so a gap in the data never looks like a neutral result.
 */
function DriverRow({ driver }: { driver: OutlookDriver }) {
  const [open, setOpen] = useState(false);
  const style = EFFECT_LABEL[driver.effect];
  const panelId = `driver-${driver.key}`;

  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 text-xs font-medium text-foreground">
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
          {driver.name}
          <span className="text-[10px] font-normal text-muted-foreground">
            {driver.basis === "model" ? "Used by the model" : "Context only"}
          </span>
        </span>
        <span className={cn("text-[11px] font-medium", style.className)}>{style.text}</span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{driver.explanation}</p>

      {/* The numbers behind the label, one compact line. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {driver.metrics.map((m) => (
          <span key={m.label} className="text-[11px] text-muted-foreground">
            {m.label}:{" "}
            {m.value === null ? (
              <span className="italic text-muted-foreground/70">Data unavailable</span>
            ) : (
              <span className="font-medium tabular-nums text-foreground">{m.value}</span>
            )}
          </span>
        ))}
      </div>

      {driver.evidence.staleNote && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700">{driver.evidence.staleNote}</p>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground",
          "transition-colors duration-(--dur-fast) ease-(--ease-ui) hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-muted"
        )}
      >
        {open ? "Hide detail" : "Why this reading"}
        <ChevronDown aria-hidden className={cn("h-3 w-3 transition-transform duration-(--dur-fast) ease-(--ease-ui)", open && "rotate-180")} />
      </button>

      <div
        id={panelId}
        className="grid transition-[grid-template-rows] duration-(--dur-base) ease-(--ease-ui)"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mt-2 rounded-md border border-border bg-card p-3">
            {driver.evidence.trend && (
              <div className="mb-2">
                <Sparkline data={driver.evidence.trend} width={140} height={28} />
                <p className="mt-0.5 text-[10px] text-muted-foreground">Recent trend</p>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-foreground">{driver.evidence.whyStatus}</p>
            <dl className="mt-2 space-y-1 text-[11px]">
              {driver.evidence.previous && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Previous reading</dt>
                  <dd className="tabular-nums text-foreground">{driver.evidence.previous}</dd>
                </div>
              )}
              {driver.evidence.lastUpdated && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Last updated</dt>
                  <dd className="tabular-nums text-foreground">{driver.evidence.lastUpdated}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">Source</dt>
                <dd className="text-right text-muted-foreground">{driver.evidence.source}</dd>
              </div>
              {driver.evidence.sectorsAffected.length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">Sectors most affected</dt>
                  <dd className="text-right text-muted-foreground">{driver.evidence.sectorsAffected.join(", ")}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketOutlookView({ outlook, isAdmin = false }: { outlook: CustomerOutlook; isAdmin?: boolean }) {
  const [horizonKey, setHorizonKey] = useState<WfHorizon>(10);
  const horizon = outlook.horizons.find((h) => h.key === horizonKey) ?? outlook.horizons[0];

  return (
    <div className="space-y-4">
      {/* Where we are, and which way it leans. */}
      <div className="rise grid gap-3 sm:grid-cols-3">
        <Stat label="KSE-100" value={fmt(outlook.close)} sub={`Close, ${outlook.asOf}`} />
        <Stat label="Market outlook" value={outlook.stance.label} sub={outlook.stance.sub} tone={outlook.stance.tone} />
        <Stat label="Evidence quality" value={outlook.evidenceQuality.level} sub="How much of this has been validated" />
      </div>

      {/* The headline reconciled against the risk readings, in one sentence. */}
      <Card className="rise rise-1">
        <CardContent className="p-4">
          <p className="text-sm leading-relaxed text-foreground">{outlook.stance.explanation}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{outlook.evidenceQuality.note}</p>
        </CardContent>
      </Card>

      {/* The three outcomes, which is what a probability actually says. */}
      {outlook.scenarios && (
        <Card className="rise rise-1">
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold tracking-editorial text-foreground">
              How the next {outlook.scenarios.horizonLabel.toLowerCase()} could go
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Three possible outcomes, from the one direction model that passed validation.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {(
                [
                  { label: "Rise", value: outlook.scenarios.rise, bar: "bg-emerald-500", text: "text-emerald-700" },
                  { label: "Broadly sideways", value: outlook.scenarios.sideways, bar: "bg-muted-foreground/40", text: "text-foreground" },
                  { label: "Fall", value: outlook.scenarios.fall, bar: "bg-red-500", text: "text-red-600" },
                ] as const
              ).map((s) => (
                <div key={s.label} className="rounded-lg bg-muted p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className={cn("text-lg font-semibold tabular-nums", s.text)}>{pct(s.value)}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-card">
                    <div
                      className={cn("h-1.5 rounded-full transition-[width] duration-(--dur-base) ease-(--ease-ui)", s.bar)}
                      style={{ width: `${Math.max(s.value * 100, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* The horizon view. */}
      <Card className="rise rise-1">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-editorial text-foreground">Choose outlook period</h2>
              <p className="mt-1 text-xs text-muted-foreground">The view updates for each window.</p>
            </div>
            <SegmentedControl
              label="Outlook period"
              value={String(horizonKey)}
              onChange={(v) => setHorizonKey(Number(v) as WfHorizon)}
              className="sm:w-auto sm:min-w-[16rem]"
              options={outlook.horizons.map((h) => ({
                value: String(h.key),
                label: h.label,
                hint: h.bestSupported ? `${h.label}, the best-supported window` : `${h.label}, direction not supported`,
              }))}
            />
          </div>

          {horizon && (
            <>
              <div className="rounded-lg bg-muted p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Our current view</p>
                  {horizon.bestSupported && <Badge variant="green">Best-supported window</Badge>}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground">{horizon.view}</p>
                {horizon.directionNote && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{horizon.directionNote}</p>
                )}

                {(horizon.range || horizon.keyLevel) && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {horizon.range && (
                      <div>
                        <p className="text-xs text-muted-foreground">Estimated full movement range</p>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                          {fmt(horizon.range.loIndex)}&ndash;{fmt(horizon.range.hiIndex)}
                        </p>
                      </div>
                    )}
                    {horizon.keyLevel && (
                      <div>
                        <p className="text-xs text-muted-foreground">Key level to watch</p>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{fmt(horizon.keyLevel.price)}</p>
                      </div>
                    )}
                  </div>
                )}

                {horizon.range && (
                  <div className="mt-4">
                    <RangeBar lo={horizon.range.loIndex} hi={horizon.range.hiIndex} current={outlook.close} />
                    <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{horizon.rangeNote}</p>
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-muted p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Simple takeaway</p>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground">{horizon.takeaway}</p>
                <div className="mt-3 rounded-md border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Risk level</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground">{horizon.risk.label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{horizon.risk.note}</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Levels. */}
      <Card className="rise rise-2">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-editorial text-foreground">Key market levels</h2>
              <p className="mt-1 text-xs text-muted-foreground">Technical reference points, not guaranteed turning points.</p>
            </div>
            <Badge variant="secondary">Technicals</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Support</p>
              <div className="space-y-2">
                {outlook.levels.supports.length ? (
                  outlook.levels.supports.map((l) => <LevelRow key={l.price} level={l} kind="support" />)
                ) : (
                  <p className="text-xs text-muted-foreground">No nearby support in the current structure.</p>
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Resistance</p>
              <div className="space-y-2">
                {outlook.levels.resistances.length ? (
                  outlook.levels.resistances.map((l) => <LevelRow key={l.price} level={l} kind="resistance" />)
                ) : (
                  <p className="text-xs text-muted-foreground">No nearby resistance in the current structure.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-medium text-foreground">Above the key zone</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{outlook.levels.aboveNote}</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-medium text-foreground">Below main support</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{outlook.levels.belowNote}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drivers. */}
      <Card className="rise rise-3">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-editorial text-foreground">What is driving the outlook</h2>
              <p className="mt-1 text-xs text-muted-foreground">The local and global factors that matter right now.</p>
            </div>
            <Badge variant="secondary">Drivers</Badge>
          </div>

          <div className="space-y-2">
            {outlook.drivers.map((d) => (
              <DriverRow key={d.key} driver={d} />
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-foreground">Not included in this outlook</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{outlook.notIncluded.note}</p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {outlook.notIncluded.items.map((item) => (
                <li key={item} className="text-[11px] text-muted-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Sectors. */}
      <Card className="rise rise-4">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-editorial text-foreground">Sector outlook</h2>
              <p className="mt-1 text-xs text-muted-foreground">Industries most likely to benefit or face pressure in current conditions.</p>
            </div>
            <Badge variant="secondary">Sectors</Badge>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg bg-muted p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Potential beneficiaries
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {outlook.sectors.beneficiaries.map((s) => (
                  <div key={s.sector} className="rounded-md border border-border bg-card p-3">
                    <p className="text-xs font-medium text-foreground">{s.sector}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.reason}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{BASIS_LABEL[s.basis]}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-muted p-3">
              <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Sectors at risk
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {outlook.sectors.atRisk.map((s) => (
                  <div key={s.sector} className="rounded-md border border-border bg-card p-3">
                    <p className="text-xs font-medium text-foreground">{s.sector}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.reason}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{BASIS_LABEL[s.basis]}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{outlook.sectors.basis}</p>
        </CardContent>
      </Card>

      {/* What could change it. */}
      <Card className="rise rise-4 border-l-[3px] border-l-brand">
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold tracking-editorial text-foreground">What could change this view</h2>
          <p className="mt-2 text-xs leading-relaxed text-foreground">{outlook.whatCouldChange.strengthen}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{outlook.whatCouldChange.weaken}</p>
        </CardContent>
      </Card>

      {/* Everything technical, one level down. */}
      <Card className="rise rise-5">
        <CardContent className="space-y-3 p-4">
          <Disclosure label="Methodology and evidence" openLabel="Hide methodology and evidence">
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                This outlook is built from five years of daily market history. Each part of it was tested against
                periods the models had never seen, and only the parts that beat a simple benchmark are shown. Where a
                forecast did not clear that bar, it is left out rather than shown with false confidence.
              </p>
              <p>
                The trading ranges and dip risk come from validated statistical models. The direction lean is shown
                only for the window where it proved itself. Support and resistance are calculated from price structure
                by fixed rules; they are reference points, and testing found no evidence that such levels reliably
                hold, so they are never presented as guarantees.
              </p>
              <p>
                Sector calls use relationships that held up in historical testing over the past five years. No language
                model produces any number, level or probability anywhere in this feature.
              </p>
              {/* Internal surface: the link only appears for admins, and the
                  route guards itself independently. */}
              {isAdmin && (
                <Link
                  href="/outlook/research"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition-colors duration-(--dur-fast) ease-(--ease-ui) hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-muted"
                >
                  Full research and evaluation
                  <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </Disclosure>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        For research and information only. This is not financial advice, and no forecast removes the risk of
        unexpected events.
      </p>
    </div>
  );
}
