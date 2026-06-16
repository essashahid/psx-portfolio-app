import type { SectorBucket } from "@/lib/market/sectors";

/**
 * Weekly "Bulls & Bears" reference brief.
 *
 * This is the structured distillation of one Sarmaya "Bulls vs Bears" episode —
 * the show's thinking patterns turned into data the Bulls & Bears tab renders:
 * top developments, market recap, call review (accountability), macro & budget
 * with sector impact, sector rotation/regime, watchlist, and signal-vs-noise.
 *
 * IMPORTANT: this is reference material, NOT live advice. It captures the
 * *format* and the regime context of a specific episode; price levels are the
 * show's at recording time and go stale fast. Every render is dated and labelled
 * as such. Update this single file each week from the new transcript.
 */

export type Direction = "positive" | "negative" | "neutral";

export interface MacroIndicator {
  label: string;
  value: string;
  direction: Direction;
  note: string;
}

export interface PolicyItem {
  policy: string;
  detail: string;
  buckets: SectorBucket[]; // regime buckets this fans out to
  sectorKeywords: string[]; // matched against holding sectors for portfolio fan-out
  direction: Direction;
}

export interface CallReview {
  ticker: string;
  entry: string;
  target: string;
  stop: string;
  status: "hit_target" | "open" | "hit_stop";
  note: string;
}

export interface WatchItem {
  ticker: string;
  bucket: SectorBucket;
  thesis: string;
  // Earnings-quality caution surfaced verbatim by the show, when present.
  caution?: string;
}

export interface WeeklyBrief {
  episode: string;
  recordedOn: string; // ISO date
  source: string;
  topDevelopments: string[];
  marketRecap: { weeklyChangePct: number | null; note: string };
  regime: { stance: string; note: string; favored: SectorBucket[]; cautious: SectorBucket[] };
  macro: MacroIndicator[];
  budget: PolicyItem[];
  callReview: CallReview[];
  watchlist: WatchItem[];
  signalVsNoise: { signal: string[]; noise: string[] };
}

/** Most recent episode. Replace wholesale when a new transcript arrives. */
export const CURRENT_BRIEF: WeeklyBrief = {
  episode: "Bulls vs Bears — Budget week",
  recordedOn: "2026-06-13",
  source: "Sarmaya · Bulls vs Bears (YouTube)",
  topDevelopments: [
    "Federal budget FY26 (~PKR 17.1tn) announced; salaried income-tax slabs cut and several export reliefs.",
    "Inflation: CPI broadly in line with forecasts; PPI came in a touch lower — supportive for rates.",
    "Forex reserves rose (~$22.6bn) and Pakistan posted its highest-ever monthly remittances.",
    "Global IPO hype (SpaceX, Anthropic) keeping risk appetite firm into the week.",
  ],
  marketRecap: {
    weeklyChangePct: 1.13,
    note: "KSE-100 closed the week up ~1.13% ahead of the budget. Index range-bound; the show is watching a break above ~175k (closing 175–200k+) to confirm a new higher-high / trending market by Dow theory. Expect budget-day selling and quarter-end rebalancing volatility on Monday.",
  },
  regime: {
    stance: "Defensive-leaning, commodity-aware",
    note: "Through the war scare the show rotated cyclical → defensive and that helped. With oil/commodity prices firm, energy names (E&P, refineries, OMCs) screen well fundamentally even though institutions still treat them as laggards. Focus on individual strong-trend scripts over the index, always with stop-losses.",
    favored: ["defensive", "energy"],
    cautious: ["cyclical"],
  },
  macro: [
    { label: "Forex reserves", value: "≈ $22.6bn", direction: "positive", note: "Reserves rising — supportive for PKR and import cover." },
    { label: "Remittances", value: "Record high (target $42.4bn)", direction: "positive", note: "Highest-ever monthly inflow despite the war backdrop." },
    { label: "IT exports", value: "≈ $8.27bn", direction: "positive", note: "Freelance IT exports $959m Jul–Apr; structural tailwind for tech/services." },
    { label: "CPI / PPI", value: "CPI in line, PPI lower", direction: "positive", note: "Disinflation supports the rate-cut path." },
    { label: "LSM growth", value: "≈ 6.1% (FY26)", direction: "positive", note: "Large-scale manufacturing improving year on year." },
    { label: "Fertilizer offtake", value: "+8% (5M CY26)", direction: "positive", note: "Urea sales strong (FFC passes cost through)." },
    { label: "Cement dispatches", value: "−21%", direction: "negative", note: "War + summer slowdown; expected, watch for recovery on housing scheme." },
    { label: "OMC fuel sales", value: "+23% YoY (value)", direction: "neutral", note: "Driven by higher fuel prices; volumes soft as consumers cut back." },
    { label: "Trade deficit", value: "+17.5% (≈ $34.8bn)", direction: "negative", note: "Widening on the oil bill — the main macro risk if war drags on." },
  ],
  budget: [
    { policy: "Salaried income-tax relief", detail: "Top slab eased (~35% → ~32%); salaries +10%.", buckets: ["defensive", "cyclical"], sectorKeywords: ["food", "personal care", "auto", "automobile"], direction: "positive" },
    { policy: "Export Finance Scheme rate cut", detail: "Market rate slashed 19% → 4.5% — cheaper export financing.", buckets: ["cyclical"], sectorKeywords: ["textile", "spinning", "composite", "leather"], direction: "positive" },
    { policy: "Export Development Surcharge abolished", detail: "0.25% EDS removed to support exporters.", buckets: ["cyclical"], sectorKeywords: ["textile", "leather", "engineering"], direction: "positive" },
    { policy: "PM housing scheme extended", detail: "~PKR 90bn loans already approved; real-estate relief proposed.", buckets: ["cyclical"], sectorKeywords: ["cement", "steel", "real estate", "glass"], direction: "positive" },
    { policy: "Federal Excise Duty +20% (beverages)", detail: "Hits beverage margins; can't be passed to institutional clients vs Pepsi/Coke.", buckets: ["defensive"], sectorKeywords: ["food", "personal care", "beverage", "sugar"], direction: "negative" },
    { policy: "Tariff lines cut (~7,500)", detail: "Tariff rationalization — broadly positive for manufacturers' input costs.", buckets: ["cyclical", "energy"], sectorKeywords: ["engineering", "chemical", "auto", "automobile"], direction: "positive" },
    { policy: "Petroleum levy (PDL) higher", detail: "More tax to be collected via PDL next year — a consumer/cost headwind.", buckets: ["energy"], sectorKeywords: ["oil", "gas", "petroleum"], direction: "negative" },
    { policy: "Defense allocation ≈ PKR 3tn (+17%)", detail: "Larger fiscal outlay; mild crowding-out risk.", buckets: [], sectorKeywords: [], direction: "neutral" },
    { policy: "Proposed US tariffs 10–12%", detail: "Possible drag on exports; partly offset by cheaper export finance.", buckets: ["cyclical"], sectorKeywords: ["textile", "leather"], direction: "negative" },
  ],
  callReview: [
    { ticker: "BOP", entry: "32–33", target: "(open targets)", stop: "defined", status: "open", note: "Bought into the 32–33 zone; bounced to ~34.5, call intact." },
    { ticker: "PTC", entry: "≈ 51", target: "68", stop: "—", status: "hit_target", note: "Hit target, selling started after the high." },
    { ticker: "HCAR", entry: "205–208", target: "270–280", stop: "—", status: "hit_target", note: "Ran to target zone as planned." },
    { ticker: "JDWS", entry: "≈ 128 (from 133)", target: "153", stop: "—", status: "hit_target", note: "Second target 153 hit." },
  ],
  watchlist: [
    { ticker: "THCCL", bucket: "cyclical", thesis: "Thatta Cement — higher highs/lows, recently best cement performer; housing scheme + steel read-through. Long-term swing toward prior ~103 high." },
    { ticker: "GGL", bucket: "cyclical", thesis: "Holding co; subsidiaries (GCIL) strong, glass-tube share high. Bullish divergence off ~14, broke ~19 into uptrend.", caution: "Earnings boosted by a one-time gain (GCWL demerger bargain purchase) in 'other income' — base effect ends next quarter. Don't read optical EPS jump as recurring." },
    { ticker: "POWER", bucket: "cyclical", thesis: "Power Cement — score improved sharply; among the best cement picks on the show's ranking." },
    { ticker: "NETSOL", bucket: "other", thesis: "Tech/services — entered the ranking model recently (#3 by Sarmaya score); ~31% since inclusion vs ~12.6% market." },
    { ticker: "SRVI", bucket: "cyclical", thesis: "Service Industries (tyres backend) — long-standing top pick, ~47% over the window; SLM Tyres IPO oversubscribed 6.3×." },
  ],
  signalVsNoise: {
    signal: [
      "Break and close above ~175k = new higher-high → trending market (Dow theory).",
      "Commodity/oil strength → energy (E&P, refineries, OMC) earnings tailwind.",
      "Export-finance rate cut 19%→4.5% → structurally cheaper financing for exporters.",
      "Disinflation (PPI lower) → supports the rate-cut path → positive for leverage-sensitive sectors.",
    ],
    noise: [
      "Budget-day selling on Monday — typical, not thesis-changing.",
      "End-of-June quarter-end portfolio rebalancing.",
      "Summer + war-driven dip in cement dispatches — seasonal/temporary.",
      "GGL's optical EPS spike — one-time demerger gain / base effect, not recurring growth.",
    ],
  },
};
