"use client";

import { useEffect, useMemo, useState } from "react";
import { Metric } from "@/components/ui/metric";
import { Input } from "@/components/ui/input";
import { cn, formatNumber, formatSignedPct } from "@/lib/shared/format";
import { WHAT_IF_DEFAULT_AMOUNT, WHAT_IF_PRESETS, type WhatIfResponse } from "@psx/shared/api/what-if";

/**
 * "What if I had invested": an amount and a date in, the answer out, from
 * GET /api/stocks/[ticker]/what-if. The phone reads the same route, so the
 * two surfaces cannot disagree on the arithmetic.
 */
type PresetKey = (typeof WHAT_IF_PRESETS)[number]["key"] | "custom";

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function WhatIfCalculator({ ticker }: { ticker: string }) {
  const [amountText, setAmountText] = useState(String(WHAT_IF_DEFAULT_AMOUNT));
  const [preset, setPreset] = useState<PresetKey>("3y");
  const [customDate, setCustomDate] = useState(yearsAgo(2));
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const amount = Number(amountText.replace(/[^0-9.]/g, ""));
  const from = useMemo(() => {
    if (preset === "custom") return customDate;
    const years = WHAT_IF_PRESETS.find((p) => p.key === preset)?.years ?? 3;
    return yearsAgo(years);
  }, [preset, customDate]);

  useEffect(() => {
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/stocks/${encodeURIComponent(ticker)}/what-if?amount=${amount}&from=${from}`, { signal: controller.signal });
        const body = (await res.json()) as WhatIfResponse | { error: string };
        if (!res.ok || "error" in body) {
          setError("error" in body ? body.error : "Could not work this out right now.");
          setResult(null);
        } else {
          setError(null);
          setResult(body);
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setError("Could not work this out right now.");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ticker, amount, from]);

  const reading = result
    ? `PKR ${formatNumber(result.amount, 0)} on ${longDate(result.startDate)} would be about PKR ${formatNumber(result.total, 0)} today: ` +
      `${result.priceGain >= 0 ? "up" : "down"} ${formatNumber(Math.abs(result.priceGain), 0)} on price` +
      (result.dividendCount > 0 ? ` plus ${formatNumber(result.dividends, 0)} in dividends before tax` : "") +
      `, a ${formatSignedPct(result.totalReturnPct)} return` +
      (result.annualisedPct !== null ? ` (${formatSignedPct(result.annualisedPct)} a year)` : "") +
      "."
    : null;

  return (
    <section className="grid gap-4 border-b border-rule py-6 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-8">
      <h3 className="font-display text-(length:--text-h3) font-normal tracking-editorial text-text-strong">What if I had invested?</h3>
      <div className="min-w-0">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
            Amount, PKR
            <Input inputMode="numeric" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="w-36 normal-case tracking-normal" aria-label="Amount in rupees" />
          </label>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="When">
            {WHAT_IF_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={cn(
                  "rounded-(--radius-pill) border px-3 py-1.5 text-xs transition-colors",
                  preset === p.key ? "border-text-strong bg-text-strong text-surface-page" : "border-rule text-text-muted hover:text-text-strong"
                )}
              >
                {p.label} ago
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPreset("custom")}
              className={cn(
                "rounded-(--radius-pill) border px-3 py-1.5 text-xs transition-colors",
                preset === "custom" ? "border-text-strong bg-text-strong text-surface-page" : "border-rule text-text-muted hover:text-text-strong"
              )}
            >
              A date
            </button>
            {preset === "custom" && (
              <Input
                type="date"
                value={customDate}
                min={result?.earliestDate}
                max={yearsAgo(0)}
                onChange={(e) => setCustomDate(e.target.value)}
                className="w-40"
                aria-label="Investment date"
              />
            )}
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-text-muted">{error}</p>}
        {reading && (
          <p className={cn("mt-5 max-w-(--measure) text-base leading-relaxed text-text-strong transition-opacity", loading && "opacity-60")}>{reading}</p>
        )}
        {result && (
          <div className={cn("mt-5 grid grid-cols-2 gap-y-5 sm:grid-cols-4", loading && "opacity-60")}>
            <Metric size="compact" label="Worth today" value={`PKR ${formatNumber(result.total, 0)}`} sub={`${formatNumber(result.sharesNow, 0)} shares at ${formatNumber(result.endPrice)}`} />
            <Metric size="compact" label="From price" value={`${result.priceGain >= 0 ? "+" : "−"}${formatNumber(Math.abs(result.priceGain), 0)}`} tone={result.priceGain > 0 ? "up" : result.priceGain < 0 ? "down" : undefined} sub={`bought at ${formatNumber(result.startPrice)}`} />
            <Metric size="compact" label="From dividends" value={result.dividendCount > 0 ? `+${formatNumber(result.dividends, 0)}` : "—"} sub={result.dividendCount > 0 ? `${result.dividendCount} payouts, before tax` : "none on record"} />
            <Metric
              size="compact"
              label="KSE-100, same money"
              value={result.benchmark ? `PKR ${formatNumber(result.benchmark.valueNow, 0)}` : "—"}
              sub={result.benchmark ? `${formatSignedPct(result.benchmark.returnPct)} on price alone` : "no index history"}
            />
          </div>
        )}
        {result && (
          <p className="mt-4 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
            Prices are delayed closes. Dividends are gross of withholding tax
            {result.dividendsIncomplete
              ? result.dividendsKnownFrom
                ? ` and the payout record only starts on ${longDate(result.dividendsKnownFrom)}, so earlier ones are not counted`
                : " and no payout record exists for this company, so none are counted"
              : ""}
            .{result.bonusEvents > 0 ? ` Includes ${result.bonusEvents} bonus or split event${result.bonusEvents === 1 ? "" : "s"}.` : ""} This is arithmetic on the past, not a forecast.
          </p>
        )}
      </div>
    </section>
  );
}
