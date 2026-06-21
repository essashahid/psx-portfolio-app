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
  episode: "Bulls vs Bears — Ceasefire rally & cyclical rotation",
  recordedOn: "2026-06-20",
  source: "Sarmaya · Bulls vs Bears (YouTube)",
  topDevelopments: [
    "US–Iran ceasefire extended; Strait of Hormuz to stay open ~60 days — global + PSX markets rallied, KSE-100 up ~3.5–3.7% on the week.",
    "State Bank held the policy rate at 11.5% and warned inflation may stay double-digit for a few more months.",
    "Current account swung to a ~$459m surplus in May; forex reserves expected to reach ~$18bn this month.",
    "Sales tax waived on capital-goods imports for refinery upgrades; petrol cut Rs4/litre and diesel Rs2/litre.",
    "Now the war risk has eased, the show expects rotation back into cyclicals (cement, steel, autos) — new auto policy still awaited.",
  ],
  marketRecap: {
    weeklyChangePct: 3.6,
    note: "KSE-100 closed the week up ~3.5–3.7% on the US–Iran ceasefire extension and the positive budget. The index printed a new higher-high near 182,194; an ideal higher-low pullback would be ~175,000, with upside targets toward ~190,000. A strong June–December seasonal pattern (≈60–65% rallies three years running) is in play.",
  },
  regime: {
    stance: "Cyclical rotation resuming (risk-on), commodity-aware",
    note: "Through the war scare the show rotated cyclical → defensive and that helped. With the ceasefire extended and the Strait of Hormuz open, the call is now to rotate back into cyclicals — cement, steel and autos are expected to start performing (await the new auto policy). Energy (E&P, refineries, OMCs) still screens well on firm oil plus improving receivable collection. Defensives (DCR, fertilizers) remain fine for income, but leadership is shifting. Favor individual strong-trend scripts over the index, always with stops.",
    favored: ["cyclical", "energy"],
    cautious: ["defensive"],
  },
  indexTechnicalMap: {
    bias: "bullish",
    resistance: "KSE-100 printed a new high near 182,194; next upside targets toward ~190,000.",
    breakoutConfirmation: "A fresh higher-high is already in place at ~182,194; on the June–December seasonal, even a conservative continuation implies another ~30% upside.",
    nearSupport: "An ideal higher-low pullback would be around 175,000 — healthy, not a thesis break.",
    lowerGaps: ["Unfilled gaps below (filling them would strengthen the foundation for a longer rally)"],
    bullishEvidence: [
      "Weekly EMA 21/55 structure keeps providing support.",
      "Elder Force Index bullish divergence intact — no bearish divergence has printed since.",
      "Weekly Klinger crossover with the daily oscillator also strongly bullish (signals aligned).",
      "Higher-high / higher-low Dow-theory structure is intact.",
      "Seasonality: June–Dec rallied ~60–65% for three straight years; KSE-100 has closed the late-June window up 12 of the last 15 years.",
    ],
    bearishInvalidation: [
      "A weekly bearish divergence exists but currently has limited significance.",
      "Unfilled gaps below could be filled on a pullback.",
      "A single top is forming; if the daily oscillator rolls over, the bullish stance weakens.",
    ],
    playbook: "Do not trade the index blindly. Long-term investors should buy good, well-known KSE-100 leaders at attractive levels on any dip and position for the next ~6 months; traders prefer individual strong-trend scripts with clean scores and defined stops.",
  },
  macro: [
    { label: "Policy rate", value: "Held at 11.5%", direction: "neutral", note: "Held as expected; SBP won't cut while oil-driven inflation is a concern, but room opens as inflation eases." },
    { label: "Inflation outlook", value: "Double-digit risk", direction: "negative", note: "SBP warns CPI may stay in double digits a few more months on the lagged oil pass-through." },
    { label: "Current account", value: "+$459m surplus (May)", direction: "positive", note: "Swung to surplus — a stabilising sign even if exports could be higher." },
    { label: "Forex reserves", value: "≈ $18bn (expected)", direction: "positive", note: "SBP reserves expected to reach ~$18bn this month and keep rising." },
    { label: "LSM growth", value: "≈ 6.44% YoY (Jul–Apr)", direction: "positive", note: "Large-scale manufacturing improving year on year." },
    { label: "REER", value: "≈ 116.2 (7-yr high)", direction: "negative", note: "Rupee looks overvalued; a modest ~4–5% PKR depreciation (USD ~290–300) is plausible, but the SBP manages the pace." },
    { label: "IT exports", value: "+13% YoY (May)", direction: "positive", note: "Structural tailwind for tech/services exporters." },
    { label: "FDI", value: "−28% to $1.623bn", direction: "negative", note: "Inward foreign investment comparatively weak." },
    { label: "Imports", value: "+4.6% YoY to $5.7bn (May)", direction: "neutral", note: "Rose mainly on the oil bill; needs balancing with export growth." },
    { label: "Fuel prices", value: "Petrol −Rs4, diesel −Rs2", direction: "positive", note: "Small cut despite a larger drop in international oil; further reductions possible." },
  ],
  budget: [
    { policy: "Refinery capital-goods sales-tax waiver", detail: "Sales tax waived on imports of capital goods/machinery for refinery upgrades.", buckets: ["energy"], sectorKeywords: ["refin", "oil", "gas", "petroleum"], direction: "positive" },
    { policy: "Export-refinance scheme + export incentives", detail: "New export-refinance scheme and strong budget incentives for exporters.", buckets: ["cyclical"], sectorKeywords: ["textile", "leather", "food", "engineering"], direction: "positive" },
    { policy: "Exporter tax-regime relief", detail: "Several burdens (fixed-tax exit to 29% normal regime, super/minimum tax) reduced or abolished for export companies — direct beneficiary: TOMCL.", buckets: ["cyclical", "defensive"], sectorKeywords: ["food", "textile", "leather"], direction: "positive" },
    { policy: "Salaried income-tax relief", detail: "Top slab eased and salaries +10% — supports consumption.", buckets: ["defensive", "cyclical"], sectorKeywords: ["food", "personal care", "auto", "automobile"], direction: "positive" },
    { policy: "Apna Ghar housing finance for expatriates", detail: "Overseas/non-resident Pakistanis now eligible for Apna Ghar financing — supports housing-linked demand.", buckets: ["cyclical"], sectorKeywords: ["cement", "steel", "real estate", "glass"], direction: "positive" },
    { policy: "Fuel price cut (petrol −Rs4, diesel −Rs2)", detail: "Consumer relief; eases transport/input costs.", buckets: ["cyclical"], sectorKeywords: ["auto", "automobile", "transport"], direction: "positive" },
    { policy: "Petroleum levy (PDL) higher", detail: "More tax collected via PDL — a consumer/cost headwind.", buckets: ["energy"], sectorKeywords: ["oil", "gas", "petroleum"], direction: "negative" },
  ],
  callReview: [
    { ticker: "MTL", entry: "≈ 550", target: "640 / 650", stop: "—", status: "hit_target", note: "Reached targets; a stock split on Friday will lower the quoted price while shares increase." },
    { ticker: "MLCF", entry: "≈ 90", target: "100", stop: "—", status: "hit_target", note: "Maple Leaf Cement hit the first target 100; second target remains valid." },
    { ticker: "GHNI", entry: "≈ 880", target: "990", stop: "—", status: "hit_target", note: "First target 990 reached; call valid for the second target." },
    { ticker: "SSGC", entry: "26.2", target: "30.5 / 36", stop: "—", status: "hit_target", note: "Sui Southern Gas hit first target 30.5; second target 36 remains valid." },
    { ticker: "GGL", entry: "≈ 20 (18.9–20)", target: "24", stop: "—", status: "hit_target", note: "Did not retest entry before running; reached the 24 resistance/second TP. Reconsider near 18.9–20 if available." },
    { ticker: "THCCL", entry: "(prior levels)", target: "(prior targets)", stop: "—", status: "open", note: "Thatta Cement call still valid at previously given buying levels; performing well." },
  ],
  watchlist: [
    { ticker: "OGDC", bucket: "energy", thesis: "Top E&P pick and a mutual-fund favourite (~118 funds). 6.5-yr high oil output (>40k bpd, ~48k targeted by Dec), Baragzai discovery (~100m boe), reserve-replacement ~153%, cash/share ~Rs64. Receivables being released under IMF pressure → reinvested into exploration.", caution: "Still owed ~Rs598bn (~Rs140/share) in receivables; realised prices swing with oil and the USD." },
    { ticker: "TOMCL", bucket: "defensive", thesis: "The Organic Meat Co — GCC route reopening as the Strait of Hormuz opens; exporter tax relief beneficiary; Tajikistan/UAE/Kuwait expansion; ~70% of exports to GCC; targeting debt-free by 2027–28; solar at Korangi/Gadap.", caution: "Recent EPS weak on war/Eid shipment disruptions and raw-material investment; Sarmaya ranking soft for now." },
    { ticker: "PSO", bucket: "energy", thesis: "Energy-marketing leader (~42.6% share, ~99% jet fuel); undervalued vs last year's high; rolling out EV charging + solar.", caution: "Thin OMC margins make earnings swing with inventory gains/losses; next quarter may soften as oil falls. Very large receivables (SNGPL ~Rs286bn, GENCO-III ~Rs68bn, PDC ~Rs24bn, ST refund ~Rs75bn) and heavy debt." },
    { ticker: "NCPL", bucket: "defensive", thesis: "Nishat Chunian Power — value-buy after bullish divergence/accumulation; cash/share ~Rs32 vs price ~65. ~33% stake in Nexgen Auto (JAECOO) adds meaningful earnings on top of the core power business; capacity-payment recognition flipped earnings positive.", caution: "~Rs2.6bn receivable (~Rs2bn overdue) from CPPA; power-contract renegotiation can lower headline revenue. Related name: NPL." },
    { ticker: "FATIMA", bucket: "defensive", thesis: "Fatima Fertilizer — DAP-concentrated blue chip with a top Sarmaya ranking; diversified group (Silk Islamic REIT ~20%, Fatima Petroleum exploration blocks, Balochistan mining). Good swing vehicle; better Kharif expected.", caution: "DAP output hit by high sulphur prices / phosphoric-acid supply; for buy-and-hold the show prefers FFC (urea + DAP after the FFBL acquisition)." },
    { ticker: "DCR", bucket: "defensive", thesis: "Dolmen City REIT — stable defensive with ~8–10% dividend yield; Dolmen Mall + Harbour Front at 100% occupancy, ~10% annual rent escalation, shifting ~50% of tenants to revenue-sharing. Ideal for SIP / cautious investors." },
  ],
  tradeSetups: [
    {
      ticker: "OGDC",
      bucket: "energy",
      stance: "buy_on_pullback",
      setupLabel: "OGDC breakout / support hold",
      entry: "330-332 (old resistance now support)",
      entryLow: 330,
      entryHigh: 332,
      stop: "312",
      stopPrice: 312,
      targets: [
        { label: "Target 1", price: 355 },
        { label: "Target 2", price: 376 },
      ],
      timeframe: "swing",
      technicalCase: "Traded above the 332–334 resistance and held the 330–332 area as new support. An ABCD pattern (250→332 rally, retrace to C ~296) projects ~376 while the 312 stop holds.",
      fundamentalCase: "Strong E&P and mutual-fund favourite. 6.5-yr high oil output (>40k bpd, ~48k targeted by Dec), Baragzai discovery (~100m boe), reserve-replacement ~153%, cash/share ~Rs64, and receivables now being released (IMF pressure) to reinvest into exploration.",
      caveat: "Still owed ~Rs598bn (~Rs140/share); earnings swing with international oil prices and the USD rate.",
    },
    {
      ticker: "PSO",
      bucket: "energy",
      stance: "buy_on_pullback",
      setupLabel: "PSO accumulation-base buy",
      entry: "≈ 356 support",
      entryLow: 352,
      entryHigh: 358,
      stop: "327",
      stopPrice: 327,
      targets: [
        { label: "Target 1", price: 390 },
        { label: "Target 2", price: 430 },
      ],
      timeframe: "swing",
      technicalCase: "Bullish divergence then sideways accumulation around 356 support; a similar base in 2025 ran from ~330 to 494. Tends to perform in the final six months of the year.",
      fundamentalCase: "Energy-marketing leader (~42.6% share, ~99% jet fuel) and undervalued vs last year's high; rolling out EV charging and solar.",
      caveat: "Thin OMC margins mean inventory gains/losses drive earnings; next quarter may weaken as oil falls. Very large receivables and heavy debt.",
    },
    {
      ticker: "TOMCL",
      bucket: "defensive",
      stance: "buy_on_pullback",
      setupLabel: "TOMCL trend-continuation swing",
      entry: "40-40.5 support",
      entryLow: 40,
      entryHigh: 40.5,
      stop: "37.56",
      stopPrice: 37.56,
      targets: [
        { label: "Target 1", price: 48 },
        { label: "Target 2", price: 56 },
      ],
      timeframe: "swing",
      technicalCase: "Bullish divergence into an uptrend of higher highs/lows; 40–40.50 (old resistance) now acts as support. First resistance ~47.8–48, then ~56.",
      fundamentalCase: "GCC export route reopening as the Strait of Hormuz opens; exporter tax-relief beneficiary; expanding into Tajikistan/UAE/Kuwait; targeting debt-free by 2027–28; adding solar.",
      caveat: "Recent EPS weak on war/Eid shipment disruptions and raw-material investment; Sarmaya ranking soft until numbers recover.",
    },
    {
      ticker: "NCPL",
      bucket: "defensive",
      stance: "buy_on_pullback",
      setupLabel: "NCPL value-buy off accumulation",
      entry: "≈ 65 (support 62.6)",
      entryLow: 62.6,
      entryHigh: 65,
      stop: "59",
      stopPrice: 59,
      targets: [
        { label: "Target 1", price: 76 },
        { label: "Target 2", price: 84 },
      ],
      timeframe: "swing",
      technicalCase: "Bullish divergence then sideways accumulation; support holds ~62.6. First resistance ~76, second ~84.",
      fundamentalCase: "Cash/share ~Rs32 vs price ~65. ~33% stake in Nexgen Auto (JAECOO) adds meaningful earnings on the core power business; capacity-payment recognition flipped earnings positive.",
      caveat: "~Rs2.6bn receivable (~Rs2bn overdue) from CPPA; power-contract renegotiation can lower headline revenue. Payment notification would be the trigger.",
    },
    {
      ticker: "FATIMA",
      bucket: "defensive",
      stance: "buy_on_pullback",
      setupLabel: "Fatima breakout retest",
      entry: "158-160 buy zone",
      entryLow: 158,
      entryHigh: 160,
      stop: "150",
      stopPrice: 150,
      targets: [
        { label: "Target 1", price: 185 },
      ],
      timeframe: "long_term",
      technicalCase: "Found support at the ~120 Fibonacci golden pocket, formed a bullish divergence, broke ~150 and is retesting it. 158–160 is a good buy zone toward ~185; no clear top yet.",
      fundamentalCase: "DAP-concentrated blue chip with a top Sarmaya ranking; diversified group (Silk Islamic REIT ~20%, Fatima Petroleum exploration blocks, Balochistan mining); better Kharif expected.",
      caveat: "DAP output hit by high sulphur prices / phosphoric-acid supply. For pure buy-and-hold the show prefers FFC (urea + DAP after FFBL).",
    },
    {
      ticker: "DCR",
      bucket: "defensive",
      stance: "buy_on_pullback",
      setupLabel: "DCR defensive income hold / SIP",
      entry: "Accumulate on dips (low volume; SIP-style)",
      entryLow: null,
      entryHigh: null,
      stop: "32",
      stopPrice: 32,
      targets: [
        { label: "Target", price: 41 },
      ],
      timeframe: "long_term",
      technicalCase: "REIT that mostly consolidates sideways; weekly chart still shows higher highs/lows. As a swing, stop ~32 toward ~41; better suited to SIP-style accumulation than active trading.",
      fundamentalCase: "~8–10% dividend yield from Dolmen Mall + Harbour Front at 100% occupancy, ~10% annual rent escalation, ~50% of tenants moving to revenue-sharing. Rose ~Rs12 → ~41 since 2024 plus quarterly dividends.",
      caveat: "Earlier profit spike was an unrealised investment-property revaluation gain; reported earnings have normalised to the operating business. Low volumes limit active trading.",
    },
  ],
  strategyRules: [
    {
      title: "Rotation first, then stock selection",
      pattern: "When uncertainty rises, money rotates from cyclicals to defensives. When the war risk eases and risk appetite returns, cyclicals (cement, steel, autos) lead again. When oil/commodities are firm, energy can lead even if the index is mixed.",
      apply: "Check your holdings by bucket. With the ceasefire extended, lean toward cyclicals and strong-trend energy where the score and setup are clean.",
    },
    {
      title: "Ranking narrows the universe",
      pattern: "The team shortlists top-ranked names (Sarmaya Aggressive Ranking) first, then studies the business and chart. The score is the filter, not the trade.",
      apply: "Prioritize top-50 score names, then inspect growth, quality, momentum, and earnings quality before buying.",
    },
    {
      title: "Watch receivables on energy/power names",
      pattern: "OGDC, PSO and NCPL all carry very large receivables. Collection (IMF pressure, CPPA settlements) frees cash for exploration/expansion and can re-rate the stock; delays cap it.",
      apply: "For energy/power holdings, treat any payment/collection notification as a potential trigger — and size for the risk that cash stays stuck.",
    },
    {
      title: "Seasonality + price levels define risk",
      pattern: "June–December has rallied ~60–65% three years running, and the late-June US/KSE window is historically strong — but every setup still uses an entry zone and stop.",
      apply: "Use the seasonal tailwind to favour dip-buying, but compare current price with the entry zone, stop, and targets. Don't chase past target 1 without a fresh setup.",
    },
  ],
  globalMarkets: [
    {
      market: "Gold",
      bias: "Short remains open; long setup only on a 4026 break",
      levels: "Short from ~4295 (stop now break-even), target 4105 valid. New long only if price breaks the 4026 low and prints a green 4h candle: stop ~3875, targets retest 4295 then 4400.",
      investorRead: "Seasonal still down through June. Book the short near 4105, then wait for the divergence + green candle before going long — don't pre-empt it.",
    },
    {
      market: "NASDAQ 100",
      bias: "Buy dips (uptrend intact)",
      levels: "Old resistance now support; buy near 29,995 or the 29,700–29,800 retest, range 30,000–30,600, sell strength near 30,600. Uptrend holds while 29,120 is unbroken.",
      investorRead: "Strong late-June seasonal: June 28–July 15 closed green 100% of the last 13 years across NASDAQ/S&P/Russell. Favour buy-on-dips.",
    },
    {
      market: "FOMC / dollar",
      bias: "Event risk; dollar strong but may soften",
      levels: "New Fed chair Warsh hinted at ending forward guidance and the dot plot — initial sharp drop then a strong reversal next day.",
      investorRead: "Dollar score still strong but likely to weaken; SpaceX and other large IPO pipeline keeps institutional risk appetite firm. Expect spikes — smaller risk per trade.",
    },
    {
      market: "GBP/USD",
      bias: "Reversal-long on breakout",
      levels: "1h bullish divergence; buy-stop above ~1.32600 (resistance ~1.3250), stop 1.31600 (~100 pips), targets 1.33230 then 1.33825.",
      investorRead: "Seasonally up ~3–4 days then a sharper drop. May consolidate 1–2 days before breaking; the dollar's strength is the main risk to the setup.",
    },
    {
      market: "Crypto",
      bias: "Range-bound, fearful",
      levels: "Total mcap ~$2.24tn (−2%); Fear & Greed ~14. TON (~$60m) and Humanity (~$64m) unlocks on Jun 23–24 add supply. Watch WLD (~0.54–0.558, stop 0.45) and BTW (~0.056–0.0596, stop 0.039).",
      investorRead: "BTC/ETH stuck in a zone; small/mid-cap alts and staking/AI-niche names show relative strength. Buy dips on watchlist names, mind the unlocks, avoid leverage.",
    },
  ],
  signalVsNoise: {
    signal: [
      "US–Iran ceasefire + Strait of Hormuz open ~60 days → risk-on; rotation back into cyclicals (cement, steel, autos).",
      "New higher-high at ~182,194 plus the June–Dec seasonal (~60–65% three years running) → trend-continuation bias toward ~190k.",
      "Refinery capital-goods sales-tax waiver → input-cost tailwind for the refinery sector.",
      "OGDC/PSO/NCPL receivable collection improving (IMF pressure, CPPA) → frees cash → potential re-rating.",
    ],
    noise: [
      "PSO's likely next-quarter inventory loss as oil falls — anticipated and temporary.",
      "Crypto Fear & Greed at 14 plus TON/Humanity token unlocks — short-term supply pressure, not a trend.",
      "REER at a 7-yr high implying a modest ~4–5% PKR adjustment — managed, not an abrupt devaluation.",
      "TOMCL's soft recent EPS — war/Eid shipment disruption, not structural deterioration.",
    ],
  },
};
