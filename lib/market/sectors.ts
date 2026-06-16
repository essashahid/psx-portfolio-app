/**
 * Sector classification for the Bulls & Bears regime/rotation engine.
 *
 * The show reasons in buckets, not in 40 individual PSX sectors: "war →
 * defensive; commodity up → energy profits; risk-on → cyclicals lead". We map
 * the official PSX sector names onto those buckets so the rotation panel and
 * regime read can compare cyclical vs defensive leadership directly.
 *
 * Matching is keyword-based against the lower-cased sector string so it is
 * resilient to the small naming differences between the PSX directory and the
 * snapshot feed ("Oil & Gas Exploration Companies" vs "Oil and Gas Exploration").
 */

export type SectorBucket = "energy" | "cyclical" | "defensive" | "financials" | "other";

export const BUCKET_META: Record<SectorBucket, { label: string; blurb: string; tone: "warm" | "cool" | "neutral" }> = {
  energy: {
    label: "Energy & Commodity",
    blurb: "E&P, refineries, OMCs. Lead when oil / commodity prices rise — the show's 'commodity up → these profit' chain.",
    tone: "warm",
  },
  cyclical: {
    label: "Cyclicals",
    blurb: "Cement, autos, steel, textiles, chemicals. Lead in risk-on / growth regimes; first to be cut in a war scare.",
    tone: "warm",
  },
  defensive: {
    label: "Defensives",
    blurb: "Fertilizer, food, pharma, power, tobacco. Hold up in risk-off / war regimes — the show's defensive rotation.",
    tone: "cool",
  },
  financials: {
    label: "Financials",
    blurb: "Banks, insurance, investment. Rate- and liquidity-sensitive; a barometer for the broader market.",
    tone: "neutral",
  },
  other: {
    label: "Other",
    blurb: "Sectors that don't map cleanly to the cyclical/defensive frame.",
    tone: "neutral",
  },
};

// Ordered: first matching rule wins. Keep more specific keywords before broad ones.
const RULES: { bucket: SectorBucket; keywords: string[] }[] = [
  { bucket: "energy", keywords: ["oil", "gas", "refin", "petroleum", "exploration", "e&p"] },
  {
    bucket: "defensive",
    keywords: ["fertiliz", "fertili", "food", "personal care", "pharma", "tobacco", "power gen", "power dist", "electric", "water", "gas distribution", "sugar"],
  },
  {
    bucket: "cyclical",
    keywords: ["cement", "auto", "automobile", "steel", "engineering", "textile", "spinning", "weaving", "composite", "glass", "ceram", "chemical", "paper", "board", "real estate", "leather", "tyre", "tire", "cable", "transport", "miscellaneous manufacturing"],
  },
  {
    bucket: "financials",
    keywords: ["bank", "insur", "invest", "modaraba", "leasing", "financial", "brokerage", "exchange"],
  },
];

const cache = new Map<string, SectorBucket>();

/** Classify a PSX sector name into a regime bucket. Unknown/null → "other". */
export function bucketForSector(sector: string | null | undefined): SectorBucket {
  if (!sector) return "other";
  const key = sector.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  let bucket: SectorBucket = "other";
  for (const rule of RULES) {
    if (rule.keywords.some((k) => key.includes(k))) {
      bucket = rule.bucket;
      break;
    }
  }
  cache.set(key, bucket);
  return bucket;
}
