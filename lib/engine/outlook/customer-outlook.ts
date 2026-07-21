import type { AlignedInputs } from "@/lib/engine/outlook/inputs";
import type { ForecastDataset, WfHorizon } from "@/lib/engine/outlook/walkforward";
import type { ExperimentalOutlook } from "@/lib/engine/outlook/experimental-outlook";

/**
 * The customer-facing outlook.
 *
 * Assembled only from outputs that passed their Phase 3 walk-forward gate,
 * plus deterministic technical levels and current readings of the drivers.
 * Three rules hold throughout:
 *
 *  - A failed output is omitted, never substituted. Where its absence would be
 *    noticeable the copy says confidence is too low, in plain words, without
 *    exposing gate mechanics.
 *  - Levels are reference points. The placebo study found no evidence they
 *    hold, so the language never claims they will; the probabilities attached
 *    to them come from the validated path distribution instead.
 *  - Nothing is invented. Events we do not have a verified source for (IMF
 *    milestones, politics, security) are listed as untracked rather than
 *    guessed at.
 */

export type Tone = "positive" | "neutral" | "negative";

export interface CustomerLevel {
  price: number;
  distancePct: number;
  /** Chance the path reaches it over two weeks, from the validated distribution. */
  reachProb: number | null;
}

export interface CustomerDriver {
  name: string;
  /** Whether this reading feeds a validated model or is background only. */
  basis: "model" | "context";
  effect: "positive" | "risk" | "mixed";
  detail: string;
}

export interface SectorCall {
  sector: string;
  reason: string;
  /** True when the driving relationship cleared historical validation. */
  validated: boolean;
}

export interface CustomerHorizon {
  key: WfHorizon;
  label: string;
  /** Plain-language current view for this window. */
  view: string;
  range: { loIndex: number; hiIndex: number } | null;
  keyLevel: { price: number; kind: "support" | "resistance" } | null;
  takeaway: string;
  risk: { label: string; note: string };
  /** Only present for the horizon whose direction model passed. */
  direction: { rise: number; sideways: number; fall: number } | null;
  /** Only present where the drawdown model passed. */
  dipRisk: { thresholdPct: number; probability: number } | null;
}

export interface CustomerOutlook {
  asOf: string;
  close: number;
  stance: { label: string; tone: Tone; sub: string };
  confidence: { pct: number | null; label: string; note: string };
  horizons: CustomerHorizon[];
  levels: { supports: CustomerLevel[]; resistances: CustomerLevel[]; aboveNote: string; belowNote: string };
  drivers: CustomerDriver[];
  sectors: { beneficiaries: SectorCall[]; atRisk: SectorCall[]; basis: string };
  whatCouldChange: { strengthen: string; weaken: string };
  notTracked: string;
}

export interface SectorFactorRow {
  factor: string;
  spread: number;
  validated: boolean;
}
export interface SectorRow {
  sector: string;
  members: number;
  factors: SectorFactorRow[];
}

const HORIZON_LABEL: Record<WfHorizon, string> = { 5: "1 week", 10: "2 weeks", 20: "1 month" };

const fmtIndex = (v: number) => Math.round(v).toLocaleString("en-US");
const pctText = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

/** Latest non-null value of a series. */
function latest(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null) return series[i];
  return null;
}

/** Percentile of the latest value within its own history, 0-1. */
function percentileOfLatest(series: (number | null)[]): number | null {
  const present = series.filter((v): v is number => v !== null);
  if (present.length < 60) return null;
  const current = present[present.length - 1];
  const past = present.slice(0, -1);
  return past.filter((v) => v <= current).length / past.length;
}

/** Percentage change of a series over `lookback` observations. */
function changeOver(series: (number | null)[], lookback: number): number | null {
  const present = series.filter((v): v is number => v !== null);
  if (present.length < lookback + 1) return null;
  const now = present[present.length - 1];
  const then = present[present.length - 1 - lookback];
  return then > 0 ? now / then - 1 : null;
}

function trendWord(change: number | null, flatBand = 0.01): "rising" | "easing" | "steady" {
  if (change === null) return "steady";
  if (change > flatBand) return "rising";
  if (change < -flatBand) return "easing";
  return "steady";
}

// --- Sector calls ---------------------------------------------------------------

/**
 * Rank sectors for the current conditions using historically validated
 * relationships only.
 *
 * The validated set is dominated by market beta (every sector follows the
 * market) so beta alone would just rank sectors by volatility. What separates
 * them is how badly each was hit when participation narrowed or global risk
 * appetite fell, which is where the validation actually found differences.
 */
function buildSectorCalls(
  sectors: SectorRow[],
  conditions: { leansUp: boolean; breadthWeak: boolean; globalRiskOff: boolean; oilRising: boolean }
): { beneficiaries: SectorCall[]; atRisk: SectorCall[]; basis: string } {
  const spreadOf = (s: SectorRow, key: string) => {
    const f = s.factors.find((x) => x.factor === key);
    return f && f.validated ? f.spread : 0;
  };

  const scored = sectors
    .filter((s) => s.members >= 8)
    .map((s) => {
      const beta = spreadOf(s, "market-up");
      const breadth = spreadOf(s, "breadth-weak");
      const global = spreadOf(s, "global-riskoff");
      const oil = spreadOf(s, "oil-up");

      // Signed contributions. Positive helps the sector under current
      // conditions, negative hurts it; the score is their sum.
      const contributions: { impact: number; helps: string; hurts: string }[] = [];

      if (beta > 0) {
        contributions.push(
          conditions.leansUp
            ? { impact: beta, helps: "tends to gain more than the market when it rises", hurts: "" }
            : { impact: -beta, helps: "", hurts: "tends to fall harder than the market when it slips" }
        );
      }
      if (conditions.breadthWeak && breadth < 0) {
        contributions.push({ impact: breadth, helps: "", hurts: "historically weak when fewer stocks are participating" });
      }
      if (conditions.globalRiskOff && global < 0) {
        contributions.push({ impact: global, helps: "", hurts: "sensitive to global risk appetite, which is currently falling" });
      }
      if (conditions.oilRising && oil < 0) {
        contributions.push({ impact: oil, helps: "", hurts: "pressured when oil prices rise" });
      }

      const score = contributions.reduce((a, c) => a + c.impact, 0);
      // The reason must match the direction a sector is ranked in. Taking the
      // largest contribution regardless of sign put "gains more when the market
      // rises" against sectors listed as at risk, which reads as a mistake.
      const best = contributions.filter((c) => c.impact > 0 && c.helps).sort((a, b) => b.impact - a.impact)[0];
      const worst = contributions.filter((c) => c.impact < 0 && c.hurts).sort((a, b) => a.impact - b.impact)[0];

      return {
        sector: s.sector,
        score,
        upsideReason: best?.helps ?? "moves broadly in line with the market",
        downsideReason: worst?.hurts ?? "tends to lag when the market rises",
      };
    });

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return {
    beneficiaries: sorted.slice(0, 3).map((s) => ({ sector: s.sector, reason: s.upsideReason, validated: true })),
    atRisk: sorted
      .slice(-3)
      .reverse()
      .map((s) => ({ sector: s.sector, reason: s.downsideReason, validated: true })),
    basis:
      "Based on how each sector actually behaved in similar conditions over the past five years, using only relationships that held up under testing.",
  };
}

// --- Assembly --------------------------------------------------------------------

export function buildCustomerOutlook(
  inputs: AlignedInputs,
  dataset: ForecastDataset,
  experimental: ExperimentalOutlook,
  sectors: SectorRow[]
): CustomerOutlook {
  const last = dataset.dates.length - 1;
  const close = dataset.close[last];
  // Levels arrive already computed on the experimental outlook, which runs the
  // same deterministic technical engine; recomputing them here would duplicate
  // that work and risk the two drifting apart.

  // The only validated directional read, from the two-week horizon.
  const twoWeek = experimental.horizons.find((h) => h.sessions === 10);
  const dir = twoWeek?.direction.status === "ok" ? twoWeek.direction.probs ?? null : null;

  const lean = dir ? dir.rise - dir.fall : null;
  const volPct = percentileOfLatest(dataset.ewmaSigma);
  const volatile = volPct !== null && volPct >= 2 / 3;

  const stance: CustomerOutlook["stance"] =
    lean === null
      ? { label: "Not enough confidence", tone: "neutral", sub: "No directional view meets our evidence bar right now" }
      : lean > 0.15
        ? { label: volatile ? "Positive but volatile" : "Positive", tone: "positive", sub: volatile ? "Upward lean with wider than usual swings" : "Upward lean" }
        : lean > 0.05
          ? { label: "Neutral to positive", tone: "positive", sub: "Slight upward lean" }
          : lean > -0.05
            ? { label: "Neutral", tone: "neutral", sub: "No clear lean either way" }
            : lean > -0.15
              ? { label: "Neutral to negative", tone: "negative", sub: "Slight downward lean" }
              : { label: "Negative", tone: "negative", sub: "Downward lean" };

  const leading = dir ? Math.max(dir.rise, dir.sideways, dir.fall) : null;
  const confidence: CustomerOutlook["confidence"] = {
    pct: leading,
    label: leading === null ? "Unavailable" : leading >= 0.55 ? "Higher confidence" : leading >= 0.4 ? "Moderate confidence" : "Low confidence",
    note:
      leading === null
        ? "A directional view is only shown when it beats a simple benchmark on unseen history."
        : "Chance of the most likely of three outcomes: up, broadly flat, or down.",
  };

  // Levels, shared across horizons; reach probabilities from the two-week path.
  const twoWeekLevels = twoWeek?.keyLevels;
  const supports: CustomerLevel[] = (twoWeekLevels?.supports ?? []).map((l) => ({
    price: l.price,
    distancePct: l.distancePct,
    reachProb: l.breakProb,
  }));
  const resistances: CustomerLevel[] = (twoWeekLevels?.resistances ?? []).map((l) => ({
    price: l.price,
    distancePct: l.distancePct,
    reachProb: l.breakProb,
  }));

  const horizons: CustomerHorizon[] = experimental.horizons.map((h) => {
    const range = h.tradingRange.status === "ok" && h.tradingRange.loIndex && h.tradingRange.hiIndex
      ? { loIndex: h.tradingRange.loIndex, hiIndex: h.tradingRange.hiIndex }
      : null;
    const hDir = h.direction.status === "ok" ? h.direction.probs ?? null : null;
    const dip = h.drawdownRisk.find((d) => d.status === "ok" && d.p !== undefined);

    // Key level: the nearer side of the market, which is what actually matters next.
    const nearestRes = resistances[0];
    const nearestSup = supports[0];
    const keyLevel =
      nearestRes && nearestSup
        ? Math.abs(nearestRes.distancePct) <= Math.abs(nearestSup.distancePct)
          ? { price: nearestRes.price, kind: "resistance" as const }
          : { price: nearestSup.price, kind: "support" as const }
        : nearestRes
          ? { price: nearestRes.price, kind: "resistance" as const }
          : nearestSup
            ? { price: nearestSup.price, kind: "support" as const }
            : null;

    const viewParts: string[] = [];
    if (hDir) {
      viewParts.push(
        `Over the next ${HORIZON_LABEL[h.sessions].toLowerCase()}, the balance of past evidence leans ${hDir.rise > hDir.fall ? "slightly higher" : "slightly lower"}.`
      );
    } else {
      viewParts.push(
        `We do not have a confident direction for this window, so we show the range the market has typically moved through instead.`
      );
    }
    if (volatile) viewParts.push("Recent swings have been wider than usual, so the range is broad.");
    if (dip?.p !== undefined) viewParts.push(`There is roughly a ${pctText(dip.p)} chance of a dip of ${Math.abs((dip.threshold ?? 0) * 100).toFixed(0)}% or more along the way.`);

    const takeawayParts: string[] = [];
    if (nearestSup) takeawayParts.push(`holding above ${fmtIndex(nearestSup.price)}`);
    if (nearestRes) takeawayParts.push(`clearing ${fmtIndex(nearestRes.price)}`);
    const takeaway =
      takeawayParts.length === 2
        ? `The view strengthens on ${takeawayParts[1]}, and weakens if the market loses ${fmtIndex(nearestSup!.price)}.`
        : "Key technical levels are unavailable for this session.";

    const riskLabel = experimental.riskLevel === "low" ? "Low" : experimental.riskLevel === "moderate" ? "Moderate" : experimental.riskLevel === "elevated" ? "Elevated" : "High";

    return {
      key: h.sessions,
      label: HORIZON_LABEL[h.sessions],
      view: viewParts.join(" "),
      range,
      keyLevel,
      takeaway,
      risk: {
        label: riskLabel,
        note:
          h.sessions === 20
            ? "A longer window carries more exposure to economic and global surprises."
            : "Based on how much the market has been moving recently.",
      },
      direction: hDir,
      dipRisk: dip?.p !== undefined ? { thresholdPct: Math.abs((dip.threshold ?? 0) * 100), probability: dip.p } : null,
    };
  });

  // --- Drivers, all current readings ---
  const advPct = percentileOfLatest(dataset.adv10);
  const upvolPct = percentileOfLatest(dataset.upvol10);
  const pkrChange = changeOver(inputs.usdPkr, 63);
  const brentChange = changeOver(inputs.brent, 63);
  const goldChange = changeOver(inputs.goldUsd, 63);
  const spyChange = changeOver(inputs.spy, 63);
  const eemChange = changeOver(inputs.eem, 63);
  const policy = latest(inputs.policyRate.map((v) => v));
  const cpi = latest(inputs.cpiYoY);
  const fipiRecent = inputs.fipiNet.slice(-21).filter((v): v is number => v !== null);
  const fipiSum = fipiRecent.length >= 10 ? fipiRecent.reduce((a, b) => a + b, 0) : null;

  const drivers: CustomerDriver[] = [
    {
      name: "Market participation",
      basis: "model",
      effect: advPct === null ? "mixed" : advPct >= 0.55 ? "positive" : advPct <= 0.35 ? "risk" : "mixed",
      detail:
        advPct === null
          ? "Participation data is still building."
          : advPct >= 0.55
            ? "A healthy share of stocks is taking part in the move, which has historically supported gains."
            : advPct <= 0.35
              ? "Fewer stocks are participating than usual, which has historically preceded weaker stretches."
              : "Participation is around its typical level.",
    },
    {
      name: "Market volatility",
      basis: "model",
      effect: volPct === null ? "mixed" : volPct >= 2 / 3 ? "risk" : volPct <= 1 / 3 ? "positive" : "mixed",
      detail:
        volPct === null
          ? "Volatility reading unavailable."
          : volPct >= 2 / 3
            ? "Recent swings are larger than usual. This is the single most reliable warning signal we found, and it raises the chance of a sharp dip."
            : volPct <= 1 / 3
              ? "The market has been unusually calm, which has historically meant a lower chance of a sharp dip."
              : "Swings are around their typical size.",
    },
    {
      name: "Trading volume behind the move",
      basis: "model",
      effect: upvolPct === null ? "mixed" : upvolPct >= 0.55 ? "positive" : upvolPct <= 0.35 ? "risk" : "mixed",
      detail:
        upvolPct === null
          ? "Volume split unavailable."
          : upvolPct >= 0.55
            ? "More volume is going through rising stocks than falling ones."
            : upvolPct <= 0.35
              ? "Volume is concentrated in falling stocks."
              : "Volume is evenly split between rising and falling stocks.",
    },
    {
      name: "Rupee against the dollar",
      basis: "context",
      effect: pkrChange === null ? "mixed" : pkrChange > 0.02 ? "risk" : pkrChange < -0.01 ? "positive" : "mixed",
      detail:
        pkrChange === null
          ? "Currency data unavailable."
          : `${
              pkrChange > 0.01
                ? `The rupee has weakened ${pctText(pkrChange, 1)} against the dollar over three months`
                : pkrChange < -0.01
                  ? `The rupee has strengthened ${pctText(Math.abs(pkrChange), 1)} against the dollar over three months`
                  : "The rupee is broadly stable against the dollar over three months"
            }. Currency pressure raises import costs and inflation.`,
    },
    {
      name: "Brent crude oil",
      basis: "context",
      effect: brentChange === null ? "mixed" : brentChange > 0.05 ? "risk" : brentChange < -0.05 ? "positive" : "mixed",
      detail:
        brentChange === null
          ? "Oil data unavailable."
          : `${
              brentChange > 0.05
                ? `Oil is up ${pctText(brentChange, 1)} over three months`
                : brentChange < -0.05
                  ? `Oil is down ${pctText(Math.abs(brentChange), 1)} over three months`
                  : "Oil is broadly flat over three months"
            }. Pakistan imports its energy, so higher oil pressures the import bill, inflation and the rupee.`,
    },
    {
      name: "Interest rates and inflation",
      basis: "context",
      effect: policy !== null && cpi !== null && policy - cpi > 3 ? "positive" : "mixed",
      detail:
        policy === null
          ? "Policy rate unavailable."
          : `The policy rate is ${policy.toFixed(1)}%${cpi !== null ? ` against inflation near ${cpi.toFixed(1)}%` : ""}. ${policy !== null && cpi !== null && policy - cpi > 3 ? "Real rates remain positive, which supports the rupee but weighs on borrowing." : "Rate and inflation conditions are mixed for equities."}`,
    },
    {
      name: "Foreign investor flows",
      basis: "context",
      effect: fipiSum === null ? "mixed" : fipiSum > 0 ? "positive" : "risk",
      detail:
        fipiSum === null
          ? "Flow data unavailable for the recent period."
          : `Foreign investors have been net ${fipiSum > 0 ? "buyers" : "sellers"} over the past month (${fipiSum > 0 ? "+" : ""}$${fipiSum.toFixed(1)}m). Flows move with the market rather than ahead of it, so we treat this as background.`,
    },
    {
      name: "Global markets",
      basis: "context",
      effect: spyChange === null ? "mixed" : spyChange > 0.02 && (eemChange ?? 0) > 0 ? "positive" : spyChange < -0.03 ? "risk" : "mixed",
      detail:
        spyChange === null
          ? "Global market data unavailable."
          : `Global shares are ${trendWord(spyChange, 0.02)} over three months${eemChange !== null ? `, with emerging markets ${trendWord(eemChange, 0.02)}` : ""}. Sharp global risk-off periods have historically hurt several PSX sectors.`,
    },
    {
      name: "Gold",
      basis: "context",
      effect: "mixed",
      detail:
        goldChange === null
          ? "Gold data unavailable."
          : goldChange > 0.05
            ? `Gold is up ${pctText(goldChange, 1)} over three months. Sustained strength often signals caution in the wider market.`
            : goldChange < -0.05
              ? `Gold is down ${pctText(Math.abs(goldChange), 1)} over three months, which usually accompanies a steadier risk appetite.`
              : "Gold is broadly flat over three months, offering no strong signal either way.",
    },
  ];

  // --- Sectors, from validated relationships under current conditions ---
  const sectorCalls = buildSectorCalls(sectors, {
    leansUp: (lean ?? 0) >= 0,
    breadthWeak: advPct !== null && advPct <= 0.35,
    globalRiskOff: spyChange !== null && spyChange < -0.03,
    oilRising: brentChange !== null && brentChange > 0.05,
  });

  const nearestSup = supports[0];
  const nearestRes = resistances[0];

  return {
    asOf: dataset.dates[last],
    close,
    stance,
    confidence,
    horizons,
    levels: {
      supports,
      resistances,
      aboveNote: nearestRes
        ? `A sustained move above ${fmtIndex(nearestRes.price)} would strengthen the outlook and open the upper half of the expected range.`
        : "No nearby resistance is visible in the current structure.",
      belowNote: nearestSup
        ? `A close below ${fmtIndex(nearestSup.price)} would weaken the outlook and shift attention to the lower support levels.`
        : "No nearby support is visible in the current structure.",
    },
    drivers,
    sectors: sectorCalls,
    whatCouldChange: {
      strengthen: `Improving participation, calmer trading, ${nearestRes ? `a decisive move above ${fmtIndex(nearestRes.price)}` : "a break above resistance"}, a steadier rupee or softer oil would all strengthen this view.`,
      weaken: `Narrowing participation, a jump in volatility, ${nearestSup ? `a break below ${fmtIndex(nearestSup.price)}` : "a break below support"}, renewed rupee pressure, an oil spike or a global risk-off move would weaken it.`,
    },
    notTracked:
      "This outlook reads market and economic data only. It does not yet track news, IMF milestones, reserves, the current account, or political and security events, any of which can move the market quickly.",
  };
}
