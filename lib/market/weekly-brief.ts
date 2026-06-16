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

export interface TradeSetup {
  ticker: string;
  bucket: SectorBucket;
  stance: "buy_on_pullback" | "hold_call" | "technical_only" | "avoid_fundamental";
  setupLabel: string;
  entry: string;
  entryLow: number | null;
  entryHigh: number | null;
  stop: string;
  stopPrice: number | null;
  targets: { label: string; price: number | null }[];
  timeframe: "short_term" | "swing" | "long_term";
  technicalCase: string;
  fundamentalCase: string;
  caveat: string | null;
}

export interface IndexTechnicalMap {
  bias: "bullish" | "bearish" | "range";
  resistance: string;
  breakoutConfirmation: string;
  nearSupport: string;
  lowerGaps: string[];
  bullishEvidence: string[];
  bearishInvalidation: string[];
  playbook: string;
}

export interface StrategyRule {
  title: string;
  pattern: string;
  apply: string;
}

export interface GlobalMarketNote {
  market: string;
  bias: string;
  levels: string;
  investorRead: string;
}

export interface WeeklyBrief {
  episode: string;
  recordedOn: string; // ISO date
  source: string;
  topDevelopments: string[];
  marketRecap: { weeklyChangePct: number | null; note: string };
  regime: { stance: string; note: string; favored: SectorBucket[]; cautious: SectorBucket[] };
  indexTechnicalMap: IndexTechnicalMap;
  macro: MacroIndicator[];
  budget: PolicyItem[];
  callReview: CallReview[];
  watchlist: WatchItem[];
  tradeSetups: TradeSetup[];
  strategyRules: StrategyRule[];
  globalMarkets: GlobalMarketNote[];
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
  indexTechnicalMap: {
    bias: "bullish",
    resistance: "KSE-100 near 175k",
    breakoutConfirmation: "A close above roughly 175k-175.3k would create a fresh higher-high and confirm a trending market by Dow theory.",
    nearSupport: "169,929 gap can be tested without invalidating the broader setup.",
    lowerGaps: ["152k area", "105k-107k area"],
    bullishEvidence: [
      "Weekly EMA 21/55 structure is still constructive.",
      "Elder Force Index has not printed bearish divergence above the recent high, so the current range can behave like continuation.",
      "Daily Klinger/volume oscillator is pointing upward while the weekly signal has not fully failed.",
      "Higher-high / higher-low market structure is intact.",
    ],
    bearishInvalidation: [
      "If the daily oscillator rolls back down, the bullish stance shifts to bearish.",
      "Budget-day selling and June-end rebalancing can create short-term volatility.",
      "Global conflict headlines can delay the breakout even if the local setup remains constructive.",
    ],
    playbook: "Do not trade the index blindly inside the range. Prefer individual stocks with strong trend structure, clean scores, and defined stops; add only at pullbacks or breakouts where risk is clear.",
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
  tradeSetups: [
    {
      ticker: "THCCL",
      bucket: "cyclical",
      stance: "buy_on_pullback",
      setupLabel: "Thatta Cement pullback buy",
      entry: "63.5-64 on higher-low pullback",
      entryLow: 63.5,
      entryHigh: 64,
      stop: "56",
      stopPrice: 56,
      targets: [
        { label: "Target 1", price: 72 },
        { label: "Target 2", price: 82 },
        { label: "Swing zone", price: 95 },
        { label: "Prior high", price: 103 },
      ],
      timeframe: "swing",
      technicalCase: "Adjusted chart rallied from ~27 to ~102, retraced to the 0.786 zone, consolidated, broke 62, and is making higher highs / higher lows.",
      fundamentalCase: "Housing scheme extension and possible real-estate relief can support cement and steel demand. The show also noted the latest results improved after a weak quarter.",
      caveat: "Cement dispatches were down ~21%; near-term weakness can still happen if war/summer slowdown persists.",
    },
    {
      ticker: "GGL",
      bucket: "cyclical",
      stance: "buy_on_pullback",
      setupLabel: "GGL breakout retest",
      entry: "19.8-20 on retest",
      entryLow: 19.8,
      entryHigh: 20,
      stop: "18.50",
      stopPrice: 18.5,
      targets: [
        { label: "Target 1", price: 22 },
        { label: "Target 2", price: 23.62 },
        { label: "Stretch", price: 24 },
      ],
      timeframe: "short_term",
      technicalCase: "Price halved into ~14 during the war scare, formed bullish divergence, broke resistance near 19, and printed the first higher-low / breakout structure.",
      fundamentalCase: "Holding-company exposure to GGL and GCIL; GCIL sales are improving, GGL has meaningful domestic Chinese glass tube share, and the base-effect quarter is close to rolling off.",
      caveat: "Recent EPS was optically boosted by a one-time GCWL demerger bargain-purchase gain in other income. Treat growth as unproven until recurring earnings confirm.",
    },
    {
      ticker: "QUICE",
      bucket: "defensive",
      stance: "technical_only",
      setupLabel: "QUICE speculative technical trade",
      entry: "31-32 on correction",
      entryLow: 31,
      entryHigh: 32,
      stop: "27.70",
      stopPrice: 27.7,
      targets: [
        { label: "Target 1", price: 37 },
        { label: "Target 2", price: 39 },
      ],
      timeframe: "short_term",
      technicalCase: "After a parabolic run from ~9 to ~45, price retraced, consolidated around 20-25, then rallied again without bearish divergence. The technical plan waits for a pullback to 31-32.",
      fundamentalCase: "Revenue is improving and local carbonated drink volumes grew, but the company is still not fundamentally clean.",
      caveat: "The fundamental view was cautious: losses, weak valuation comfort, and a 20% FED hit that cannot easily be passed to institutional clients.",
    },
  ],
  strategyRules: [
    {
      title: "Rotation first, then stock selection",
      pattern: "When uncertainty rises, money rotates from cyclicals to defensives. When risk appetite returns, cyclicals lead. When oil or commodities rise, energy can lead even if the index is mixed.",
      apply: "Check your holdings by bucket. Add only where the bucket is leading or the company has a strong score plus a clean setup.",
    },
    {
      title: "Ranking narrows the universe",
      pattern: "The team shortlists top-ranked names first, then studies the business and chart. The score is not the trade; it is the filter.",
      apply: "Prioritize top-50 score names, then inspect growth, quality, momentum, and earnings quality before buying.",
    },
    {
      title: "Do not trust optical EPS",
      pattern: "One-time gains and base effects can make EPS look explosive while recurring operations are still ordinary.",
      apply: "If EPS growth is extreme, require clean operating revenue, margins, and next-quarter confirmation before treating it as a real growth stock.",
    },
    {
      title: "Price levels define risk",
      pattern: "Even bullish setups use entry zones and stop-losses. A good company bought at the wrong place can still be a bad trade.",
      apply: "For each recommendation, compare current price with the entry zone, stop, and targets. Avoid chasing after target 1 without a new setup.",
    },
  ],
  globalMarkets: [
    {
      market: "Global risk appetite",
      bias: "Supportive",
      levels: "SpaceX / Anthropic IPO hype; broad institutional risk appetite still firm.",
      investorRead: "Helpful backdrop for equities, but not enough to override local PSX sector rotation.",
    },
    {
      market: "Gold",
      bias: "Short-term sell strength; long-term hold/value-buy",
      levels: "Resistance 4270 / 4295 / 4400; support 4105 then 4030; long-term value area possibly 3700-3600.",
      investorRead: "Short-term traders were told to sell bounces with defined risk; long-term holders can tolerate the correction if their horizon is multi-month.",
    },
    {
      market: "FOMC / dollar",
      bias: "Event risk",
      levels: "Next week is FOMC week; dollar weakness can create a gold bounce into resistance.",
      investorRead: "Expect spikes. Use smaller risk per trade and avoid confusing event volatility with thesis confirmation.",
    },
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
