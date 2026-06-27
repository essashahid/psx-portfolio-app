import type { RegimeId } from "./regimes";

/**
 * Structured geopolitical / macro event signals. News and GDELT categories are
 * mapped into a small typed taxonomy, each event carrying a direction and a
 * bounded magnitude. Events feed the regime scorer through deterministic rules
 * only (EVENT_REGIME_RULES below). The LLM never scores or weights events; it
 * may later describe them in prose.
 */

export type EventType =
  | "imf_program" // external financing / stabilisation: rupee-supportive
  | "oil_shock" // energy price spike: import bill, inflation, rupee pressure
  | "sanctions_risk" // external financial pressure
  | "regional_conflict" // security / war risk in the region
  | "election_uncertainty" // domestic political transition risk
  | "rate_decision_dovish" // central bank easing bias
  | "rate_decision_hawkish"; // central bank tightening bias

export interface EventSignal {
  type: EventType;
  /** 0..1 strength of the signal in the current window. */
  magnitude: number;
  label: string;
  detail: string;
}

/**
 * How each event type nudges each regime's score. Values are small, bounded
 * additive contributions (a single event can move a regime score by at most its
 * magnitude times the weight here). Documented and fixed.
 */
const EVENT_REGIME_RULES: Record<EventType, Partial<Record<RegimeId, number>>> = {
  imf_program: { disinflation_easing: 0.4, pkr_stress: -0.5, high_carry: 0.2 },
  oil_shock: { pkr_stress: 0.5, risk_off: 0.3, disinflation_easing: -0.4 },
  sanctions_risk: { risk_off: 0.5, pkr_stress: 0.4 },
  regional_conflict: { risk_off: 0.6, pkr_stress: 0.3 },
  election_uncertainty: { risk_off: 0.3, pkr_stress: 0.2 },
  rate_decision_dovish: { disinflation_easing: 0.5, high_carry: -0.3 },
  rate_decision_hawkish: { high_carry: 0.5, disinflation_easing: -0.4 },
};

/** Cap on the total event contribution to any single regime score, so events
 * inform but never dominate the data-driven signal scoring. */
export const MAX_EVENT_CONTRIBUTION = 0.6;

/** Aggregate event nudges to per-regime score contributions, bounded. */
export function eventRegimeContributions(events: EventSignal[]): Partial<Record<RegimeId, number>> {
  const out: Partial<Record<RegimeId, number>> = {};
  for (const ev of events) {
    const rules = EVENT_REGIME_RULES[ev.type];
    for (const [regime, weight] of Object.entries(rules) as [RegimeId, number][]) {
      out[regime] = (out[regime] ?? 0) + weight * Math.max(0, Math.min(1, ev.magnitude));
    }
  }
  // Clamp each regime's total event contribution.
  for (const k of Object.keys(out) as RegimeId[]) {
    out[k] = Math.max(-MAX_EVENT_CONTRIBUTION, Math.min(MAX_EVENT_CONTRIBUTION, out[k]!));
  }
  return out;
}

export interface NewsCategoryCounts {
  /** Counts of recent market/macro articles by coarse category. */
  policy?: number;
  commodity?: number;
  international?: number;
  economy?: number;
  /** Average sentiment of recent macro articles, -1..1 (negative = risk). */
  avgSentiment?: number;
  total?: number;
}

/**
 * Derive structured events from the platform's existing news categorisation.
 * This is deliberately coarse and conservative: it converts observable counts
 * into bounded event magnitudes, and returns nothing when there is no signal,
 * rather than inventing geopolitics.
 */
export function deriveEventsFromNews(counts: NewsCategoryCounts | null): EventSignal[] {
  if (!counts || !counts.total) return [];
  const events: EventSignal[] = [];
  const share = (n: number | undefined) => (n && counts.total ? n / counts.total : 0);

  const commodityShare = share(counts.commodity);
  if (commodityShare > 0.15) {
    events.push({
      type: "oil_shock",
      magnitude: Math.min(1, commodityShare * 2),
      label: "Elevated commodity / energy coverage",
      detail: `${Math.round(commodityShare * 100)}% of recent macro stories are commodity-led.`,
    });
  }
  const intlShare = share(counts.international);
  if (intlShare > 0.2 && (counts.avgSentiment ?? 0) < 0) {
    events.push({
      type: "regional_conflict",
      magnitude: Math.min(1, intlShare * 1.5),
      label: "Negative international news flow",
      detail: `International stories are ${Math.round(intlShare * 100)}% of coverage with negative tone.`,
    });
  }
  const policyShare = share(counts.policy);
  if (policyShare > 0.2) {
    events.push({
      type: "imf_program",
      magnitude: Math.min(0.8, policyShare),
      label: "Heavy policy / external-financing coverage",
      detail: `${Math.round(policyShare * 100)}% of stories are policy-led; treated as stabilisation-relevant.`,
    });
  }
  return events;
}
