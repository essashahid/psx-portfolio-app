import type { AlignedInputs } from "@/lib/engine/outlook/inputs";
import type { ForecastDataset } from "@/lib/engine/outlook/walkforward";
import { latestCpiMonth } from "@/lib/market-data/pbs-cpi";

/**
 * Driver readings for the Market Outlook.
 *
 * Each driver carries three layers: the plain-language meaning, a compact line
 * of real current numbers, and detailed evidence hidden until asked for. The
 * classification itself is not decided here — it mirrors the Phase 3 logic
 * unchanged, and this module only explains it.
 *
 * Rules that hold throughout:
 *  - Every value is read from the platform's own series. Nothing is invented,
 *    and a reading that cannot be computed says so rather than disappearing.
 *  - Publication lags are already applied upstream by the loader, so the values
 *    here are what was genuinely knowable at the latest session.
 *  - Manually maintained series (CPI, the policy-rate path) carry their own
 *    freshness, because they go stale silently.
 */

export type DriverBasis = "model" | "context";
export type DriverEffect = "positive" | "risk" | "mixed";

export interface DriverMetric {
  label: string;
  /** Formatted for display, or null when the value could not be computed. */
  value: string | null;
}

export interface DriverEvidence {
  /** Same reading one period earlier, for context on the current one. */
  previous: string | null;
  source: string;
  /** Date or month of the latest observation behind this driver. */
  lastUpdated: string | null;
  /** Set when a manually maintained series has fallen behind. */
  staleNote: string | null;
  /** Where the current reading sits in its own history, 0-1. */
  percentile: number | null;
  whyStatus: string;
  /** Sectors whose response to this factor cleared historical validation. */
  sectorsAffected: string[];
  /** Recent values for the inline trend, oldest first. */
  trend: number[] | null;
}

export interface OutlookDriver {
  key: string;
  name: string;
  basis: DriverBasis;
  effect: DriverEffect;
  explanation: string;
  metrics: DriverMetric[];
  evidence: DriverEvidence;
}

export interface SectorFactorRow {
  factor: string;
  spread: number;
  validated: boolean;
}
export interface SectorLookupRow {
  sector: string;
  members: number;
  factors: SectorFactorRow[];
}

const UNAVAILABLE = null;
const TREND_POINTS = 60;

// --- Series helpers -------------------------------------------------------------

function present(series: (number | null)[]): number[] {
  return series.filter((v): v is number => v !== null);
}

function latestOf(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null) return series[i];
  return null;
}

/** The value `back` observations before the latest one. */
function priorOf(series: (number | null)[], back: number): number | null {
  const vals = present(series);
  return vals.length > back ? vals[vals.length - 1 - back] : null;
}

function percentileOf(series: (number | null)[]): number | null {
  const vals = present(series);
  if (vals.length < 60) return null;
  const current = vals[vals.length - 1];
  const past = vals.slice(0, -1);
  return past.filter((v) => v <= current).length / past.length;
}

function changeOver(series: (number | null)[], back: number): number | null {
  const vals = present(series);
  if (vals.length <= back) return null;
  const now = vals[vals.length - 1];
  const then = vals[vals.length - 1 - back];
  return then > 0 ? now / then - 1 : null;
}

function trendOf(series: (number | null)[], points = TREND_POINTS): number[] | null {
  const vals = present(series);
  return vals.length >= 10 ? vals.slice(-points) : null;
}

/** Sum of the last `n` available observations, when enough of them exist. */
function trailingSum(series: (number | null)[], n: number, minPresent: number): number | null {
  const slice = series.slice(-n).filter((v): v is number => v !== null);
  return slice.length >= minPresent ? slice.reduce((a, b) => a + b, 0) : null;
}

/** Latest date on which a series actually had a value. */
function lastDateWithValue(dates: string[], series: (number | null)[]): string | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null) return dates[i];
  return null;
}

// --- Formatting -----------------------------------------------------------------

const pct1 = (v: number | null) => (v === null || !Number.isFinite(v) ? UNAVAILABLE : `${(v * 100).toFixed(1)}%`);
const pctSigned = (v: number | null) => (v === null || !Number.isFinite(v) ? UNAVAILABLE : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const num2 = (v: number | null) => (v === null || !Number.isFinite(v) ? UNAVAILABLE : v.toFixed(2));
const ordinal = (p: number | null) => {
  if (p === null || !Number.isFinite(p)) return UNAVAILABLE;
  const n = Math.round(p * 100);
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
};

// --- Sector lookup ---------------------------------------------------------------

/** Sectors whose response to a factor cleared validation, worst-hit first. */
function sectorsFor(sectors: SectorLookupRow[], factor: string, limit = 4): string[] {
  return sectors
    .map((s) => ({ sector: s.sector, f: s.factors.find((x) => x.factor === factor) }))
    .filter((x) => x.f?.validated)
    .sort((a, b) => Math.abs(b.f!.spread) - Math.abs(a.f!.spread))
    .slice(0, limit)
    .map((x) => x.sector);
}

// --- The drivers ------------------------------------------------------------------

export function buildDrivers(
  inputs: AlignedInputs,
  dataset: ForecastDataset,
  sectors: SectorLookupRow[],
  asOf = new Date()
): OutlookDriver[] {
  const dates = dataset.dates;
  const lastDate = dates[dates.length - 1] ?? null;

  // --- Participation (model input) ---
  const advNow = latestOf(inputs.breadth.advanceShare);
  const adv10 = latestOf(dataset.adv10);
  const advPct = percentileOf(dataset.adv10);
  const advPrev = priorOf(dataset.adv10, 10);

  // --- Volatility (model input) ---
  const volNow = latestOf(dataset.vol21);
  const volPct = percentileOf(dataset.vol21);
  const volPrev = priorOf(dataset.vol21, 21);
  const volChange = volNow !== null && volPrev !== null && volPrev > 0 ? volNow - volPrev : null;

  // --- Up-volume (model input) ---
  const upNow = latestOf(inputs.breadth.upVolumeShare);
  const up10 = latestOf(dataset.upvol10);
  const upPct = percentileOf(dataset.upvol10);
  const upPrev = priorOf(dataset.upvol10, 10);

  // --- Currency, oil, gold, global (context) ---
  const pkrNow = latestOf(inputs.usdPkr);
  const pkr21 = changeOver(inputs.usdPkr, 21);
  const pkr63 = changeOver(inputs.usdPkr, 63);
  const brentNow = latestOf(inputs.brent);
  const brent21 = changeOver(inputs.brent, 21);
  const brent63 = changeOver(inputs.brent, 63);
  const goldNow = latestOf(inputs.goldUsd);
  const gold63 = changeOver(inputs.goldUsd, 63);
  const spy63 = changeOver(inputs.spy, 63);
  const eem63 = changeOver(inputs.eem, 63);

  // --- Rates and inflation (context, manually maintained) ---
  const policy = latestOf(inputs.policyRate.map((v) => v));
  const cpi = latestOf(inputs.cpiYoY);
  const realRate = policy !== null && cpi !== null ? policy - cpi : null;
  // CPI is published about a month in arrears, so by late July the June figure
  // should exist. Measuring staleness in months behind that expectation catches
  // a missed release; a raw day count does not, because a normal one-month lag
  // already looks like ~50 days old.
  const cpiMonth = latestCpiMonth();
  const expectedMonthDate = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  const expectedMonth = `${expectedMonthDate.getUTCFullYear()}-${String(expectedMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthsBehind = (() => {
    const [ey, em] = expectedMonth.split("-").map(Number);
    const [cy, cm] = cpiMonth.split("-").map(Number);
    return (ey - cy) * 12 + (em - cm);
  })();
  const cpiStale = monthsBehind >= 1;

  // --- Flows (context) ---
  const fipi5 = trailingSum(inputs.fipiNet, 5, 3);
  const fipi20 = trailingSum(inputs.fipiNet, 20, 12);
  const fipiDate = lastDateWithValue(dates, inputs.fipiNet);

  const money = (v: number | null) => (v === null || !Number.isFinite(v) ? UNAVAILABLE : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(1)}m`);

  const drivers: OutlookDriver[] = [
    {
      key: "participation",
      name: "Market participation",
      basis: "model",
      effect: advPct === null ? "mixed" : advPct >= 0.55 ? "positive" : advPct <= 0.35 ? "risk" : "mixed",
      explanation:
        advPct === null
          ? "Participation data is still building."
          : advPct >= 0.55
            ? "A healthy share of stocks is taking part in the move, which has historically supported gains."
            : advPct <= 0.35
              ? "Fewer stocks are participating than usual, which has historically preceded weaker stretches."
              : "Participation is around its typical level.",
      metrics: [
        { label: "Latest session", value: pct1(advNow) },
        { label: "10-session average", value: pct1(adv10) },
        { label: "Percentile", value: ordinal(advPct) },
      ],
      evidence: {
        previous: adv10 !== null && advPrev !== null ? `${pct1(advPrev)} ten sessions ago` : null,
        source: "Reconstructed from every listed company's daily close",
        lastUpdated: lastDateWithValue(dates, inputs.breadth.advanceShare),
        staleNote: null,
        percentile: advPct,
        whyStatus:
          advPct === null
            ? "Not enough history yet to place the current reading."
            : `The 10-session average sits at the ${ordinal(advPct)} percentile of its own history. Below the 35th we treat participation as a risk, above the 55th as supportive.`,
        sectorsAffected: sectorsFor(sectors, "breadth-weak"),
        trend: trendOf(dataset.adv10),
      },
    },
    {
      key: "volatility",
      name: "Market volatility",
      basis: "model",
      effect: volPct === null ? "mixed" : volPct >= 2 / 3 ? "risk" : volPct <= 1 / 3 ? "positive" : "mixed",
      explanation:
        volPct === null
          ? "Volatility reading unavailable."
          : volPct >= 2 / 3
            ? "Recent swings are larger than usual, which raises the chance of a sharp dip. This is the most reliable warning signal we found."
            : volPct <= 1 / 3
              ? "The market has been unusually calm, which has historically meant a lower chance of a sharp dip."
              : "Swings are around their typical size.",
      metrics: [
        { label: "21-session volatility", value: pct1(volNow) },
        { label: "Percentile", value: ordinal(volPct) },
        { label: "Change vs a month ago", value: volChange === null ? UNAVAILABLE : `${volChange >= 0 ? "+" : ""}${(volChange * 100).toFixed(1)}pp` },
      ],
      evidence: {
        previous: volPrev !== null ? `${pct1(volPrev)} a month ago` : null,
        source: "KSE-100 daily closes",
        lastUpdated: lastDate,
        staleNote: null,
        percentile: volPct,
        whyStatus:
          volPct === null
            ? "Not enough history yet to place the current reading."
            : `Volatility sits at the ${ordinal(volPct)} percentile of its own history. The top third is treated as a risk because that is where drawdowns historically clustered.`,
        sectorsAffected: sectorsFor(sectors, "market-down"),
        trend: trendOf(dataset.vol21),
      },
    },
    {
      key: "volume",
      name: "Trading volume behind the move",
      basis: "model",
      effect: upPct === null ? "mixed" : upPct >= 0.55 ? "positive" : upPct <= 0.35 ? "risk" : "mixed",
      explanation:
        upPct === null
          ? "Volume split unavailable."
          : upPct >= 0.55
            ? "More volume is going through rising stocks than falling ones."
            : upPct <= 0.35
              ? "Volume is concentrated in falling stocks."
              : "Volume is evenly split between rising and falling stocks.",
      metrics: [
        { label: "Latest session", value: pct1(upNow) },
        { label: "10-session average", value: pct1(up10) },
        {
          label: "Trend",
          value: up10 === null || upPrev === null ? UNAVAILABLE : up10 > upPrev ? "Improving" : up10 < upPrev ? "Weakening" : "Flat",
        },
      ],
      evidence: {
        previous: upPrev !== null ? `${pct1(upPrev)} ten sessions ago` : null,
        source: "Volume of rising versus falling stocks, from constituent data",
        lastUpdated: lastDateWithValue(dates, inputs.breadth.upVolumeShare),
        staleNote: null,
        percentile: upPct,
        whyStatus:
          upPct === null
            ? "Not enough history yet to place the current reading."
            : `The 10-session average sits at the ${ordinal(upPct)} percentile of its own history, which we read as ${upPct >= 0.55 ? "supportive" : upPct <= 0.35 ? "a risk" : "neutral"}.`,
        sectorsAffected: sectorsFor(sectors, "breadth-weak"),
        trend: trendOf(dataset.upvol10),
      },
    },
    {
      key: "pkr",
      name: "Rupee against the dollar",
      basis: "context",
      effect: pkr63 === null ? "mixed" : pkr63 > 0.02 ? "risk" : pkr63 < -0.01 ? "positive" : "mixed",
      explanation:
        pkr63 === null
          ? "Currency data unavailable."
          : pkr63 > 0.01
            ? "The rupee has weakened over recent months, which raises import costs and inflation."
            : pkr63 < -0.01
              ? "The rupee has strengthened over recent months, easing import-cost pressure."
              : "The rupee has been broadly stable, offering no strong push either way.",
      metrics: [
        { label: "USD/PKR", value: num2(pkrNow) },
        { label: "1 month", value: pctSigned(pkr21) },
        { label: "3 months", value: pctSigned(pkr63) },
      ],
      evidence: {
        previous: null,
        source: "Twelve Data daily rate, lagged one session",
        lastUpdated: lastDateWithValue(dates, inputs.usdPkr),
        staleNote: null,
        percentile: null,
        whyStatus:
          "Currency moves feed inflation and import costs, but Phase 2 found no reliable link to short-horizon index moves, so this is background rather than a model input.",
        sectorsAffected: sectorsFor(sectors, "pkr-weak"),
        trend: trendOf(inputs.usdPkr),
      },
    },
    {
      key: "brent",
      name: "Brent crude oil",
      basis: "context",
      effect: brent63 === null ? "mixed" : brent63 > 0.05 ? "risk" : brent63 < -0.05 ? "positive" : "mixed",
      // The one-month and three-month moves can point different ways. Describing
      // only the three-month view would have called a 13% monthly jump "flat",
      // which contradicts the figures shown right beside it.
      explanation: (() => {
        if (brent63 === null) return "Oil data unavailable.";
        const recentJump = brent21 !== null && Math.abs(brent21) > 0.08 && Math.abs(brent21) > Math.abs(brent63) * 1.5;
        if (recentJump) {
          return `Oil has moved sharply in the past month (${brent21! > 0 ? "up" : "down"} ${(Math.abs(brent21!) * 100).toFixed(1)}%) though it is little changed over three. Pakistan imports its energy, so a sustained rise pressures the import bill, inflation and the rupee.`;
        }
        if (brent63 > 0.05) return "Oil has risen over recent months. Pakistan imports its energy, so this pressures the import bill, inflation and the rupee.";
        if (brent63 < -0.05) return "Oil has fallen over recent months, easing pressure on the import bill and inflation.";
        return "Oil has been broadly flat, offering no strong push either way.";
      })(),
      metrics: [
        { label: "BNO proxy", value: num2(brentNow) },
        { label: "1 month", value: pctSigned(brent21) },
        { label: "3 months", value: pctSigned(brent63) },
      ],
      evidence: {
        previous: null,
        source: "BNO, a Brent-tracking ETF used as a proxy because spot Brent is not available on our data plan. Lagged one session.",
        lastUpdated: lastDateWithValue(dates, inputs.brent),
        staleNote: null,
        percentile: null,
        whyStatus:
          "Oil is an import-cost channel for Pakistan. Only two sectors showed a validated response to oil moves, so it stays contextual.",
        sectorsAffected: sectorsFor(sectors, "oil-up"),
        trend: trendOf(inputs.brent),
      },
    },
    {
      key: "rates",
      name: "Interest rates and inflation",
      basis: "context",
      effect: realRate !== null && realRate > 3 ? "positive" : "mixed",
      explanation:
        policy === null
          ? "Policy rate unavailable."
          : realRate !== null && realRate > 3
            ? "Real rates are clearly positive, which supports the rupee but keeps borrowing costs high."
            : realRate !== null && realRate < 0
              ? "Inflation is running at or above the policy rate, so real rates are slightly negative."
              : "Rate and inflation conditions are mixed for equities.",
      metrics: [
        { label: "Policy rate", value: policy === null ? UNAVAILABLE : `${policy.toFixed(1)}%` },
        { label: "Inflation", value: cpi === null ? UNAVAILABLE : `${cpi.toFixed(1)}%` },
        { label: "Real rate", value: realRate === null ? UNAVAILABLE : `${realRate >= 0 ? "+" : ""}${realRate.toFixed(1)}%` },
      ],
      evidence: {
        previous: null,
        source: "SBP policy decisions and PBS National CPI, both maintained by hand in the codebase",
        lastUpdated: cpiMonth,
        staleNote: cpiStale
          ? `The latest inflation figure we hold is for ${cpiMonth}, which is ${monthsBehind === 1 ? "a month" : `${monthsBehind} months`} behind what should be published by now. Treat the inflation and real-rate figures as indicative until it is updated.`
          : null,
        percentile: null,
        whyStatus:
          "Rates and inflation shape the backdrop, but no rate-related signal passed validation against short-horizon index moves, so this does not feed the forecast.",
        sectorsAffected: sectorsFor(sectors, "rate-hike"),
        trend: trendOf(inputs.policyRate.map((v) => v)),
      },
    },
    {
      key: "flows",
      name: "Foreign investor flows",
      basis: "context",
      effect: fipi20 === null ? "mixed" : fipi20 > 0 ? "positive" : "risk",
      explanation:
        fipi20 === null
          ? "Flow data unavailable for the recent period."
          : `Foreign investors have been net ${fipi20 > 0 ? "buyers" : "sellers"} over the past month. Testing found flows move with the market rather than ahead of it, so we treat this as background.`,
      metrics: [
        { label: "5 sessions", value: money(fipi5) },
        { label: "20 sessions", value: money(fipi20) },
        { label: "Unit", value: "USD millions" },
      ],
      evidence: {
        previous: null,
        source: "NCCPL figures published via SCSTrade, lagged one session",
        lastUpdated: fipiDate,
        staleNote: null,
        percentile: null,
        whyStatus:
          "Phase 2 classified flows as redundant once volatility was accounted for: the apparent signal disappeared inside calm markets. They are shown for context only.",
        sectorsAffected: [],
        trend: trendOf(inputs.fipiNet),
      },
    },
    {
      key: "global",
      name: "Global markets",
      basis: "context",
      effect: spy63 === null ? "mixed" : spy63 > 0.02 && (eem63 ?? 0) > 0 ? "positive" : spy63 < -0.03 ? "risk" : "mixed",
      explanation:
        spy63 === null
          ? "Global market data unavailable."
          : spy63 < -0.03
            ? "Global shares have fallen over recent months. Sharp global risk-off periods have historically hurt several PSX sectors."
            : spy63 > 0.02
              ? "Global shares have risen over recent months, a steadier backdrop for emerging markets."
              : "Global markets have been broadly flat.",
      metrics: [
        { label: "S&P 500 proxy, 3 months", value: pctSigned(spy63) },
        { label: "Emerging markets, 3 months", value: pctSigned(eem63) },
      ],
      evidence: {
        previous: null,
        source: "SPY and EEM daily closes, lagged one session because those sessions close after the PSX",
        lastUpdated: lastDateWithValue(dates, inputs.spy),
        staleNote: null,
        percentile: null,
        whyStatus:
          "Thirteen of twenty-five sectors showed a validated response to global risk-off days, but the signal did not pass as an index-level forecast input, so it stays contextual.",
        sectorsAffected: sectorsFor(sectors, "global-riskoff"),
        trend: trendOf(inputs.spy),
      },
    },
    {
      key: "gold",
      name: "Gold",
      basis: "context",
      effect: "mixed",
      explanation:
        gold63 === null
          ? "Gold data unavailable."
          : gold63 > 0.05
            ? "Gold has risen over recent months. Sustained strength often signals caution in the wider market."
            : gold63 < -0.05
              ? "Gold has fallen over recent months, which usually accompanies a steadier risk appetite."
              : "Gold has been broadly flat, offering no strong signal either way.",
      metrics: [
        { label: "Gold (USD)", value: goldNow === null ? UNAVAILABLE : goldNow.toFixed(0) },
        { label: "3 months", value: pctSigned(gold63) },
      ],
      evidence: {
        previous: null,
        source: "XAU/USD daily close, lagged one session",
        lastUpdated: lastDateWithValue(dates, inputs.goldUsd),
        staleNote: null,
        percentile: null,
        whyStatus: "Gold is a risk-appetite tell rather than a driver of PSX returns. It did not pass validation and is shown for orientation only.",
        sectorsAffected: [],
        trend: trendOf(inputs.goldUsd),
      },
    },
  ];

  return drivers;
}
