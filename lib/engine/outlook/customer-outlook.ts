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

/**
 * How much weight a sector statement carries.
 *
 * "validated" means the relationship driving it cleared historical testing.
 * "rule-based" means it rests on a documented economic assumption that has not
 * been validated on this history, and must never be presented as a model
 * output. "contextual" is a descriptive observation with no claim attached.
 */
export type SectorBasis = "validated" | "contextual" | "rule-based";

export interface SectorCall {
  sector: string;
  reason: string;
  basis: SectorBasis;
}

export interface CustomerHorizon {
  key: WfHorizon;
  label: string;
  /** Plain-language current view for this window. */
  view: string;
  range: { loIndex: number; hiIndex: number } | null;
  /** Why the range is the width it is, so it is not read as a target. */
  rangeNote: string;
  keyLevel: { price: number; kind: "support" | "resistance" } | null;
  takeaway: string;
  risk: { label: string; note: string };
  /** Only present for the horizon whose direction model passed. */
  direction: { rise: number; sideways: number; fall: number } | null;
  /** Only present where the drawdown model passed. */
  dipRisk: { thresholdPct: number; probability: number } | null;
  /** The one horizon with a validated direction model. */
  bestSupported: boolean;
  /** Stated whenever direction is unsupported here, so the gap is explicit. */
  directionNote: string | null;
}

export interface CustomerOutlook {
  asOf: string;
  close: number;
  /** Headline read, plus one sentence reconciling direction against risk. */
  stance: { label: string; tone: Tone; sub: string; explanation: string };
  /** The three outcome probabilities from the validated direction model. */
  scenarios: { rise: number; sideways: number; fall: number; horizonLabel: string } | null;
  /**
   * How much validation stands behind the feature as a whole. Derived from how
   * many outputs cleared their walk-forward gate, never from how confident a
   * single probability happens to look.
   */
  evidenceQuality: { level: "Low" | "Moderate" | "High"; note: string };
  horizons: CustomerHorizon[];
  levels: { supports: CustomerLevel[]; resistances: CustomerLevel[]; aboveNote: string; belowNote: string };
  drivers: CustomerDriver[];
  sectors: { beneficiaries: SectorCall[]; atRisk: SectorCall[]; basis: string };
  whatCouldChange: { strengthen: string; weaken: string };
  /** Factors that are genuinely absent from the calculation, named explicitly. */
  notIncluded: { items: string[]; note: string };
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
        // Every contribution above is built from a spread that already passed
        // validation (spreadOf returns 0 otherwise), so a reason drawn from one
        // is validated. The fallbacks are not, and are tagged accordingly.
        upside: best
          ? { reason: best.helps, basis: "validated" as SectorBasis }
          : { reason: "moves broadly in line with the market", basis: "contextual" as SectorBasis },
        downside: worst
          ? { reason: worst.hurts, basis: "validated" as SectorBasis }
          : { reason: "tends to lag when the market rises", basis: "contextual" as SectorBasis },
      };
    });

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return {
    beneficiaries: sorted.slice(0, 3).map((s) => ({ sector: s.sector, reason: s.upside.reason, basis: s.upside.basis })),
    atRisk: sorted
      .slice(-3)
      .reverse()
      .map((s) => ({ sector: s.sector, reason: s.downside.reason, basis: s.downside.basis })),
    basis:
      "Sector calls come from how each sector actually behaved in similar conditions over the past five years. Statements marked as tested rest on relationships that held up under validation; the rest are descriptive and carry no forecast.",
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

  // Participation and volatility are the two model drivers that speak to risk.
  // When either is unfavourable the headline says so rather than letting a
  // positive lean stand alone, because the two readings genuinely disagree.
  const advPctEarly = percentileOfLatest(dataset.adv10);
  const participationWeak = advPctEarly !== null && advPctEarly <= 0.35;
  const cautionary = volatile || participationWeak;

  const stance: CustomerOutlook["stance"] = (() => {
    if (lean === null) {
      return {
        label: "Not enough evidence",
        tone: "neutral" as Tone,
        sub: "No directional view currently meets our evidence bar",
        explanation:
          "A direction is only shown when it beats a simple benchmark on history the model had never seen. None does at present, so we show the range the market has typically moved through instead.",
      };
    }
    const cautionSentence = (() => {
      const flags: string[] = [];
      if (volatile) flags.push("swings are wider than usual");
      if (participationWeak) flags.push("fewer stocks are taking part in the move");
      if (flags.length === 0) return "Risk readings are around their normal levels.";
      return `Direction leans ${lean > 0 ? "upward" : "downward"}, but ${flags.join(" and ")}, which argues for caution.`;
    })();

    if (lean > 0.15) {
      return cautionary
        ? { label: "Cautiously positive", tone: "positive" as Tone, sub: "Upward bias, elevated risk", explanation: cautionSentence }
        : { label: "Positive", tone: "positive" as Tone, sub: "Upward lean", explanation: cautionSentence };
    }
    if (lean > 0.05) {
      return {
        label: cautionary ? "Cautiously positive" : "Neutral to positive",
        tone: "positive" as Tone,
        sub: cautionary ? "Slight upward bias, elevated risk" : "Slight upward lean",
        explanation: cautionSentence,
      };
    }
    if (lean > -0.05) {
      return { label: "Neutral", tone: "neutral" as Tone, sub: "No clear lean either way", explanation: cautionSentence };
    }
    if (lean > -0.15) {
      return { label: "Neutral to negative", tone: "negative" as Tone, sub: "Slight downward lean", explanation: cautionSentence };
    }
    return { label: "Negative", tone: "negative" as Tone, sub: "Downward lean", explanation: cautionSentence };
  })();

  const scenarios = dir ? { rise: dir.rise, sideways: dir.sideways, fall: dir.fall, horizonLabel: HORIZON_LABEL[10] } : null;

  // Evidence quality reflects how much of the feature cleared validation, not
  // how large a single probability happens to be. A 47% class probability is
  // not confidence; three passing outputs out of many is the real signal.
  const directionPasses = experimental.horizons.filter((h) => h.direction.status === "ok").length;
  const rangePasses = experimental.horizons.filter((h) => h.tradingRange.status === "ok").length;
  const evidenceQuality: CustomerOutlook["evidenceQuality"] =
    directionPasses >= 2 && rangePasses >= 2
      ? { level: "High", note: "Direction and range models both hold up across several time windows." }
      : directionPasses >= 1 && rangePasses >= 2
        ? {
            level: "Moderate",
            note: "Movement ranges hold up across all windows, but direction only clears the bar over two weeks, and by a modest margin. Treat the directional lean as a tilt, not a call.",
          }
        : {
            level: "Low",
            note: "Little of the forecast currently clears its validation bar, so most outputs are withheld.",
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
        `Over the next two weeks, the balance of past evidence leans ${hDir.rise > hDir.fall ? "slightly higher" : "slightly lower"}. This is the only window where a direction model passed validation.`
      );
    } else {
      viewParts.push(
        `Direction is not currently supported over this window. We show how far the market has typically travelled instead.`
      );
    }
    if (dip?.p !== undefined) viewParts.push(`There is roughly a ${pctText(dip.p)} chance of a dip of ${Math.abs((dip.threshold ?? 0) * 100).toFixed(0)}% or more along the way.`);

    const directionNote = hDir
      ? null
      : "Only the two-week window has a direction model that passed validation. Direction over one week and one month did not clear the bar, so none is shown here.";

    // The range is a spread of plausible paths, not a target, and it widens
    // mechanically with volatility. Saying so prevents the wide intervals from
    // being read as precision.
    const rangeNote = volatile
      ? "This range is wide because recent swings have been larger than usual. It shows the span the market could plausibly travel through, not a target or a prediction of where it will finish."
      : "This shows the span the market could plausibly travel through, not a target or a prediction of where it will finish.";

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
      rangeNote,
      keyLevel,
      takeaway,
      bestSupported: hDir !== null,
      directionNote,
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
    scenarios,
    evidenceQuality,
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
    notIncluded: {
      items: [
        "IMF programme milestones",
        "Foreign-exchange reserves",
        "Current account balance",
        "Remittances",
        "Political and security events",
        "News and market commentary",
      ],
      note: "None of these feed the calculation above. They are listed so their absence is clear rather than assumed, and any of them can move the market quickly.",
    },
  };
}
