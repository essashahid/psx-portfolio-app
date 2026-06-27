"use client";

import { useState } from "react";
import { Loader2, Sparkles, AlertTriangle, ArrowRight, ShieldCheck, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AllocationPie } from "@/components/charts";
import { ASSET_CLASSES, ASSET_LABEL } from "@/lib/engine/allocation/types";
import type { AssetClass } from "@/lib/engine/allocation/types";
import type { AllocationForecast, Scenario, ConfidenceLevel, MixOutcome } from "@/lib/engine/allocation";
import { cn } from "@/lib/utils";

const ASSET_COLOR: Record<AssetClass, string> = {
  equity: "#3450c8",
  gold: "#caa53d",
  btc: "#e0792b",
  cash: "#6b7280",
};

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const pkr = (n: number) => "PKR " + Math.round(n).toLocaleString("en-US");

const CONF_TONE: Record<ConfidenceLevel, string> = {
  high: "text-emerald-700 bg-emerald-500",
  moderate: "text-amber-700 bg-amber-500",
  low: "text-orange-700 bg-orange-500",
  insufficient: "text-red-700 bg-red-500",
};

export function AllocationView({ initial, savedAt }: { initial: AllocationForecast | null; savedAt: string | null }) {
  const [forecast, setForecast] = useState<AllocationForecast | null>(initial);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [saved, setSaved] = useState<string | null>(savedAt);

  async function run() {
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch("/api/allocation", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setForecast(data.forecast.payload as AllocationForecast);
      setSaved(data.forecast.created_at ?? new Date().toISOString());
      setState("idle");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  const generateBtn = (
    <Button onClick={run} disabled={state === "loading"} size="sm" className="gap-1.5">
      {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {forecast ? "Recompute" : "Generate forecast"}
    </Button>
  );

  if (!forecast) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Compass className="h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold">No forecast yet</p>
              <p className="text-xs text-muted-foreground">
                Build a probability-weighted view of where to deploy capital across asset classes.
              </p>
            </div>
          </div>
          {generateBtn}
        </div>
        {state === "error" && <p className="text-sm text-red-600">{errMsg}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {saved ? `Computed ${new Date(saved).toLocaleString("en-PK")}` : "Freshly computed"} · window{" "}
          {forecast.window.firstMonth} to {forecast.window.lastMonth} ({forecast.window.months} months)
        </p>
        {generateBtn}
      </div>
      {state === "error" && <p className="text-sm text-red-600">{errMsg}</p>}

      <ConfidenceStrip forecast={forecast} />
      {forecast.narrative?.summary && (
        <p className="rise text-sm leading-relaxed text-foreground/85">{forecast.narrative.summary}</p>
      )}

      <RecommendationHero forecast={forecast} />
      <ScenarioGrid forecast={forecast} />
      <BenchmarkComparison forecast={forecast} />
      {!forecast.recommendation.withheld && <DeploymentPanel forecast={forecast} />}

      <div className="grid gap-3 lg:grid-cols-2">
        <StressPanel forecast={forecast} />
        <SignalsPanel forecast={forecast} />
      </div>
      <BacktestPanel forecast={forecast} />
      {forecast.events.length > 0 && <EventsPanel forecast={forecast} />}
    </div>
  );
}

// --- Confidence -------------------------------------------------------------

function ConfidenceStrip({ forecast }: { forecast: AllocationForecast }) {
  const c = forecast.confidence;
  return (
    <div className="rise rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", CONF_TONE[c.overall].split(" ")[1])} />
          <span className="text-sm font-semibold">Confidence: {c.overall}</span>
          <span className="text-xs text-muted-foreground">(gated by the weakest component)</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {c.components.map((comp) => (
            <div key={comp.id} className="flex items-center gap-1.5" title={comp.detail}>
              <span className={cn("h-1.5 w-1.5 rounded-full", CONF_TONE[comp.level].split(" ")[1])} />
              <span className="text-xs text-muted-foreground">
                {comp.label}: <span className="text-foreground/80">{comp.level}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Recommendation hero ----------------------------------------------------

function RecommendationHero({ forecast }: { forecast: AllocationForecast }) {
  const r = forecast.recommendation;
  const lead = forecast.scenarios[0];

  if (r.withheld) {
    return (
      <Card className="rise border-amber-300/70 bg-amber-50/60">
        <CardContent className="flex gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-900">No single recommendation</p>
            <p className="text-sm text-amber-900/80">{r.withheldReason}</p>
            {forecast.narrative?.recommendationNote && (
              <p className="text-sm text-amber-900/70">{forecast.narrative.recommendationNote}</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  const mix = r.allocation!;
  const o = r.outcome!;
  const pieData = ASSET_CLASSES.filter((a) => mix[a] >= 0.005).map((a) => ({ name: ASSET_LABEL[a], value: mix[a] }));

  return (
    <Card className="rise">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Recommended allocation
          </CardTitle>
          <span className="text-xs text-muted-foreground">Lead scenario: {r.label}</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div>
          <AllocationPie data={pieData} />
        </div>
        <div className="space-y-3">
          <div className="rounded-md bg-muted/40 px-3 py-2">
            <p className="text-sm">
              <span className="font-semibold">{pct(lead.probability)}</span> chance of the{" "}
              <span className="font-semibold">{r.label}</span> regime.
            </p>
            <p className="text-xs text-muted-foreground">
              This is how likely the macro regime is, not how likely this allocation is to make money.
            </p>
          </div>

          <OutcomeGrid outcome={o} />

          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2">
            <ArrowRight className="h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-900">
              Deploy first into <span className="font-semibold">{ASSET_LABEL[r.deployFirst!]}</span>, where you are
              furthest below target.
            </p>
          </div>

          {forecast.narrative?.recommendationNote && (
            <p className="text-sm leading-relaxed text-foreground/80">{forecast.narrative.recommendationNote}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OutcomeGrid({ outcome }: { outcome: MixOutcome }) {
  const items = [
    { label: "Expected real return", value: `${pct(outcome.expReturn)}`, sub: `range ${pct(outcome.expReturnLow)} to ${pct(outcome.expReturnHigh)}` },
    { label: "Volatility", value: pct(outcome.volatility), sub: "annualised" },
    { label: "Est. max drawdown", value: pct(outcome.estDrawdown), sub: "over horizon" },
    { label: "Probability of loss", value: pct(outcome.probLoss), sub: "5-year real" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="rounded-md border border-border bg-card px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{it.label}</p>
          <p className="text-base font-semibold tabular-nums">{it.value}</p>
          <p className="text-[10px] text-muted-foreground">{it.sub}</p>
        </div>
      ))}
    </div>
  );
}

// --- Scenarios --------------------------------------------------------------

function ScenarioGrid({ forecast }: { forecast: AllocationForecast }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Scenarios</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {forecast.scenarios.map((s, i) => (
          <ScenarioCard key={s.regimeId} scenario={s} note={forecast.narrative?.scenarioNotes?.[s.regimeId]} idx={i} />
        ))}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, note, idx }: { scenario: Scenario; note?: string; idx: number }) {
  const s = scenario;
  return (
    <Card className={cn("rise", `rise-${Math.min(idx + 1, 6)}`)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{s.label}</p>
            <p className="text-xs text-muted-foreground">P(regime)</p>
          </div>
          <p className="text-xl font-semibold tabular-nums">{pct(s.probability)}</p>
        </div>

        <p className="text-sm leading-relaxed text-foreground/80">{note ?? s.thesis}</p>

        <WeightBar allocation={s.mix.allocation} />

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Exp <span className="font-medium text-foreground/80 tabular-nums">{pct(s.mix.expReturn)}</span> ({pct(s.mix.expReturnLow)}–{pct(s.mix.expReturnHigh)})</span>
          <span>Vol <span className="font-medium text-foreground/80 tabular-nums">{pct(s.mix.volatility)}</span></span>
          <span>Drawdown <span className="font-medium text-foreground/80 tabular-nums">{pct(s.mix.estDrawdown)}</span></span>
          <span>P(loss) <span className="font-medium text-foreground/80 tabular-nums">{pct(s.mix.probLoss)}</span></span>
        </div>

        {s.drivers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Drivers: {s.drivers.map((d) => d.label).join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WeightBar({ allocation }: { allocation: Record<AssetClass, number> }) {
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
        {ASSET_CLASSES.map((a) =>
          allocation[a] > 0 ? (
            <div key={a} style={{ width: `${allocation[a] * 100}%`, background: ASSET_COLOR[a] }} title={`${ASSET_LABEL[a]} ${pct(allocation[a])}`} />
          ) : null
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {ASSET_CLASSES.filter((a) => allocation[a] >= 0.005).map((a) => (
          <span key={a} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: ASSET_COLOR[a] }} />
            {ASSET_LABEL[a]} <span className="tabular-nums text-foreground/75">{pct(allocation[a], 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Benchmark comparison ---------------------------------------------------

function BenchmarkComparison({ forecast }: { forecast: AllocationForecast }) {
  const b = forecast.benchmarks;
  const bt = forecast.backtest.strategies;
  const findBt = (needle: string) => bt.find((s) => s.name.toLowerCase().includes(needle));
  const rows: { name: string; mix: MixOutcome | null; annReturn?: number }[] = [
    forecast.recommendation.withheld
      ? { name: "Model (regime overlay)", mix: null, annReturn: findBt("overlay")?.annReturn }
      : { name: "Recommended", mix: forecast.recommendation.outcome!, annReturn: findBt("overlay")?.annReturn },
    { name: "60-20-20 benchmark", mix: b.sixtyTwentyTwenty, annReturn: findBt("60-20-20")?.annReturn },
    { name: "Equal weight", mix: b.equalWeight, annReturn: findBt("equal")?.annReturn },
    { name: "All KSE-100", mix: b.allEquity, annReturn: findBt("kse")?.annReturn },
  ];
  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle>Versus simple benchmarks</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Strategy</th>
                <th className="pb-2 px-3 text-right font-medium">Exp. real return</th>
                <th className="pb-2 px-3 text-right font-medium">Volatility</th>
                <th className="pb-2 px-3 text-right font-medium">Est. drawdown</th>
                <th className="pb-2 pl-3 text-right font-medium">Backtest ann. return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.name} className={cn(r.name === "Recommended" && "font-semibold")}>
                  <td className="py-2 pr-3">{r.name}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.mix ? pct(r.mix.expReturn) : "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.mix ? pct(r.mix.volatility) : "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.mix ? pct(r.mix.estDrawdown) : "—"}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{r.annReturn != null ? pct(r.annReturn) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Backtest column is an out-of-sample walk-forward over {forecast.backtest.core.observations} observations.
        </p>
      </CardContent>
    </Card>
  );
}

// --- Deployment -------------------------------------------------------------

function DeploymentPanel({ forecast }: { forecast: AllocationForecast }) {
  const plan = forecast.recommendation.deployment;
  if (!plan) return null;
  const buys = plan.filter((d) => d.buyPkr > 1);
  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle>Deploying your capital</CardTitle>
      </CardHeader>
      <CardContent>
        {buys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your current mix is already close to the target. No major buys are needed.</p>
        ) : (
          <ul className="space-y-2">
            {buys.map((d) => (
              <li key={d.asset} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: ASSET_COLOR[d.asset] }} />
                  {d.label}
                  <span className="text-xs text-muted-foreground">
                    {pct(d.currentWeight, 0)} → {pct(d.targetWeight, 0)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{pkr(d.buyPkr)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// --- Collapsible detail panels ----------------------------------------------

function Disclosure({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rise rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:content-none">
        {title}
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

function StressPanel({ forecast }: { forecast: AllocationForecast }) {
  // Stress returns for the lead scenario's mix (negative = loss in the shock).
  const rec = forecast.scenarios[0].stress;
  return (
    <Disclosure title="Stress tests">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rec.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 pr-3">
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.note}</p>
              </td>
              <td className={cn("py-1.5 pl-3 text-right tabular-nums font-semibold", r.mixReturn < 0 ? "text-red-600" : "text-emerald-700")}>
                {pct(r.mixReturn)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Disclosure>
  );
}

function SignalsPanel({ forecast }: { forecast: AllocationForecast }) {
  return (
    <Disclosure title="Signals driving the regimes">
      <ul className="space-y-2.5">
        {forecast.signals.map((s) => (
          <li key={s.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{s.label}</span>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.reliability}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="relative h-1.5 flex-1 rounded-full bg-muted">
                <div
                  className={cn("absolute top-0 h-1.5 rounded-full", s.value >= 0 ? "bg-emerald-500" : "bg-red-500")}
                  style={{ left: s.value >= 0 ? "50%" : `${50 + s.value * 50}%`, width: `${Math.abs(s.value) * 50}%` }}
                />
                <div className="absolute left-1/2 top-[-2px] h-2.5 w-px bg-border" />
              </div>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function BacktestPanel({ forecast }: { forecast: AllocationForecast }) {
  const bt = forecast.backtest;
  return (
    <Disclosure title="Backtest and methodology">
      <div className="space-y-3 text-sm">
        <div className="space-y-1">
          {[bt.core, bt.fullUniverse, bt.signalOverlap].map((L) => (
            <p key={L.label} className="text-xs text-muted-foreground">
              <span className="text-foreground/80">{L.label}:</span> {L.firstMonth} to {L.lastMonth} ({L.observations} obs)
            </p>
          ))}
          <p className="text-xs text-muted-foreground">{bt.note}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-1.5 pr-3 font-medium">Strategy</th>
                <th className="pb-1.5 px-3 text-right font-medium">Ann. return</th>
                <th className="pb-1.5 px-3 text-right font-medium">Vol</th>
                <th className="pb-1.5 px-3 text-right font-medium">Max DD</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Hit rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bt.strategies.map((s) => (
                <tr key={s.name}>
                  <td className="py-1.5 pr-3">{s.name}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{pct(s.annReturn)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{pct(s.annVol)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{pct(s.maxDrawdown)}</td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">{pct(s.hitRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Risk and correlation are estimated over the longest available history; returns are real (net of CPI), using an
          assumed long-run inflation rate before {forecast.dataQuality.inflationAssumedBefore}. The regime overlay{" "}
          {bt.enhancedAddsValue ? "added" : "did not clearly add"} value out of sample ({pct(bt.enhancedVsCoreReturn)} vs the plain optimiser).
        </p>
      </div>
    </Disclosure>
  );
}

function EventsPanel({ forecast }: { forecast: AllocationForecast }) {
  return (
    <Disclosure title="Structured geopolitical events">
      <ul className="space-y-2">
        {forecast.events.map((e, i) => (
          <li key={i} className="text-sm">
            <p className="font-medium">{e.label}</p>
            <p className="text-xs text-muted-foreground">{e.detail}</p>
          </li>
        ))}
      </ul>
      {forecast.narrative?.eventsNote && (
        <p className="mt-2 text-xs text-muted-foreground">{forecast.narrative.eventsNote}</p>
      )}
    </Disclosure>
  );
}
