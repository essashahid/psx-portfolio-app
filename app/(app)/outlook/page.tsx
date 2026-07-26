import { MarketOutlookView } from "@/components/features/outlook/market-outlook-view";
import { BaseRatesView } from "@/components/features/outlook/base-rates-view";
import { getMarketOutlook } from "@/lib/engine/outlook/read";
import { getOutlookBaseRates } from "@/lib/engine/outlook/base-rates";
import { getAdminContext } from "@/lib/admin/guard";
import { Band } from "@/components/ui/band";
import { cn, formatNumber } from "@/lib/shared/format";
import { AsOf } from "@/components/shared/as-of";

export const dynamic = "force-dynamic";

const GUTTER = "px-3 sm:px-4 md:px-(--gutter-page)";

const STANCE_TONE: Record<string, string> = {
  positive: "text-up",
  negative: "text-down",
  neutral: "text-text-strong",
};

/**
 * PSX Market Outlook.
 *
 * Reads the cached outlook: the underlying data is end-of-day and identical
 * for every user, so it is assembled once per hour rather than on each load.
 * The admin flag only decides whether the internal research link is offered;
 * that route guards itself as well.
 */
export default async function OutlookPage() {
  const [outlook, { isAdmin }, baseRates] = await Promise.all([
    getMarketOutlook(),
    getAdminContext(),
    getOutlookBaseRates().catch(() => null),
  ]);
  const stanceTone = STANCE_TONE[String(outlook.stance.tone)] ?? "text-text-strong";

  return (
    <div className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
      {/* ── Hero ── */}
      <Band
        tone="paper"
        className={GUTTER}
        style={{ background: "color-mix(in oklab, var(--sp-steel) 13%, var(--surface-page))" }}
      >
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-(--sp-steel)" />
            <p className="eyebrow">PSX Market Outlook</p>
            <h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">
              What may happen next
            </h1>
            <div className="mt-5 flex items-end gap-5">
              <span>
                <span className="block text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">KSE-100 at close</span>
                <span className="figure mt-1.5 block text-(length:--text-display) font-semibold leading-none tracking-editorial text-text-strong">
                  {formatNumber(outlook.close, 0)}
                </span>
              </span>
              <span className="pb-1.5">
                <span className={cn("block text-(length:--text-h2) font-semibold", stanceTone)}>{outlook.stance.label}</span>
                <span className="mt-0.5 block text-sm text-text-muted">{outlook.stance.sub}</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 pb-1 text-right">
            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Evidence quality</span>
            <span className="text-(length:--text-h2) font-semibold text-text-strong">{outlook.evidenceQuality.level}</span>
            <span className="figure text-(length:--text-2xs) text-text-faint">Close, {outlook.asOf}</span>
          </div>
        </div>

        <p className="mt-7 max-w-(--measure) border-t border-rule pt-6 text-(length:--text-h3) leading-relaxed text-text-muted">
          {outlook.stance.explanation}
        </p>
        <p className="mt-3 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
          {outlook.evidenceQuality.note}
        </p>
        {baseRates && (
          <p className="mt-2 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
            {formatNumber(baseRates.sample.sessions, 0)} trading sessions from {monthYear(baseRates.sample.firstSession)} to{" "}
            {monthYear(baseRates.sample.lastSession)}, with no gap longer than {baseRates.sample.longestGapSessions} sessions.
            Every rate below counts non-overlapping windows only.
          </p>
        )}

        {outlook.staleWarning && (
          <p className="mt-6 border-l-[3px] border-[var(--saffron-2)] pl-4 text-xs leading-relaxed text-text-muted">
            <strong className="font-semibold text-[var(--saffron-1)]">Data may be out of date.</strong> {outlook.staleWarning}
          </p>
        )}
      </Band>

      {/* ── Historical base rates, the ladder and the volatility split ── */}
      {baseRates && (
        <Band tone="paper" className={cn("dot-grid", GUTTER)}>
          <BaseRatesView data={baseRates} />
        </Band>
      )}

      {/* ── The model's own panels ── */}
      <Band tone="paper" className={GUTTER}>
        <MarketOutlookView outlook={outlook} isAdmin={isAdmin} />
      </Band>

      {/* ── How this is built ── */}
      <Band tone="paper" rule="none" className={GUTTER}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="eyebrow">How this is built</p>
            <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
              What the model can and cannot say
            </h2>
            <p className="mt-5 max-w-(--measure) text-sm leading-relaxed text-text-muted">
              These are historical base rates for the KSE-100, not a forecast of this particular week. Every figure counts
              non-overlapping windows, so the same market episode is never reused to make a sample look larger than it is.
            </p>
            {baseRates && (
              <div className="mt-7 grid grid-cols-3 gap-6 border-t border-rule pt-6">
                <Fact label="Sessions" value={formatNumber(baseRates.sample.sessions, 0)} />
                <Fact label="Years of history" value={formatNumber(baseRates.sample.years, 1)} />
                <Fact label="First session" value={monthYear(baseRates.sample.firstSession)} />
              </div>
            )}
          </div>

          <div>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              Deliberately excluded
            </p>
            <div className="ledger mt-3.5">
              {outlook.notIncluded.items.map((item) => (
                <div key={item} className="ledger-row">
                  <p className="text-sm leading-relaxed text-text-muted">{item}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-(length:--text-2xs) leading-relaxed text-text-faint">{outlook.notIncluded.note}</p>
          </div>
        </div>

        <div className="mt-9 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-5">
          <AsOf date={outlook.asOf} label="Last updated" />
          <span className="text-(length:--text-2xs) text-text-faint">
            Historical frequencies, not predictions. Research support only, not financial advice.
          </span>
        </div>
      </Band>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
      <p className="figure mt-2 text-(length:--text-h1) font-semibold text-text-strong">{value}</p>
    </div>
  );
}

/** "Jan 2009" from an ISO date. */
function monthYear(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
