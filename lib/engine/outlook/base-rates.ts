import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  horizonStats,
  volConditionalStats,
  findGaps,
  DRAWDOWN_THRESHOLDS,
  type ClosePoint,
  type HorizonKey,
} from "@/lib/engine/outlook/history-stats";

/**
 * Historical base rates for the KSE-100, assembled for the Market Outlook page.
 *
 * These are frequencies observed in the record, not a forecast. Every rate is
 * counted over non-overlapping windows, so the same market episode is never
 * reused to make a sample look larger than it is, and a threshold is only
 * quoted where it occurred often enough for the rate to carry meaning.
 */

/** Below this many hits, a frequency says more about luck than the market. */
const MIN_HITS_TO_QUOTE = 5;

/** The three horizons the page offers, in the reader's language. */
export const BASE_RATE_HORIZONS = [
  { key: "5d" as HorizonKey, label: "1 week", phrase: "one week ahead" },
  { key: "10d" as HorizonKey, label: "2 weeks", phrase: "two weeks ahead" },
  { key: "1m" as HorizonKey, label: "1 month", phrase: "one month ahead" },
];

export interface LadderRow {
  /** Move size as a positive percentage, e.g. 5 for a 5% move. */
  movePct: number;
  /** Share of windows that fell at least this far, 0-1, or null if too rare. */
  fell: number | null;
  /** Share that rose at least this far, 0-1, or null if too rare. */
  rose: number | null;
}

export interface BaseRateHorizon {
  key: HorizonKey;
  label: string;
  phrase: string;
  sessions: number;
  independentWindows: number;
  /** Forward close-to-close return percentiles, as fractions. */
  band: { p10: number; median: number; p90: number };
  worst: number;
  best: number;
  positiveRate: number;
  /** Chance of a 5% fall and a 5% rise, with the window counts behind them. */
  fall5: { rate: number | null; hits: number };
  rise5: { rate: number | null; hits: number };
  positiveWindows: number;
  ladder: LadderRow[];
  /** Sample-size verdict, kept separate from how the number itself looks. */
  confidence: "Limited evidence" | "Moderate evidence" | "Strong evidence";
}

export interface VolatilitySplit {
  key: HorizonKey;
  phrase: string;
  calm: number;
  all: number;
  turbulent: number;
  /** turbulent / all. Above 1 means trailing volatility carried information. */
  lift: number;
}

export interface OutlookBaseRates {
  horizons: BaseRateHorizon[];
  volatility: VolatilitySplit[];
  sample: {
    sessions: number;
    years: number;
    firstSession: string;
    lastSession: string;
    longestGapSessions: number;
  };
  /** The widest band across horizons, so every horizon shares one scale. */
  bandScale: number;
}

function confidenceFor(windows: number): BaseRateHorizon["confidence"] {
  if (windows >= 100) return "Strong evidence";
  if (windows >= 40) return "Moderate evidence";
  return "Limited evidence";
}

/** PostgREST caps a response at 1,000 rows, so the history is read in pages. */
const PAGE = 1000;

async function loadCloses(): Promise<ClosePoint[]> {
  const admin = createAdminClient();
  const out: ClosePoint[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("company_price_history")
      .select("price_date, close")
      .eq("ticker", "KSE100")
      .order("price_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      const close = Number(r.close);
      if (Number.isFinite(close) && close > 0) out.push({ date: String(r.price_date), close });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function build(): Promise<OutlookBaseRates | null> {
  const points = await loadCloses();

  // Below a few years there is no honest base rate to quote at a monthly
  // horizon, so the page says nothing rather than quoting a handful of windows.
  if (points.length < 500) return null;

  const stats = horizonStats(points);
  const vol = volConditionalStats(points);
  const gaps = findGaps(points.map((p) => p.date));

  const horizons: BaseRateHorizon[] = BASE_RATE_HORIZONS.map((h) => {
    const s = stats.find((x) => x.key === h.key)!;
    const independent = s.independentWindows;

    // Threshold frequencies are computed over overlapping windows; scale the
    // hit counts to the independent sample so a quoted count is honest.
    const scale = s.overlappingWindows > 0 ? independent / s.overlappingWindows : 0;
    const at = (list: typeof s.thresholds, target: number) =>
      list.find((t) => Math.abs(Math.abs(t.threshold) - target) < 1e-9);

    const quote = (t: { hits: number; frequency: number } | undefined) => {
      const hits = t ? Math.round(t.hits * scale) : 0;
      const rate = t && Number.isFinite(t.frequency) && hits >= MIN_HITS_TO_QUOTE ? t.frequency : null;
      return { rate, hits };
    };

    const fall5 = quote(at(s.thresholds, 0.05));
    const rise5 = quote(at(s.rallyThresholds, 0.05));

    const ladder: LadderRow[] = DRAWDOWN_THRESHOLDS.map((t) => {
      const movePct = Math.round(Math.abs(t) * 100);
      const fell = quote(at(s.thresholds, Math.abs(t)));
      const rose = quote(at(s.rallyThresholds, Math.abs(t)));
      return { movePct, fell: fell.rate, rose: rose.rate };
    });

    return {
      key: h.key,
      label: h.label,
      phrase: h.phrase,
      sessions: s.sessions,
      independentWindows: independent,
      band: {
        p10: s.returnPercentiles.p10,
        median: s.returnPercentiles.median,
        p90: s.returnPercentiles.p90,
      },
      worst: s.drawdownPercentiles.worst,
      best: s.runupPercentiles.best,
      positiveRate: s.positiveRate,
      positiveWindows: Math.round(s.positiveRate * independent),
      fall5,
      rise5,
      ladder,
      confidence: confidenceFor(independent),
    };
  });

  const volatility: VolatilitySplit[] = BASE_RATE_HORIZONS.map((h) => {
    const v = vol.find((x) => x.horizonKey === h.key && Math.abs(x.threshold + 0.05) < 1e-9);
    return {
      key: h.key,
      phrase: h.phrase,
      calm: v?.lowVolRate ?? NaN,
      all: v?.baseRate ?? NaN,
      turbulent: v?.highVolRate ?? NaN,
      lift: v?.lift ?? NaN,
    };
  }).filter((v) => Number.isFinite(v.all));

  const first = points[0].date;
  const last = points[points.length - 1].date;
  const years = (new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 86_400_000);

  return {
    horizons,
    volatility,
    sample: {
      sessions: points.length,
      years,
      firstSession: first,
      lastSession: last,
      longestGapSessions: gaps.longestGapWeekdays,
    },
    // One shared scale across horizons, so a longer window visibly widens the
    // band rather than being rescaled to look the same width as a short one.
    bandScale: Math.max(...horizons.map((h) => Math.max(Math.abs(h.band.p10), Math.abs(h.band.p90)))),
  };
}

export const OUTLOOK_BASE_RATES_TAG = "outlook-base-rates";

/** End-of-day history; recomputing per request would cost seconds for nothing. */
export const getOutlookBaseRates = unstable_cache(build, ["outlook-base-rates-v1"], {
  revalidate: 3600,
  tags: [OUTLOOK_BASE_RATES_TAG],
});
