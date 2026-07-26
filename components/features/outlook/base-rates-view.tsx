"use client";

import { useState } from "react";
import { cn, formatNumber } from "@/lib/shared/format";
import type { OutlookBaseRates } from "@/lib/engine/outlook/base-rates";

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const signedPct = (v: number, d = 1) => `${v < 0 ? "−" : "+"}${Math.abs(v * 100).toFixed(d)}%`;

const CONFIDENCE_TONE: Record<string, string> = {
  "Limited evidence": "text-down",
  "Moderate evidence": "text-[var(--saffron-1)]",
  "Strong evidence": "text-up",
};

/**
 * The historical base-rate bands: the outcome spread at a chosen horizon, the
 * threshold ladder, and what trailing volatility did to downside risk.
 */
export function BaseRatesView({ data }: { data: OutlookBaseRates }) {
  const [key, setKey] = useState(data.horizons.at(-1)?.key ?? data.horizons[0].key);
  const h = data.horizons.find((x) => x.key === key) ?? data.horizons[0];

  // Shared scale across horizons: a longer window must visibly widen the band
  // rather than being rescaled to look the same width as a short one.
  const scale = data.bandScale * 1.05 || 1;
  const posOf = (v: number) => ((v + scale) / (2 * scale)) * 100;

  return (
    <>
      {/* ── Base rates at the chosen horizon ── */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">Historical base rates</p>
            <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
              Looking {h.phrase}
            </h2>
          </div>
          <div className="flex gap-5 pb-1">
            {data.horizons.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => setKey(x.key)}
                className={cn(
                  "whitespace-nowrap border-b-2 pb-1.5 text-sm transition-colors",
                  x.key === key
                    ? "border-indigo font-semibold text-text-strong"
                    : "border-transparent font-medium text-text-muted hover:text-text-strong"
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-7 grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              Middle 80% of outcomes {h.phrase}
            </p>

            <div className="relative mt-3.5 h-3 bg-surface-inset">
              <span
                className="absolute inset-y-0 bg-[color-mix(in_oklab,var(--sp-steel)_38%,var(--surface-page))]"
                style={{ left: `${posOf(h.band.p10)}%`, width: `${posOf(h.band.p90) - posOf(h.band.p10)}%` }}
              />
              <span className="absolute -inset-y-1 w-px bg-text-faint" style={{ left: `${posOf(0)}%` }} title="Unchanged" />
              <span
                className="absolute -inset-y-1 w-0.5 bg-ink-1"
                style={{ left: `${posOf(h.band.median)}%` }}
                title="Typical outcome"
              />
            </div>
            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="figure text-(length:--text-2xs) text-text-muted">{signedPct(h.band.p10)}</span>
              <span className="text-(length:--text-2xs) text-text-strong">
                Typically <strong className="figure font-semibold">{signedPct(h.band.median)}</strong>
              </span>
              <span className="figure text-(length:--text-2xs) text-text-muted">{signedPct(h.band.p90)}</span>
            </div>

            <p className="mt-5 max-w-(--measure) text-sm leading-relaxed text-text-muted">
              Eight windows in ten landed between {signedPct(h.band.p10)} and {signedPct(h.band.p90)}. The scale is shared
              across horizons, so a longer window visibly widens the band rather than rescaling beneath it.
            </p>

            <div className="mt-7 grid gap-6 border-t border-rule pt-6 sm:grid-cols-3">
              <Stat
                label="Chance of a 5% fall"
                value={h.fall5.rate !== null ? pct(h.fall5.rate) : "Not quoted"}
                sub={h.fall5.rate !== null ? `${h.fall5.hits} of ${h.independentWindows} windows` : "too rare to quote"}
                tone="down"
              />
              <Stat
                label="Chance of a 5% rise"
                value={h.rise5.rate !== null ? pct(h.rise5.rate) : "Not quoted"}
                sub={h.rise5.rate !== null ? `${h.rise5.hits} of ${h.independentWindows} windows` : "too rare to quote"}
                tone="up"
              />
              <Stat
                label="Ended higher"
                value={pct(h.positiveRate)}
                sub={`${h.positiveWindows} of ${h.independentWindows} windows`}
              />
            </div>
          </div>

          <div>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              Evidence behind this horizon
            </p>
            <div className="ledger mt-3.5">
              <Row label="Independent windows" value={String(h.independentWindows)} />
              <Row label="Sessions per window" value={String(h.sessions)} />
              <Row label="Worst outcome on record" value={signedPct(h.worst)} tone="down" />
              <Row label="Best outcome on record" value={signedPct(h.best)} tone="up" />
              <Row label="Confidence" value={h.confidence} className={CONFIDENCE_TONE[h.confidence]} mono={false} />
            </div>
            <p className="mt-4 text-(length:--text-2xs) leading-relaxed text-text-faint">
              Based on {h.independentWindows} separate historical periods. Overlapping windows are excluded, so this count
              is the real sample size.
            </p>
          </div>
        </div>
      </section>

      {/* ── Threshold ladder ── */}
      <section className="mt-10 border-t border-rule pt-8">
        <p className="eyebrow">Threshold ladder</p>
        <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
          How often the index moved this far
        </h2>

        <div className="mt-7">
          <div
            className="grid items-baseline gap-x-6 border-b border-rule pb-2.5"
            style={{ gridTemplateColumns: "72px minmax(0,1fr) 64px minmax(0,1fr) 72px" }}
          >
            <span />
            <span className="text-right text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-down">
              Fell at least
            </span>
            <span className="text-center text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              Move
            </span>
            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-up">
              Rose at least
            </span>
            <span />
          </div>

          {h.ladder.map((row) => {
            const max = Math.max(...h.ladder.flatMap((r) => [r.fell ?? 0, r.rose ?? 0]), 0.01);
            return (
              <div
                key={row.movePct}
                className="grid items-center gap-x-6 border-b border-rule py-3 last:border-0"
                style={{ gridTemplateColumns: "72px minmax(0,1fr) 64px minmax(0,1fr) 72px" }}
              >
                <span className="figure text-right text-sm font-semibold text-down">
                  {row.fell !== null ? pct(row.fell) : "—"}
                </span>
                <span className="flex justify-end">
                  {row.fell !== null && <span className="h-4 bg-[var(--down-1)]" style={{ width: `${(row.fell / max) * 100}%` }} />}
                </span>
                <span className="figure text-center text-sm font-semibold text-text-strong">{row.movePct}%</span>
                <span className="flex justify-start">
                  {row.rose !== null && <span className="h-4 bg-[var(--up-1)]" style={{ width: `${(row.rose / max) * 100}%` }} />}
                </span>
                <span className="figure text-sm font-semibold text-up">{row.rose !== null ? pct(row.rose) : "—"}</span>
              </div>
            );
          })}
        </div>

        <p className="mt-5 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
          A threshold is quoted only where it occurred at least five times in this history. Rows shown as not quoted
          happened too rarely for a rate to mean anything.
        </p>
      </section>

      {/* ── Conditional on volatility ── */}
      {data.volatility.length > 0 && (
        <section className="mt-10 border-t border-rule pt-8">
          <p className="eyebrow">Conditional on volatility</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
            Calm markets against turbulent ones
          </h2>

          <div className="mt-7 grid gap-10 lg:grid-cols-3">
            {data.volatility.map((v) => {
              const max = Math.max(v.calm, v.all, v.turbulent, 0.01);
              const raises = v.lift > 1;
              return (
                <div key={v.key}>
                  <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
                    A 5% fall {v.phrase}
                  </p>
                  <p className={cn("mt-2 text-(length:--text-h2) font-normal", raises ? "text-down" : "text-up")}>
                    {raises ? "Raises the risk" : "Lowers the risk"}
                  </p>

                  <div className="mt-4 space-y-3.5">
                    <VolRow label="After calm sessions" value={v.calm} max={max} colour="var(--up-1)" tone="text-up" />
                    <VolRow label="All sessions" value={v.all} max={max} colour="var(--flat-2)" tone="text-text-strong" />
                    <VolRow label="After turbulent sessions" value={v.turbulent} max={max} colour="var(--down-1)" tone="text-down" />
                  </div>

                  <p className="mt-4 text-(length:--text-2xs) leading-relaxed text-text-faint">
                    Turbulent sessions were {formatNumber(v.lift, 2)} times as likely to be followed by a 5% fall as the
                    average session.
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "up" | "down" }) {
  return (
    <div>
      <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
      <p className={cn("figure mt-2 text-(length:--text-h1) font-semibold", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text-strong")}>
        {value}
      </p>
      <p className="figure mt-1 text-(length:--text-2xs) text-text-faint">{sub}</p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  className,
  mono = true,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className="ledger-row flex items-baseline justify-between gap-4">
      <span className="text-sm text-text-strong">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold",
          mono && "figure",
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text-strong",
          className
        )}
      >
        {value}
      </span>
    </div>
  );
}

function VolRow({ label, value, max, colour, tone }: { label: string; value: number; max: number; colour: string; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-text-strong">{label}</span>
        <span className={cn("figure text-sm font-semibold", tone)}>{pct(value)}</span>
      </div>
      <span className="mt-1.5 block h-1.5 bg-surface-inset">
        <span className="block h-1.5" style={{ width: `${(value / max) * 100}%`, background: colour }} />
      </span>
    </div>
  );
}
