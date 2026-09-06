import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAlerts } from "@/lib/alerts/refresh";

/**
 * Demo dataset for the shared, read-only public demo workspace.
 *
 * The goal is that a first-time visitor sees a realistic, fully populated PSX
 * portfolio: eight blue-chip positions across seven sectors, a six-month value
 * history, a portfolio-vs-KSE-100-vs-inflation growth series, received and
 * upcoming dividends, theses, journal entries, news and a library of curated
 * Research Copilot threads written in the real assistant's voice.
 *
 * Prices are anchored to the real PSX close (June 2026) so the inline price
 * charts, which pull live end-of-day data, agree with the position values and
 * metric strips shown next to them. Cost bases reflect multi-year entries in a
 * strong market. Every derived figure (weights, P/L, yields, benchmark excess,
 * macro reads) is internally consistent, so no screen contradicts another.
 */

// ── Holdings ──────────────────────────────────────────────────────────────────
// price ~ real PSX close; avg_cost is the illustrative multi-year entry.
const DEMO_HOLDINGS = [
  { ticker: "MEBL", company_name: "Meezan Bank Limited", sector: "Commercial Banks", quantity: 400, avg_cost: 330.0, price: 516.0 },
  { ticker: "UBL", company_name: "United Bank Limited", sector: "Commercial Banks", quantity: 450, avg_cost: 300.0, price: 448.0 },
  { ticker: "FFC", company_name: "Fauji Fertilizer Company Limited", sector: "Fertilizer", quantity: 250, avg_cost: 420.0, price: 573.0 },
  { ticker: "OGDC", company_name: "Oil & Gas Development Company Limited", sector: "Oil & Gas Exploration", quantity: 500, avg_cost: 275.0, price: 335.0 },
  { ticker: "SYS", company_name: "Systems Limited", sector: "Technology & Communication", quantity: 1000, avg_cost: 95.0, price: 147.0 },
  { ticker: "LUCK", company_name: "Lucky Cement Limited", sector: "Cement", quantity: 250, avg_cost: 350.0, price: 470.0 },
  { ticker: "HUBC", company_name: "The Hub Power Company Limited", sector: "Power Generation & Distribution", quantity: 500, avg_cost: 265.0, price: 233.0 },
  { ticker: "ENGROH", company_name: "Engro Holdings Limited", sector: "Conglomerate", quantity: 450, avg_cost: 320.0, price: 288.0 },
];

const DEMO_CHAT_SUMMARY_PREFIX = "Demo library:";
const DEMO_DIVIDEND_EVENT_PREFIX = "demo:";

// News rows now carry their real outlet as `source` (Business Recorder, Arab
// News, etc.) rather than a "Demo Data" placeholder, so cleanup can no longer
// key off source alone, that would also catch real articles the news-refresh
// cron fetches for this account. These URLs are the stable identifier instead.
const DEMO_NEWS_URLS = [
  "https://www.brecorder.com/news/40427135",
  "https://www.arabnews.com/node/2647548",
  "https://www.brecorder.com/news/40410294",
  "https://profit.pakistantoday.com.pk/2026/05/05/pakistans-cement-despatches-rise-11-14-in-april-on-strong-local-demand/",
  "https://tradingeconomics.com/pakistan/interest-rate",
];

/** Number of curated chat threads. The demo session re-seeds if fewer exist. */
export const DEMO_THREAD_COUNT = 9;

const H = (t: string) => DEMO_HOLDINGS.find((h) => h.ticker === t)!;
const pl = (h: (typeof DEMO_HOLDINGS)[number]) => Math.round((h.price - h.avg_cost) * h.quantity);
const marketValue = (h: (typeof DEMO_HOLDINGS)[number]) => Math.round(h.price * h.quantity);
const retPct = (h: (typeof DEMO_HOLDINGS)[number]) => ((h.price - h.avg_cost) / h.avg_cost) * 100;

export async function loadDemoData(supabase: SupabaseClient, userId: string) {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await clearDemoRows(supabase, userId);

  const totalCost = DEMO_HOLDINGS.reduce((s, h) => s + h.quantity * h.avg_cost, 0);
  const totalValue = DEMO_HOLDINGS.reduce((s, h) => s + marketValue(h), 0);

  // ── Holdings + short recent price history ────────────────────────────────
  for (const h of DEMO_HOLDINGS) {
    await supabase.from("holdings").upsert(
      {
        user_id: userId,
        ticker: h.ticker,
        company_name: h.company_name,
        sector: h.sector,
        quantity: h.quantity,
        avg_cost: h.avg_cost,
        total_cost: h.quantity * h.avg_cost,
        source: "demo",
      },
      { onConflict: "user_id,ticker" }
    );
    // A few months of weekly closes so the valuation has a trend. Today's close
    // is exact so the dashboard total matches the seeded series and the live
    // chart. (The inline price-chart artifacts use live PSX candles directly.)
    for (let week = 13; week >= 0; week -= 1) {
      const ramp = 0.91 + (0.09 * (13 - week)) / 13;
      const noise = week === 0 ? 1 : 1 + (((h.ticker.charCodeAt(0) + week) % 5) - 2) * 0.004;
      await supabase.from("prices").upsert(
        {
          user_id: userId,
          ticker: h.ticker,
          price: Math.round(h.price * ramp * noise * 100) / 100,
          price_date: daysAgo(week * 7),
          source: "demo",
        },
        { onConflict: "user_id,ticker,price_date" }
      );
    }
  }

  // ── Targets (target_price above current, review_level below) ──────────────
  const targets = [
    { ticker: "MEBL", target_price: 620, target_allocation: 16, review_level: 440 },
    { ticker: "UBL", target_price: 540, target_allocation: 14, review_level: 380 },
    { ticker: "FFC", target_price: 680, target_allocation: 12, review_level: 500 },
    { ticker: "OGDC", target_price: 400, target_allocation: 13, review_level: 290 },
    { ticker: "SYS", target_price: 185, target_allocation: 14, review_level: 120 },
    { ticker: "LUCK", target_price: 560, target_allocation: 10, review_level: 400 },
    { ticker: "HUBC", target_price: 270, target_allocation: 8, review_level: 210 },
    { ticker: "ENGROH", target_price: 340, target_allocation: 9, review_level: 260 },
  ];
  for (const t of targets) {
    await supabase.from("targets").upsert({ user_id: userId, ...t }, { onConflict: "user_id,ticker" });
  }

  // ── Theses (ENGROH intentionally left without one for the alert) ──────────
  const theses = [
    {
      ticker: "MEBL",
      why_bought: "Largest Islamic bank in Pakistan with structurally higher deposit growth, a strong CASA mix and best-in-class ROE among listed banks.",
      expectation: "Deposit growth and a low-cost current account base keep return on equity above peers through a falling rate cycle.",
      time_horizon: "3-5 years",
      key_risks: "Rapid policy-rate cuts compressing spreads faster than volume growth offsets; changes to the Islamic banking framework.",
      sell_conditions: "ROE falls below 20% for two consecutive years, or deposit growth slips below the sector average.",
      add_conditions: "Price weakness on macro fears while deposit growth and asset quality stay intact.",
      confidence: 5,
      status: "Active",
      review_date: daysAgo(-45),
    },
    {
      ticker: "UBL",
      why_bought: "Large, well-capitalised bank with a high dividend payout and improving cost discipline. Held alongside MEBL for income within the banking sleeve.",
      expectation: "Sustained double-digit payout yield with modest book-value growth as the balance sheet re-prices.",
      time_horizon: "3-5 years",
      key_risks: "Rate cuts narrowing margins; rising credit costs if the macro picture weakens.",
      sell_conditions: "Payout cut without a clear reinvestment case, or a sustained jump in the cost-to-income ratio.",
      add_conditions: "Yield above 12% with the payout still covered by earnings.",
      confidence: 4,
      status: "Active",
      review_date: daysAgo(-30),
    },
    {
      ticker: "FFC",
      why_bought: "Dominant urea producer with pricing power, a reliable cash dividend and a stronger balance sheet after the FFBL consolidation.",
      expectation: "Stable urea offtake and a high payout support total return even in a flat market.",
      time_horizon: "2-4 years",
      key_risks: "Gas pricing interventions, urea price caps and weather-driven demand swings.",
      sell_conditions: "Dividend payout materially cut, or sustained gas curtailment.",
      add_conditions: "Forward yield above 9% with the payout intact.",
      confidence: 4,
      status: "Active",
      review_date: daysAgo(-60),
    },
    {
      ticker: "OGDC",
      why_bought: "Largest exploration and production company, deeply discounted on a price-to-earnings and price-to-book basis, with reserves and a US-dollar-linked revenue stream.",
      expectation: "Re-rating as circular-debt receivables are settled, plus a steady dividend in the meantime.",
      time_horizon: "2-4 years",
      key_risks: "Circular debt locking up cash; flat production; oil-price weakness.",
      sell_conditions: "A structural fall in production with no offsetting discoveries, or receivables that keep climbing for years.",
      add_conditions: "Confirmed progress on receivable settlement while the valuation stays in the bottom quartile.",
      confidence: 3,
      status: "Active",
      review_date: daysAgo(-20),
    },
    {
      ticker: "SYS",
      why_bought: "Pakistan's largest IT exporter and a US-dollar revenue hedge against rupee depreciation, with a long runway in export markets.",
      expectation: "Export revenue growth above 20% a year and margin recovery as utilisation improves.",
      time_horizon: "5+ years",
      key_risks: "Wage inflation, client concentration in the Middle East and a global IT-spending slowdown.",
      sell_conditions: "Export growth below 10% for a full year, or sustained margin erosion.",
      add_conditions: "A broad market sell-off pushing the valuation below 15x earnings while growth holds.",
      confidence: 5,
      status: "Active",
      review_date: daysAgo(-90),
    },
    {
      ticker: "LUCK",
      why_bought: "Lowest-cost cement producer with a diversified holding structure spanning autos, chemicals and power. A geared play on the domestic capex and housing cycle.",
      expectation: "Margin and volume recovery as interest rates fall and construction activity picks up.",
      time_horizon: "3-5 years",
      key_risks: "A delayed rate-cut cycle, coal-cost inflation and overcapacity in the cement sector.",
      sell_conditions: "A fresh wave of industry capacity additions that crushes pricing for more than a year.",
      add_conditions: "Confirmation that domestic dispatches are recovering while the balance sheet stays clean.",
      confidence: 4,
      status: "Active",
      review_date: daysAgo(-15),
    },
    {
      ticker: "HUBC",
      why_bought: "Cheap cash flows from power purchase agreements plus optionality on Thar coal and new energy ventures.",
      expectation: "The quarterly payout holds while dividends from the Thar and CPHGC associates replace the shrinking legacy PPA earnings.",
      time_horizon: "2-3 years",
      key_risks: "Legacy PPA revenue rolling off faster than associate income grows; circular debt delaying cash; capex into new ventures diluting returns.",
      sell_conditions: "A payout cut, or evidence the associate dividend stream cannot fund it once the base plant contribution fades.",
      add_conditions: "Two more quarters showing associate income fully covering the PKR 5 per share quarterly payout.",
      confidence: 2,
      status: "Weakening",
      review_date: daysAgo(3), // intentionally overdue -> generates a review alert
    },
    // ENGROH intentionally has NO thesis -> generates a missing-thesis alert
  ];
  for (const t of theses) {
    await supabase.from("theses").upsert({ user_id: userId, ...t }, { onConflict: "user_id,ticker" });
  }

  // ── Journal ────────────────────────────────────────────────────────────────
  const journal = [
    {
      ticker: "SYS",
      entry_date: daysAgo(8),
      entry_type: "news_reaction",
      title: "IT exports hit a record USD 4.2 billion in 11MFY26",
      body: "Sector exports reached USD 4.2 billion in the first eleven months of FY26, up about 20% year on year, with December's USD 437 million the first month ever above USD 400 million. Reinforces the dollar-revenue thesis for SYS. No action needed, staying the course and watching utilisation and the wage bill.",
      confidence: 5,
      source: "demo",
    },
    {
      ticker: "HUBC",
      entry_date: daysAgo(18),
      entry_type: "hold_review",
      title: "HUBC thesis downgraded to weakening",
      body: "The quarterly PKR 5 per share payout is being maintained, but the mix behind it has changed: legacy PPA revenue is declining and the payout increasingly rests on dividends from the Thar and CPHGC associates. That is not the contracted-cash-flow case I originally bought. Moved the thesis to Weakening. I will decide at the next review whether the associate-income version of the story deserves this capital or whether it is better placed in OGDC.",
      expected_outcome: "Two quarters of results showing whether associate income can carry the payout on its own.",
      risk: "Capital tied up in a position whose original thesis no longer holds.",
      confidence: 2,
      follow_up_date: daysAgo(-7),
      source: "demo",
    },
    {
      ticker: "LUCK",
      entry_date: daysAgo(26),
      entry_type: "buy_decision",
      title: "Added to LUCK ahead of the rate-cut cycle",
      body: "Topped up the cement position. The thesis is simple: lowest-cost producer, clean balance sheet, and a domestic capex recovery that should arrive as rates fall. Sized it so cement stays under the sector cap.",
      expected_outcome: "Volume and margin recovery over the next twelve to eighteen months.",
      risk: "A delayed rate cut, or coal-cost inflation eating the margin recovery.",
      confidence: 4,
      source: "demo",
    },
    {
      ticker: "MEBL",
      entry_date: daysAgo(52),
      entry_type: "buy_decision",
      title: "Started MEBL after a strong results print",
      body: "Bought 400 shares after a strong quarter. Deposit growth near 18% year on year and ROE above 25%. Valuation still reasonable relative to the growth and the quality of the deposit base.",
      expected_outcome: "Re-rating toward a higher book multiple as the deposit franchise compounds.",
      risk: "A rate-cut cycle compressing spreads faster than deposit growth offsets.",
      confidence: 5,
      source: "demo",
    },
    {
      ticker: "OGDC",
      entry_date: daysAgo(9),
      entry_type: "news_reaction",
      title: "Circular debt settlement plan completed",
      body: "OGDC received the final PKR 7.7 billion interest instalment on 24 June, completing the PKR 92 billion interest schedule on top of the PKR 82 billion principal already paid. The receivable overhang that justified the discount is now materially smaller. The question shifts from whether the government pays to what management does with the cash: higher payout, exploration capex, or both. Holding, and will reassess the position size once the next payout announcement shows their intent.",
      confidence: 4,
      source: "demo",
    },
  ];
  for (const j of journal) {
    await supabase.from("journal_entries").insert({ user_id: userId, ...j });
  }

  // ── News ────────────────────────────────────────────────────────────────────
  const news = [
    {
      ticker: "OGDC",
      company_name: "Oil & Gas Development Company Limited",
      sector: "Oil & Gas Exploration",
      title: "Circular debt plan: OGDCL receives final payment",
      url: "https://www.brecorder.com/news/40427135",
      source: "Business Recorder",
      published_at: new Date(Date.now() - 9 * 86400000).toISOString(),
      snippet: "OGDCL received its final PKR 7.725 billion interest instalment from Power Holding Limited on 24 June, completing the PKR 92 billion interest schedule under the government's circular debt settlement plan.",
      ai_summary: "The twelve-instalment settlement plan is complete: PKR 82 billion of principal plus PKR 92 billion of interest has now been paid in full.",
      sentiment: "positive",
      relevance_score: 9,
      why_it_matters: "Receivable settlement is the exact upside trigger written in your OGDC thesis, and it has now fully landed.",
      thesis_impact: "Confirms the re-rating case. The question moves to how management deploys the cash.",
      review_question: "Does the next payout announcement show the settlement cash reaching shareholders?",
      category: "corporate_announcement",
    },
    {
      ticker: "SYS",
      company_name: "Systems Limited",
      sector: "Technology & Communication",
      title: "Pakistan's tech exports reach record $4.2 billion in 11MFY26",
      url: "https://www.arabnews.com/node/2647548",
      source: "Arab News",
      published_at: new Date(Date.now() - 12 * 86400000).toISOString(),
      snippet: "IT and IT-enabled service exports hit a record USD 4.2 billion in the first eleven months of FY26, up roughly 20% year on year, with December's USD 437 million the first month ever above USD 400 million.",
      ai_summary: "Sector exports are compounding around 20% a year and the full fiscal year is expected to close near USD 4.5 billion.",
      sentiment: "positive",
      relevance_score: 9,
      why_it_matters: "Export growth above 20% is the core assumption behind your SYS position, and the sector tape confirms it.",
      thesis_impact: "Supports the thesis. The dollar-revenue case is intact.",
      review_question: "Is SYS growing at or above the sector's 20% rate?",
      category: "result",
    },
    {
      ticker: "HUBC",
      company_name: "The Hub Power Company Limited",
      sector: "Power Generation & Distribution",
      title: "HUBC: Resilient in transition",
      url: "https://www.brecorder.com/news/40410294",
      source: "Business Recorder",
      published_at: new Date(Date.now() - 45 * 86400000).toISOString(),
      snippet: "Revenue decline reflects structural change in the IPP landscape, but a diversified portfolio, lower leverage and strong dividend inflows from Thar and CPHGC associates have sustained profitability and the payout.",
      ai_summary: "Legacy PPA earnings are shrinking while associate income from Thar coal plants grows about 6% and now carries the quarterly payout.",
      sentiment: "neutral",
      relevance_score: 8,
      why_it_matters: "The company funding its dividend from associates instead of contracted base-plant cash flows is exactly why your thesis is marked weakening.",
      thesis_impact: "Changes the shape of the thesis rather than breaking it. The payout holds but the original contracted-cash-flow case has rolled off.",
      review_question: "Can associate dividends alone cover the PKR 5 per share quarterly payout?",
      category: "result",
    },
    {
      ticker: "LUCK",
      company_name: "Lucky Cement Limited",
      sector: "Cement",
      title: "Pakistan's cement despatches rise 11.14% in April on strong local demand",
      url: "https://profit.pakistantoday.com.pk/2026/05/05/pakistans-cement-despatches-rise-11-14-in-april-on-strong-local-demand/",
      source: "Profit by Pakistan Today",
      published_at: new Date(Date.now() - 59 * 86400000).toISOString(),
      snippet: "Sector despatches rose 11% in April with Lucky Cement up 18% to 0.79 million tonnes, driven by a 33% jump in local sales. FY26 despatches are heading for roughly 50 million tonnes, a second straight year of recovery.",
      ai_summary: "Domestic cement demand is recovering, and Lucky is taking more than its share: dispatches up 18%, local sales up 33% in April.",
      sentiment: "positive",
      relevance_score: 8,
      why_it_matters: "The domestic construction recovery is the entire LUCK thesis, and the dispatch data now confirms it.",
      thesis_impact: "Supports the thesis. The volume-recovery leg has arrived.",
      review_question: "Do margins hold as volume returns, or does pricing discipline slip?",
      category: "result",
    },
    {
      ticker: "MEBL",
      company_name: "Meezan Bank Limited",
      sector: "Commercial Banks",
      title: "SBP holds policy rate at 11.5% as inflation stays above target",
      url: "https://tradingeconomics.com/pakistan/interest-rate",
      source: "Trading Economics",
      published_at: new Date(Date.now() - 18 * 86400000).toISOString(),
      snippet: "The State Bank held the policy rate at 11.5% on 15 June after the surprise 100 basis point hike in April, with headline inflation at 11.7% in May, its highest since June 2024 and above the 5 to 7% target band.",
      ai_summary: "The easing cycle has reversed: rates are back at 11.5% and holding while inflation runs at 11.7%.",
      sentiment: "positive",
      relevance_score: 8,
      why_it_matters: "Higher-for-longer rates protect the margins of both of your banks, which together are the largest sleeve of the book.",
      thesis_impact: "Supports the earnings leg of the MEBL and UBL theses in the near term.",
      review_question: "Does deposit growth hold up now that the rate cycle has turned?",
      category: "market",
    },
  ];
  for (const n of news) {
    await supabase
      .from("news_articles")
      .upsert({ user_id: userId, ...n }, { onConflict: "user_id,url", ignoreDuplicates: true });
  }

  // ── Received dividends (trailing twelve months) ──────────────────────────────
  const receivedDividends = [
    { ticker: "UBL", pay_date: daysAgo(300), per_share: 11.0 },
    { ticker: "UBL", pay_date: daysAgo(210), per_share: 11.0 },
    { ticker: "UBL", pay_date: daysAgo(120), per_share: 11.0 },
    { ticker: "UBL", pay_date: daysAgo(30), per_share: 11.0 },
    { ticker: "FFC", pay_date: daysAgo(250), per_share: 22.0 },
    { ticker: "FFC", pay_date: daysAgo(60), per_share: 23.0 },
    { ticker: "OGDC", pay_date: daysAgo(230), per_share: 13.0 },
    { ticker: "OGDC", pay_date: daysAgo(45), per_share: 14.0 },
    { ticker: "MEBL", pay_date: daysAgo(180), per_share: 14.0 },
    { ticker: "MEBL", pay_date: daysAgo(70), per_share: 14.0 },
    { ticker: "ENGROH", pay_date: daysAgo(260), per_share: 10.0 },
    { ticker: "ENGROH", pay_date: daysAgo(80), per_share: 10.0 },
    { ticker: "LUCK", pay_date: daysAgo(95), per_share: 16.0 },
    { ticker: "HUBC", pay_date: daysAgo(93), per_share: 5.0 },
    { ticker: "HUBC", pay_date: daysAgo(32), per_share: 5.0 },
  ];
  await supabase.from("dividends").insert(
    receivedDividends.map((d, i) => {
      const qty = H(d.ticker).quantity;
      const gross = Math.round(d.per_share * qty);
      const tax = Math.round(gross * 0.15);
      return {
        user_id: userId,
        ticker: d.ticker,
        pay_date: d.pay_date,
        amount: gross,
        tax,
        net_amount: gross - tax,
        source: "demo",
        notes: `PKR ${d.per_share.toFixed(2)}/share on ${qty} shares (15% withholding)`,
        row_hash: `demo-${d.ticker}-${i}-${userId}`,
      };
    })
  );

  // ── Upcoming + forecast dividend events ──────────────────────────────────────
  await seedDividendEvents(supabase, userId, daysAgo);

  // ── Value history + benchmark series ─────────────────────────────────────────
  await seedSnapshotSeries(supabase, userId, totalCost, totalValue);
  await seedBenchmarkSeries(supabase, userId, totalCost, totalValue);

  // ── Daily briefing ───────────────────────────────────────────────────────────
  await supabase.from("ai_briefings").insert({
    user_id: userId,
    briefing_type: "daily",
    title: "Daily Briefing",
    content: `## Portfolio overview
This demo portfolio holds eight PSX blue chips worth roughly PKR ${(totalValue / 1_000_000).toFixed(2)}M, up about ${(((totalValue - totalCost) / totalCost) * 100).toFixed(0)}% on cost. It spans banks, fertilizer, oil and gas, technology, cement, power and a conglomerate, so no single sector decides the outcome.

## What moved
- **OGDC** received the final PKR 7.7 billion instalment on 24 June, completing the PKR 92 billion circular debt interest schedule. The re-rating trigger in your thesis has now fully landed. [Source](https://www.brecorder.com/news/40427135)
- **SYS** rides a sector tape at a record: IT exports hit USD 4.2 billion in 11MFY26, up about 20% year on year. [Source](https://www.arabnews.com/node/2647548)
- **Rates**: the SBP held at 11.5% on 15 June after April's surprise 100 basis point hike, with CPI at 11.7%. Near-term support for your two banks, a headwind for the cement recovery. [Source](https://tradingeconomics.com/pakistan/interest-rate)

## Holdings requiring review
- **HUBC** review date has passed and the thesis is marked *Weakening*: the payout now leans on Thar associate dividends, not the contracted cash flows you originally bought.
- **ENGROH** has no recorded thesis, so the reason to keep holding is not written down.

## Income
- FFC has announced an interim cash dividend and UBL a quarterly payout. Both show up as confirmed receivables.

## Questions to consider
1. What would confirm or refute the HUBC contracted-cash-flow case this quarter?
2. Why do you still hold ENGROH? Write it down in one paragraph or trim it.
3. The two banks together are the largest sleeve in the book. Is that deliberate?`,
    model: "demo",
  });

  // ── Curated Research Copilot threads ─────────────────────────────────────────
  await seedDemoChatThreads(supabase, userId, totalValue, totalCost);

  await supabase.from("profiles").update({ demo_mode: true }).eq("id", userId);
  // seedSnapshotSeries already wrote today's point (tagged demo:true), so no
  // extra snapshot is taken here.
  await refreshAlerts(supabase, userId);
}

// ── Dividend events ─────────────────────────────────────────────────────────────

async function seedDividendEvents(
  supabase: SupabaseClient,
  userId: string,
  daysAgo: (n: number) => string
) {
  const taxRate = 0.15;

  // Confirmed, announced receivables (show under "Upcoming"). Negative offset
  // means a future date.
  const announced = [
    { ticker: "FFC", per_share: 22.0, ex_offset: -10, pay_offset: -28, announce_offset: 5 },
    { ticker: "UBL", per_share: 11.0, ex_offset: -16, pay_offset: -34, announce_offset: 3 },
  ];
  // Model-estimated payouts (show under "Estimated").
  const forecasts = [
    { ticker: "OGDC", low: 13.0, high: 15.0, pay_offset: -40, confidence: "high", basis: "Trailing four-quarter average payout, adjusted for the receivable position." },
    { ticker: "MEBL", low: 13.0, high: 15.0, pay_offset: -55, confidence: "medium", basis: "Payout ratio applied to consensus full-year earnings." },
    { ticker: "LUCK", low: 14.0, high: 18.0, pay_offset: -70, confidence: "medium", basis: "Historical final-dividend pattern scaled to expected earnings." },
  ];

  const rows: Record<string, unknown>[] = [];

  announced.forEach((a, i) => {
    const q = H(a.ticker).quantity;
    const gross = Math.round(a.per_share * q);
    const tax = Math.round(gross * taxRate);
    rows.push({
      user_id: userId,
      ticker: a.ticker,
      company_name: H(a.ticker).company_name,
      event_type: "announcement",
      source_type: "demo",
      source_quality: "high",
      announcement_date: daysAgo(a.announce_offset),
      ex_date: daysAgo(a.ex_offset),
      payment_date: daysAgo(a.pay_offset),
      estimated_payment_start: daysAgo(a.pay_offset),
      estimated_payment_end: daysAgo(a.pay_offset),
      dividend_type: "cash",
      announced_value_raw: `PKR ${a.per_share.toFixed(2)} per share`,
      dividend_per_share: a.per_share,
      quantity_basis: "current_holding",
      eligible_quantity: q,
      eligibility_status: "eligible",
      gross_expected: gross,
      taxpayer_status: "filer",
      tax_rate: taxRate,
      estimated_tax: tax,
      net_expected: gross - tax,
      status: "announced",
      confidence_level: "high",
      is_forecast: false,
      dedupe_key: `${DEMO_DIVIDEND_EVENT_PREFIX}announced:${a.ticker}:${i}`,
    });
  });

  forecasts.forEach((f, i) => {
    const q = H(f.ticker).quantity;
    const grossLow = Math.round(f.low * q);
    const grossHigh = Math.round(f.high * q);
    rows.push({
      user_id: userId,
      ticker: f.ticker,
      company_name: H(f.ticker).company_name,
      event_type: "forecast",
      source_type: "demo",
      source_quality: "medium",
      estimated_payment_start: daysAgo(f.pay_offset),
      estimated_payment_end: daysAgo(f.pay_offset),
      dividend_type: "cash",
      quantity_basis: "current_holding",
      eligible_quantity: q,
      eligibility_status: "likely_eligible",
      taxpayer_status: "filer",
      tax_rate: taxRate,
      dps_low: f.low,
      dps_high: f.high,
      gross_low: grossLow,
      gross_high: grossHigh,
      net_low: Math.round(grossLow * (1 - taxRate)),
      net_high: Math.round(grossHigh * (1 - taxRate)),
      status: "forecasted",
      confidence_level: f.confidence,
      forecast_basis: f.basis,
      is_forecast: true,
      dedupe_key: `${DEMO_DIVIDEND_EVENT_PREFIX}forecast:${f.ticker}:${i}`,
    });
  });

  await supabase.from("dividend_events").insert(rows);
}

// ── Value-over-time snapshots ────────────────────────────────────────────────────

async function seedSnapshotSeries(
  supabase: SupabaseClient,
  userId: string,
  totalCost: number,
  totalValue: number
) {
  // 26 weekly points over six months, drifting from roughly cost up to today's
  // value with mild noise. Tagged demo:true in the jsonb so it can be cleared
  // without touching a real user's snapshots.
  const points = 26;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1); // 0..1
    const wobble = Math.sin(i * 1.3) * 0.012 + Math.sin(i * 0.4) * 0.008;
    const value = Math.round(totalCost + (totalValue - totalCost) * t * (1 + wobble));
    const date = new Date(Date.now() - (points - 1 - i) * 7 * 86400000).toISOString().slice(0, 10);
    rows.push({
      user_id: userId,
      snapshot_date: date,
      total_value: i === points - 1 ? totalValue : value,
      total_cost: totalCost,
      unrealized_pl: (i === points - 1 ? totalValue : value) - totalCost,
      data: { demo: true },
    });
  }
  await supabase.from("portfolio_snapshots").upsert(rows, { onConflict: "user_id,snapshot_date" });
}

// ── Benchmark growth series (portfolio vs KSE-100 vs inflation) ──────────────────

async function seedBenchmarkSeries(
  supabase: SupabaseClient,
  userId: string,
  totalCost: number,
  totalValue: number
) {
  // 18 monthly points. Capital is contributed in a few lumps; the portfolio
  // beats both the index and inflation. Inflation grows each contribution from
  // the month it was actually made (~11.3% annualised, in line with the cited
  // CPI), so recent capital is not over-inflated and the path stays below the
  // portfolio.
  const months = 18;
  const monthlyInflation = 0.009;
  const startContributed = Math.round(totalCost * 0.62);
  const contribAt = (i: number) =>
    Math.round(startContributed + (totalCost - startContributed) * Math.min(1, (i / (months - 1)) * 1.15));
  const deltas: number[] = [];
  let prev = 0;
  for (let i = 0; i < months; i += 1) {
    const c = contribAt(i);
    deltas.push(c - prev);
    prev = c;
  }
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < months; i += 1) {
    const last = i === months - 1;
    const t = i / (months - 1);
    const contributed = contribAt(i);
    const portWobble = Math.sin(i * 0.9) * 0.018;
    const portfolio = last
      ? totalValue
      : Math.round(contributed * (1 + (totalValue / totalCost - 1) * t * (1 + portWobble)));
    const kse = Math.round(contributed * (1 + (totalValue / totalCost - 1) * 0.74 * t + Math.sin(i * 0.7) * 0.02));
    let inflation = 0;
    for (let j = 0; j <= i; j += 1) inflation += deltas[j] * Math.pow(1 + monthlyInflation, i - j);
    inflation = Math.round(inflation);
    const cpi = Math.round(100 * Math.pow(1 + monthlyInflation, i) * 100) / 100;
    const date = new Date(Date.now() - (months - 1 - i) * 30 * 86400000).toISOString().slice(0, 10);
    rows.push({ user_id: userId, point_date: date, contributed, portfolio, kse100: kse, inflation, cpi });
  }
  await supabase.from("benchmark_series").upsert(rows, { onConflict: "user_id,point_date" });
}

// ── Cleanup ─────────────────────────────────────────────────────────────────────

async function clearDemoRows(supabase: SupabaseClient, userId: string) {
  const demoTickers = DEMO_HOLDINGS.map((h) => h.ticker);
  await supabase.from("holdings").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("prices").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("dividends").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("journal_entries").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("news_articles").delete().eq("user_id", userId).in("url", DEMO_NEWS_URLS);
  await supabase.from("ai_briefings").delete().eq("user_id", userId).eq("model", "demo");
  await supabase
    .from("dividend_events")
    .delete()
    .eq("user_id", userId)
    .like("dedupe_key", `${DEMO_DIVIDEND_EVENT_PREFIX}%`);
  // Snapshots are tagged demo:true so we never touch a real user's history.
  await supabase.from("portfolio_snapshots").delete().eq("user_id", userId).filter("data->>demo", "eq", "true");
  // Benchmark rows carry no source column. A user who has loaded the demo only
  // has the demo series, so clearing the whole user series is safe here.
  await supabase.from("benchmark_series").delete().eq("user_id", userId);

  const { data: demoThreads } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .like("summary", `${DEMO_CHAT_SUMMARY_PREFIX}%`);
  const demoThreadIds = (demoThreads ?? []).map((thread) => thread.id as string);
  if (demoThreadIds.length) await supabase.from("chat_threads").delete().in("id", demoThreadIds);

  // demo targets/theses only removed where the demo holding is gone
  const { data: remaining } = await supabase
    .from("holdings")
    .select("ticker")
    .eq("user_id", userId)
    .in("ticker", demoTickers);
  const keep = new Set((remaining ?? []).map((r) => r.ticker));
  for (const t of demoTickers) {
    if (!keep.has(t)) {
      await supabase.from("targets").delete().eq("user_id", userId).eq("ticker", t);
      await supabase.from("theses").delete().eq("user_id", userId).eq("ticker", t);
      await supabase.from("alerts").delete().eq("user_id", userId).eq("ticker", t);
    }
  }
}

/** Removes everything tagged as demo data. Real (imported/manual) data is untouched. */
export async function clearDemoData(supabase: SupabaseClient, userId: string) {
  await clearDemoRows(supabase, userId);
  await supabase.from("profiles").update({ demo_mode: false }).eq("id", userId);
  await refreshAlerts(supabase, userId);
}

// ── Curated chat threads ──────────────────────────────────────────────────────────

async function seedDemoChatThreads(
  supabase: SupabaseClient,
  userId: string,
  totalValue: number,
  totalCost: number
) {
  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const unrealized = totalValue - totalCost;
  const unrealizedPct = ((unrealized / totalCost) * 100).toFixed(1);
  const valueM = (totalValue / 1_000_000).toFixed(2);
  const kfmt = (n: number) => `${n >= 0 ? "" : "-"}PKR ${Math.abs(Math.round(n / 1000))}k`;
  const wt = (t: string) => (marketValue(H(t)) / totalValue) * 100;
  const banksWt = ((marketValue(H("MEBL")) + marketValue(H("UBL"))) / totalValue) * 100;
  const posCost = (t: string) => H(t).quantity * H(t).avg_cost;

  // Net received per holding over the trailing 12 months (gross x 0.85).
  // Per-share sums mirror the receivedDividends rows above.
  const divNet: Record<string, number> = {
    UBL: Math.round(44 * H("UBL").quantity * 0.85),
    OGDC: Math.round(27 * H("OGDC").quantity * 0.85),
    FFC: Math.round(45 * H("FFC").quantity * 0.85),
    MEBL: Math.round(28 * H("MEBL").quantity * 0.85),
    ENGROH: Math.round(20 * H("ENGROH").quantity * 0.85),
    LUCK: Math.round(16 * H("LUCK").quantity * 0.85),
    HUBC: Math.round(10 * H("HUBC").quantity * 0.85),
  };
  const netIncome = Object.values(divNet).reduce((s, v) => s + v, 0);
  const yocNet = (netIncome / totalCost) * 100;
  const yoc = (t: string) => (divNet[t] / posCost(t)) * 100;
  const incomeShare = (t: string) => (divNet[t] / netIncome) * 100;
  const divNetRange = (t: string, low: number, high: number) =>
    `PKR ${Math.round(low * H(t).quantity * 0.85).toLocaleString()} to ${Math.round(high * H(t).quantity * 0.85).toLocaleString()}`;

  // Benchmark comparison, computed the same way as seedBenchmarkSeries so prose
  // and the growth chart agree: KSE lands at 0.74 of the portfolio's excess.
  const portRet = (totalValue / totalCost - 1) * 100;
  const kseRet = portRet * 0.74;
  const excessPts = portRet - kseRet;

  // Target allocations, mirrored from the seeded targets table.
  const targetWt: Record<string, number> = { MEBL: 16, UBL: 14, FFC: 12, OGDC: 13, SYS: 14, LUCK: 10, HUBC: 8, ENGROH: 9 };

  // HUBC valuation figures used by the P/E explainer. The FY26 earnings
  // estimate is the same consensus figure the demo has always shown for HUBC.
  const hubcEps = 39.8;
  const hubcPe = H("HUBC").price / hubcEps;
  const hubcEarningsYield = (hubcEps / H("HUBC").price) * 100;

  // FFC's announced PKR 22 interim, per the seeded dividend event.
  const ffcDps = 22;
  const ffcGross = ffcDps * H("FFC").quantity;
  const ffcTax = Math.round(ffcGross * 0.15);
  const ffcNet = ffcGross - ffcTax;

  // Gross received before withholding, mirroring the divNet map (net = gross x 0.85).
  const grossIncome = Math.round(netIncome / 0.85);
  const taxTaken = grossIncome - netIncome;

  // Effective number of positions: 1 / sum of squared weights.
  const effectiveN = 1 / DEMO_HOLDINGS.reduce((acc, h) => acc + Math.pow(wt(h.ticker) / 100, 2), 0);

  const threads: {
    title: string;
    summary: string;
    user: string;
    assistant: string;
    cards: Record<string, unknown>[];
    /** Curated research-activity trail, in the live console's vocabulary. */
    activity: { id: string; label: string; detail?: string; done: true }[];
  }[] = [
    // 1 ─ What do I own, and how is it doing? (flagship, newest) ─────────────
    {
      title: "What do I own, and how is it doing?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} the eight holdings, where the gain comes from, and the result against the KSE-100`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and PSX context", detail: "quotes, holdings, sectors", done: true },
        { id: "t1", label: "Portfolio — allocation and performance", detail: "8 holdings, PKR 1.23M", done: true },
        { id: "t2", label: "Portfolio — performance history", detail: "vs KSE-100, +7 pts excess", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "Give me a plain summary of what I own and how it is doing.",
      assistant: `You own eight PSX companies worth PKR ${valueM}M, bought for PKR ${(totalCost / 1_000_000).toFixed(2)}M, so the book is up ${kfmt(unrealized)} or ${unrealizedPct}% on cost before dividends. Six of the eight are above your purchase price and two are below. Measured against the KSE-100 on your own contribution dates, the portfolio is about ${excessPts.toFixed(0)} points ahead of the index.

## What each holding is
- **MEBL** (Meezan Bank, ${wt("MEBL").toFixed(1)}%): Pakistan's largest Islamic bank. Up ${retPct(H("MEBL")).toFixed(0)}% on your PKR ${H("MEBL").avg_cost.toFixed(0)} cost.
- **UBL** (United Bank, ${wt("UBL").toFixed(1)}%): a large conventional bank held mainly for its quarterly dividend. Up ${retPct(H("UBL")).toFixed(0)}%.
- **OGDC** (Oil and Gas Development, ${wt("OGDC").toFixed(1)}%): the state-owned oil and gas explorer. Up ${retPct(H("OGDC")).toFixed(0)}%.
- **SYS** (Systems Limited, ${wt("SYS").toFixed(1)}%): a software exporter earning in dollars. Up ${retPct(H("SYS")).toFixed(0)}%, your best position.
- **FFC** (Fauji Fertilizer, ${wt("FFC").toFixed(1)}%): the largest urea producer. Up ${retPct(H("FFC")).toFixed(0)}%.
- **ENGROH** (Engro Holdings, ${wt("ENGROH").toFixed(1)}%): a conglomerate holding company. Down ${Math.abs(retPct(H("ENGROH"))).toFixed(0)}%.
- **LUCK** (Lucky Cement, ${wt("LUCK").toFixed(1)}%): the largest cement producer. Up ${retPct(H("LUCK")).toFixed(0)}%.
- **HUBC** (Hub Power, ${wt("HUBC").toFixed(1)}%): an independent power producer. Down ${Math.abs(retPct(H("HUBC"))).toFixed(0)}%, your only other red position.

## Where the gain comes from
No single name carries the result. MEBL, UBL and SYS contribute the most in rupees, and the two red positions together take back about ${kfmt(Math.abs(pl(H("HUBC")) + pl(H("ENGROH"))))}. On top of the price gain, the book paid you PKR ${(netIncome / 1000).toFixed(1)}k of dividends net over the last twelve months, a ${yocNet.toFixed(1)}% yield on what you paid.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Portfolio at a glance",
          metrics: [
            { label: "Market value", value: `PKR ${valueM}M`, tone: "neutral" },
            { label: "Unrealized P/L", value: `+${kfmt(unrealized)}`, delta: `+${unrealizedPct}% on cost`, tone: "positive" },
            { label: "vs KSE-100", value: `+${excessPts.toFixed(0)} pts`, detail: "excess over the index", tone: "positive" },
            { label: "Dividends, trailing 12m", value: `PKR ${(netIncome / 1000).toFixed(1)}k`, detail: `${yocNet.toFixed(1)}% net yield on cost`, tone: "neutral" },
          ],
        },
        {
          kind: "portfolio-attribution",
          title: "Unrealized P/L by holding",
          description: "Where the gain actually comes from",
          items: DEMO_HOLDINGS.map((h) => ({ label: h.ticker, value: pl(h), tone: pl(h) >= 0 ? "positive" : "negative" }))
            .sort((a, b) => b.value - a.value),
        },
        {
          kind: "benchmark-excess",
          title: "Each holding against the index",
          description: "Return since purchase minus the KSE-100 over your holding period",
          benchmarkLabel: "KSE-100",
          items: DEMO_HOLDINGS.map((h) => ({
            label: h.ticker,
            returnPct: Math.round(retPct(h) * 10) / 10,
            benchmarkPct: Math.round(kseRet * 10) / 10,
          })).sort((a, b) => b.returnPct - a.returnPct),
        },
      ],
    },

    // 2 ─ Concentration explained ────────────────────────────────────────────
    {
      title: "Which of my holdings are most concentrated?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} two banks share one driver, so the book has fewer independent bets than eight names suggest`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and PSX context", detail: "holdings and sector weights", done: true },
        { id: "t1", label: "Portfolio — all holdings and sector weights", detail: "8 holdings across 7 sectors", done: true },
        { id: "t2", label: "Portfolio — allocation targets", detail: "8 targets on file", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "Which of my holdings are most concentrated, and why does that matter?",
      assistant: `Your two banks are the concentration. MEBL at ${wt("MEBL").toFixed(1)}% and UBL at ${wt("UBL").toFixed(1)}% put ${banksWt.toFixed(0)}% of the book in one sector, and both move with the same thing: the SBP policy rate, which sets what a bank earns on its lending. No single company is oversized, since the largest position is under 17%, but the pair behaves like one bet of a third of your money.

## What concentration means here
Concentration is how much of your result depends on one company, one sector, or one driver. Eight holdings across seven sectors sounds spread out. Counting overlapping exposure, the book behaves more like ${effectiveN.toFixed(1)} equally sized positions, because the banking pair shares a driver and the two energy names (OGDC at ${wt("OGDC").toFixed(1)}%, HUBC at ${wt("HUBC").toFixed(1)}%) both wait on the same circular debt cash flows.

## Against the targets you set
You set MEBL at ${targetWt.MEBL}% and UBL at ${targetWt.UBL}%, so both sit ${(wt("MEBL") - targetWt.MEBL).toFixed(1)} and ${(wt("UBL") - targetWt.UBL).toFixed(1)} points above target after their gains. SYS is ${(targetWt.SYS - wt("SYS")).toFixed(1)} points under its ${targetWt.SYS}% target and LUCK is close to its ${targetWt.LUCK}%. What you do with that is your call; the chart shows where each name stands against the number you chose.`,
      cards: [
        {
          kind: "allocation",
          title: "Where the capital sits",
          description: "Two banks share one macro driver, so read them as a single sleeve",
          bySector: true,
          centerValue: `${banksWt.toFixed(0)}%`,
          centerLabel: "in two banks",
          segments: [
            { label: "Commercial Banks", value: marketValue(H("MEBL")) + marketValue(H("UBL")) },
            { label: "Oil & Gas Exploration", value: marketValue(H("OGDC")) },
            { label: "Technology & Communication", value: marketValue(H("SYS")) },
            { label: "Fertilizer", value: marketValue(H("FFC")) },
            { label: "Conglomerate", value: marketValue(H("ENGROH")) },
            { label: "Cement", value: marketValue(H("LUCK")) },
            { label: "Power Generation & Distribution", value: marketValue(H("HUBC")) },
          ],
        },
        {
          kind: "vega-lite",
          title: "Weight versus target",
          description: "Bars are current weights, ticks are the targets you set",
          spec: {
            data: {
              values: DEMO_HOLDINGS.map((h) => ({
                holding: h.ticker,
                weight: Math.round(wt(h.ticker) * 10) / 10,
                target: targetWt[h.ticker],
              })),
            },
            layer: [
              {
                mark: { type: "bar", cornerRadiusEnd: 2 },
                encoding: {
                  y: { field: "holding", type: "nominal", sort: "-x", title: null },
                  x: { field: "weight", type: "quantitative", title: "% of portfolio" },
                },
              },
              {
                mark: { type: "tick", thickness: 2 },
                encoding: {
                  y: { field: "holding", type: "nominal", sort: "-x" },
                  x: { field: "target", type: "quantitative" },
                },
              },
            ],
          },
        },
        {
          kind: "comparison-table",
          title: "Holdings that share a driver",
          columns: [
            { key: "group", label: "Group" },
            { key: "weight", label: "Weight" },
            { key: "driver", label: "Shared driver" },
          ],
          rows: [
            { group: "MEBL + UBL", weight: `${banksWt.toFixed(0)}%`, driver: "SBP policy rate sets lending margins" },
            { group: "OGDC + HUBC", weight: `${(wt("OGDC") + wt("HUBC")).toFixed(0)}%`, driver: "Circular debt decides when cash arrives" },
            { group: "SYS", weight: `${wt("SYS").toFixed(1)}%`, driver: "Dollar export revenue, independent of local rates" },
            { group: "FFC, LUCK, ENGROH", weight: `${(wt("FFC") + wt("LUCK") + wt("ENGROH")).toFixed(0)}%`, driver: "Three separate domestic demand cycles" },
          ],
        },
      ],
    },

    // 3 ─ Event-aware macro: the April hike and June hold, explained ─────────
    {
      title: "What did the April rate hike do to my holdings?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} what the surprise 100bps hike and June hold mean for each sleeve`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and PSX context", detail: "macro backdrop and sector weights", done: true },
        { id: "t1", label: "PSX macro backdrop", detail: "policy rate 11.5%, CPI 11.7%, USD/PKR 277", done: true },
        { id: "t2", label: "Portfolio — all holdings and sector weights", detail: "8 holdings across 7 sectors", done: true },
        { id: "t3", label: "PSX — sector performance", detail: "sleeves ranked by rate sensitivity", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "I thought rates were coming down, but the SBP hiked in April and held in June. What does that do to my holdings?",
      assistant: `The hike helps the largest thing you own and hurts two smaller positions. The SBP took the policy rate from a 22% peak down to 10.5%, then raised it 100 basis points to 11.5% on 27 April as inflation came back, and held there on 15 June. Your ${banksWt.toFixed(0)}% banking sleeve earns more when rates stay high; LUCK and HUBC, ${(wt("LUCK") + wt("HUBC")).toFixed(0)}% together, were counting on cheaper borrowing that has now been delayed.

## Why the SBP turned
CPI printed 11.7% in May, the highest since June 2024 and well above the 5 to 7% target band. That puts the real policy rate (the rate minus inflation) at about minus 0.2 points, so there is no room to resume cutting until inflation rolls over. The working assumption is 11.5% persisting for now, not the easing cycle you originally positioned for.

## Who is on which side
- **Banks (MEBL, UBL, ${banksWt.toFixed(0)}%)**: higher for longer protects the spread between what they charge borrowers and pay depositors. The margin-compression risk written in both theses has been pushed out, not cancelled.
- **Cement (LUCK, ${wt("LUCK").toFixed(1)}%)**: the clearest loser. Its profit recovery leaned on a 36% drop in finance costs, and that tailwind stalls at 11.5%. Demand is still recovering, so this cools the story rather than breaking it.
- **Power (HUBC, ${wt("HUBC").toFixed(1)}%)**: a leveraged business, so rate relief is welcome and is now later than hoped.
- **Dollar earners (SYS ${wt("SYS").toFixed(1)}%, OGDC ${wt("OGDC").toFixed(1)}%)**: rates barely matter here. USD/PKR near 277 and slightly firmer means the currency kicker is dormant; these run on export volumes and oil.

Net, what the hike takes from LUCK and HUBC it hands to MEBL and UBL, with interest. The real casualty is any plan that assumed cheap money by December.`,
      cards: [
        {
          kind: "metric-strip",
          title: "PSX macro backdrop, early July 2026",
          metrics: [
            { label: "Policy rate", value: "11.5%", delta: "+100bps on 27 Apr, held 15 Jun", tone: "neutral" },
            { label: "Inflation (CPI)", value: "11.7%", detail: "May, highest since Jun 2024", tone: "negative" },
            { label: "Real policy rate", value: "-0.2 pts", detail: "rate minus CPI", tone: "neutral" },
            { label: "USD/PKR", value: "277", detail: "firm over the past year", tone: "neutral" },
          ],
        },
        {
          kind: "vega-lite",
          title: "Exposure to the rate turn",
          description: "Sleeve weights, coloured by which side of 11.5% they sit on",
          spec: {
            data: {
              values: [
                { sleeve: "Banks (MEBL, UBL)", weight: Math.round(banksWt * 10) / 10, side: "Tailwind" },
                { sleeve: "Dollar earners (SYS, OGDC)", weight: Math.round((wt("SYS") + wt("OGDC")) * 10) / 10, side: "Rate-neutral" },
                { sleeve: "Fertilizer (FFC)", weight: Math.round(wt("FFC") * 10) / 10, side: "Rate-neutral" },
                { sleeve: "Conglomerate (ENGROH)", weight: Math.round(wt("ENGROH") * 10) / 10, side: "Mixed" },
                { sleeve: "Cement (LUCK)", weight: Math.round(wt("LUCK") * 10) / 10, side: "Headwind" },
                { sleeve: "Power (HUBC)", weight: Math.round(wt("HUBC") * 10) / 10, side: "Headwind" },
              ],
            },
            mark: { type: "bar", cornerRadiusEnd: 2 },
            encoding: {
              y: { field: "sleeve", type: "nominal", sort: "-x", title: null },
              x: { field: "weight", type: "quantitative", title: "% of portfolio" },
              color: { field: "side", type: "nominal", title: null },
            },
          },
        },
        {
          kind: "comparison-table",
          title: "How 11.5% lands on each sleeve",
          columns: [
            { key: "sleeve", label: "Sleeve" },
            { key: "weight", label: "Weight" },
            { key: "driver", label: "Main driver" },
            { key: "read", label: "Net read" },
          ],
          rows: [
            { sleeve: "Banks (MEBL, UBL)", weight: `${banksWt.toFixed(0)}%`, driver: "Policy rate", read: "Spread protection extended" },
            { sleeve: "Cement (LUCK)", weight: `${wt("LUCK").toFixed(1)}%`, driver: "Finance costs + construction", read: "Recovery cools, demand intact" },
            { sleeve: "Power (HUBC)", weight: `${wt("HUBC").toFixed(1)}%`, driver: "Leverage + circular debt", read: "Rate relief delayed" },
            { sleeve: "Exporters (SYS, OGDC)", weight: `${(wt("SYS") + wt("OGDC")).toFixed(0)}%`, driver: "USD/PKR, oil", read: "FX kicker dormant, PKR firm" },
          ],
        },
      ],
    },

    // 4 ─ Event-aware: why OGDC moved on the circular debt settlement ────────
    {
      title: "Why did OGDC move after the circular debt news?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} the final PKR 7.7bn instalment landed on 24 June, what it changed`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and OGDC context", done: true },
        { id: "t1", label: "OGDC — latest quote", detail: "PKR 335.00", done: true },
        { id: "t2", label: "OGDC — your position", detail: "500 shares, PKR 167,500", done: true },
        { id: "t3", label: "OGDC — filings and news", detail: "1 item", done: true },
        { id: "t4", label: "OGDC — dividend history", detail: "2 payouts on record, 1 forecast", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "OGDC moved on the circular debt news. What actually happened, and what does it mean for my shares?",
      assistant: `OGDC got paid. On 24 June it received the final PKR 7.7 billion instalment of a twelve-payment schedule, completing PKR 92 billion of interest on top of PKR 82 billion of principal paid earlier. Circular debt is the chain of unpaid bills running from power consumers through distributors and power producers to gas and oil suppliers; OGDC sits at the end of that chain, so for years it booked profit it could not collect. The move is the market pricing cash that has now actually arrived.

## What it means for your position
Your 500 shares bought at PKR ${H("OGDC").avg_cost.toFixed(0)} are worth ${kfmt(marketValue(H("OGDC")))} at PKR ${H("OGDC").price.toFixed(0)}, up ${retPct(H("OGDC")).toFixed(0)}%, and the position is ${wt("OGDC").toFixed(1)}% of the book, right at the ${targetWt.OGDC}% target you set. Your thesis listed settlement progress as upside you were not paying for, and it has now landed in full.

## What is still open
The settlement fixes the balance sheet story, not what happens to the cash next: a higher payout, exploration spending, or letting it sit. The platform's forecast payout of PKR 13 to 15 per share would be worth ${divNetRange("OGDC", 13, 15)} net to you, and the next dividend announcement is where you will see which way management leans.`,
      cards: [
        {
          kind: "timeline",
          title: "The settlement, from plan to final payment",
          events: [
            { date: "2025-07-01", label: "Monthly interest instalments begin", type: "corporate", detail: "Twelve payments of PKR 7.7bn, on top of PKR 82bn principal already approved" },
            { date: "2026-02-25", label: "Eighth instalment received", type: "corporate", value: "PKR 7.7bn" },
            { date: "2026-04-24", label: "Tenth instalment received", type: "corporate", value: "PKR 7.7bn" },
            { date: "2026-06-24", label: "Final instalment, plan complete", type: "corporate", detail: "PKR 92bn of interest fully paid", value: "PKR 7.7bn" },
            { date: isoDate(-40), label: "Forecast payout window", type: "dividend", detail: "Platform estimate PKR 13 to 15 per share" },
          ],
        },
        {
          kind: "price-chart",
          title: "OGDC over the settlement year",
          ticker: "OGDC",
          period: "1Y",
          overlay: ["cost-basis", "dividends"],
          description: "Your entry at PKR 275 against the re-rating as instalments landed.",
        },
        {
          kind: "metric-strip",
          title: "The position after the news",
          metrics: [
            { label: "Unrealized P/L", value: `+${kfmt(pl(H("OGDC")))}`, delta: `+${retPct(H("OGDC")).toFixed(0)}% on cost`, tone: "positive" },
            { label: "Weight", value: `${wt("OGDC").toFixed(1)}%`, detail: `target ${targetWt.OGDC}%`, tone: "neutral" },
            { label: "Settlement received", value: "PKR 174bn", detail: "82bn principal + 92bn interest", tone: "positive" },
            { label: "Forecast payout", value: "PKR 13 to 15", detail: "per share, platform estimate", tone: "neutral" },
          ],
        },
      ],
    },

    // 5 ─ Best position, explained with a quality radar ──────────────────────
    {
      title: "Why has SYS gone up so much?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} the best position explained: record IT exports, and what the run changed`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and SYS context", done: true },
        { id: "t1", label: "SYS — latest quote", detail: "PKR 147.00", done: true },
        { id: "t2", label: "SYS — your position", detail: "1,000 shares, PKR 147,000", done: true },
        { id: "t3", label: "SYS — valuation and fundamentals", done: true },
        { id: "t4", label: "Web — “Pakistan IT export receipts FY26”", detail: "record $4.2bn in 11 months", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "SYS is my best position. Why has it gone up so much, and what has the run changed?",
      assistant: `SYS sells software services abroad and gets paid in dollars, and the industry it sits in just had a record year. Pakistan's IT exports reached USD 4.2 billion in the first eleven months of FY26, up about 20% year on year, with December the first ever month above USD 400 million. Your thesis needed export growth above 20%, and the sector delivered it, which is why the price has followed.

## What the run changed
Your ${H("SYS").quantity.toLocaleString()} shares at PKR ${H("SYS").avg_cost.toFixed(0)} are up ${retPct(H("SYS")).toFixed(0)}%, worth ${kfmt(marketValue(H("SYS")))} at ${wt("SYS").toFixed(1)}% of the book. The run changed the price of new money, not the shares you already hold: at PKR ${H("SYS").price.toFixed(0)} a fresh purchase buys the same growth at a much higher price than you paid, which is why the radar scores value lowest while growth scores highest.

## What to watch
Your own written conditions are export growth below 10% for a full year or sustained margin erosion from the wage bill. Neither is in sight: the sector is compounding near 20% and the rupee sitting firm near 277 keeps the story about volumes, not currency. Utilisation and wage inflation at the next result are the two numbers that would show a margin squeeze before the revenue line slows.`,
      cards: [
        {
          kind: "snowflake",
          title: "SYS quality profile",
          description: "Scored on the evidence in the thesis and the sector data",
          axes: [
            { label: "Value", score: 2, note: "Premium price after a 55% run; thin margin of safety on new money" },
            { label: "Future", score: 5, note: "Sector exports at a record USD 4.2bn in 11MFY26, up ~20% y/y" },
            { label: "Past", score: 4, note: "Multi-year export compounding through rate and currency cycles" },
            { label: "Health", score: 4, note: "Asset-light services model, low balance-sheet risk" },
            { label: "Dividend", score: 1, note: "Token payout; this position is held for growth, not income" },
          ],
        },
        {
          kind: "price-chart",
          title: "SYS against your cost basis",
          ticker: "SYS",
          period: "1Y",
          overlay: ["cost-basis"],
          description: "The gap between PKR 95 and the market is your accumulated margin of safety.",
        },
        {
          kind: "metric-strip",
          title: "Position and sector evidence",
          metrics: [
            { label: "Unrealized P/L", value: `+${kfmt(pl(H("SYS")))}`, delta: `+${retPct(H("SYS")).toFixed(0)}% on cost`, tone: "positive" },
            { label: "Weight", value: `${wt("SYS").toFixed(1)}%`, detail: `target ${targetWt.SYS}%`, tone: "neutral" },
            { label: "IT exports 11MFY26", value: "$4.2bn", delta: "+20% y/y, record", tone: "positive" },
            { label: "Best month", value: "$437M", detail: "December, first above $400M", tone: "positive" },
          ],
        },
      ],
    },

    // 6 ─ Latest results, explained simply ───────────────────────────────────
    {
      title: "Explain LUCK's latest results simply",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} cement volumes back, profit up 18%, and why finance costs did the heavy lifting`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and LUCK context", done: true },
        { id: "t1", label: "LUCK — your position", detail: "250 shares, PKR 117,500", done: true },
        { id: "t2", label: "LUCK — valuation and fundamentals", done: true },
        { id: "t3", label: "Web — “Pakistan cement dispatches FY26”", detail: "April dispatches +18% y/y", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "Explain LUCK's latest results simply. What actually went right?",
      assistant: `Two things went right for LUCK in FY26: it sold more cement, and it paid less interest. Sector dispatches are heading for roughly 50 million tonnes, up 7%, the second straight year of recovery, with local sales up 9%. LUCK took more than its share: April dispatches rose 18% with local sales up 33%, and the company produced about a quarter of the entire sector's profit.

## The profit line, in plain terms
Earnings grew 18% for the period. Dispatches are the tonnes sold, so more of them means more revenue. Finance costs are the interest a company pays on its borrowing, and LUCK's fell 36% as the SBP cut rates through the year. Of the two, the interest saving did more of the work than the extra tonnes, which matters now that the rate cycle has turned: the SBP's April hike to 11.5% means the finance-cost tailwind stalls from here, while demand is still recovering.

## What it means for your position
Your 250 shares at PKR ${H("LUCK").avg_cost.toFixed(0)} are worth ${kfmt(marketValue(H("LUCK")))} at PKR ${H("LUCK").price.toFixed(0)}, up ${retPct(H("LUCK")).toFixed(0)}%, at ${wt("LUCK").toFixed(1)}% of the book against your ${targetWt.LUCK}% target. The number to watch at the next result is pricing: whether cement prices hold as volume returns, since that is the leg of the recovery the rate cycle cannot take away.`,
      cards: [
        {
          kind: "bar-chart",
          title: "April dispatch growth, sector versus LUCK",
          description: "LUCK is outgrowing its own sector's recovery",
          xKey: "measure",
          yUnit: "% y/y",
          bars: [{ key: "growth", label: "April growth" }],
          data: [
            { measure: "Sector dispatches", growth: 11.1 },
            { measure: "LUCK dispatches", growth: 18 },
            { measure: "LUCK local sales", growth: 33 },
          ],
        },
        {
          kind: "table",
          title: "The result, line by line",
          columns: [
            { key: "line", label: "Line" },
            { key: "change", label: "Change", align: "right" },
            { key: "plain", label: "In plain terms" },
          ],
          rows: [
            { line: "Sector dispatches FY26", change: "+7%", plain: "Second year of volume recovery, about 50m tonnes" },
            { line: "LUCK April dispatches", change: "+18%", plain: "Taking share from the rest of the sector" },
            { line: "LUCK April local sales", change: "+33%", plain: "Domestic demand, not exports, is driving it" },
            { line: "Finance costs", change: "-36%", plain: "Less interest paid as rates fell; stalls at 11.5%" },
            { line: "Earnings", change: "+18%", plain: "Roughly a quarter of the whole sector's profit" },
          ],
        },
      ],
    },

    // 7 ─ What a dividend announcement means ─────────────────────────────────
    {
      title: "FFC announced a PKR 22 dividend. What does it mean for me?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} book closure, withholding tax, and the exact rupees that will land`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and FFC context", done: true },
        { id: "t1", label: "FFC — your position", detail: "250 shares, PKR 143,250", done: true },
        { id: "t2", label: "FFC — dividend history", detail: "2 payouts on record, 1 announced", done: true },
        { id: "t3", label: "Upcoming payouts — platform calendar", detail: "FFC PKR 22 announced", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "FFC has announced a PKR 22 per share interim dividend. What does that actually mean for me?",
      assistant: `FFC will pay you PKR ${ffcNet.toLocaleString()} in cash, about four weeks after the shares go ex-dividend. The company declared PKR ${ffcDps} for every share held on the book closure date; you hold ${H("FFC").quantity} shares, so the gross amount is PKR ${ffcGross.toLocaleString()}. As a tax filer, 15% withholding tax (PKR ${ffcTax.toLocaleString()}) is deducted before the money reaches your account, leaving PKR ${ffcNet.toLocaleString()} net.

## The terms in the announcement
- **Interim dividend**: a payout declared part-way through the financial year, on top of any final dividend after the year closes. FFC paid PKR 22 and PKR 23 at its last two interims.
- **Book closure**: the company freezes its shareholder register for a few days and pays everyone on it. To be on it you must own the shares before the ex-dividend date, which is ${isoDate(-10)} here; buying on or after that date does not get this payout.
- **Withholding tax**: tax deducted at source. Filers on the FBR's active taxpayer list pay 15%; non-filers pay double that. Your account is set as a filer.

## What it means for your income
This one payment is ${((ffcNet / netIncome) * 100).toFixed(0)}% of the PKR ${(netIncome / 1000).toFixed(1)}k net the whole book paid over the last twelve months, and on your PKR ${H("FFC").avg_cost.toFixed(0)} cost it is a ${((ffcNet / posCost("FFC")) * 100).toFixed(1)}% net yield from a single interim. It does not change the value of your shares: the price usually drops by roughly the dividend on the ex-date, because that cash has left the company.`,
      cards: [
        {
          kind: "timeline",
          title: "From announcement to cash",
          events: [
            { date: isoDate(5), label: "Board declares PKR 22 interim", type: "dividend", detail: "Announced to the PSX" },
            { date: isoDate(-10), label: "Ex-dividend date", type: "dividend", detail: "Shares bought from today are not entitled" },
            { date: isoDate(-9), label: "Book closure begins", type: "corporate", detail: "Register frozen to fix who gets paid" },
            { date: isoDate(-28), label: "Payment date", type: "dividend", value: `PKR ${ffcNet.toLocaleString()} net`, detail: "Credited after 15% withholding" },
          ],
        },
        {
          kind: "table",
          title: "Your FFC payout, computed",
          columns: [
            { key: "line", label: "Line" },
            { key: "value", label: "Amount", align: "right" },
          ],
          rows: [
            { line: "Dividend per share", value: `PKR ${ffcDps.toFixed(2)}` },
            { line: "Shares held", value: `${H("FFC").quantity}` },
            { line: "Gross dividend", value: `PKR ${ffcGross.toLocaleString()}` },
            { line: "Withholding tax (15%, filer)", value: `-PKR ${ffcTax.toLocaleString()}` },
            { line: "Net to your account", value: `PKR ${ffcNet.toLocaleString()}` },
          ],
        },
        {
          kind: "metric-strip",
          title: "FFC income in context",
          metrics: [
            { label: "Net from this payout", value: `PKR ${ffcNet.toLocaleString()}`, tone: "positive" },
            { label: "Yield on your cost", value: `${((ffcNet / posCost("FFC")) * 100).toFixed(1)}%`, detail: "net, this interim alone", tone: "neutral" },
            { label: "FFC share of trailing income", value: `${incomeShare("FFC").toFixed(0)}%`, detail: "of PKR " + (netIncome / 1000).toFixed(1) + "k net", tone: "neutral" },
            { label: "Last two interims", value: "PKR 22, 23", detail: "per share", tone: "neutral" },
          ],
        },
      ],
    },

    // 8 ─ Dividend income and tax ────────────────────────────────────────────
    {
      title: "How much have I earned from dividends, and what did tax take?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} gross and net income over the trailing year, who paid it, and what is already announced`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and PSX context", detail: "holdings and dividend ledger", done: true },
        { id: "t1", label: "Portfolio — all holdings and sector weights", detail: "8 holdings across 7 sectors", done: true },
        { id: "t2", label: "MEBL, UBL, FFC +4 more — dividend history", detail: "7 of 8 payers with history", done: true },
        { id: "t3", label: "Upcoming payouts — platform calendar", detail: "2 announced, 3 forecast", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "How much have I earned from dividends over the last year, and how much did tax take?",
      assistant: `Your holdings paid PKR ${(grossIncome / 1000).toFixed(1)}k gross over the trailing twelve months. Withholding tax at the 15% filer rate took PKR ${(taxTaken / 1000).toFixed(1)}k before the cash reached you, so PKR ${(netIncome / 1000).toFixed(1)}k net landed in your account. That is a ${yocNet.toFixed(1)}% net yield on the PKR ${(totalCost / 1_000_000).toFixed(2)}M you paid for the shares, which is what yield on cost means: income measured against your own purchase price rather than today's market price.

## Who paid it
Seven of eight holdings paid something. UBL was the largest at ${incomeShare("UBL").toFixed(0)}% of the total, a ${yoc("UBL").toFixed(1)}% net yield on your cost from four quarterly payments of PKR 11. Behind it sit OGDC at ${incomeShare("OGDC").toFixed(0)}%, FFC at ${incomeShare("FFC").toFixed(0)}% and MEBL at ${incomeShare("MEBL").toFixed(0)}%. SYS paid nothing, which fits: that position is held for growth. Note that your income and your capital share the same shape: the two banks are ${(incomeShare("UBL") + incomeShare("MEBL")).toFixed(0)}% of income and ${banksWt.toFixed(0)}% of value.

## Tax, in plain terms
Withholding tax is deducted by the company before payment, so the net figure is what you actually received. Pakistan's tax year runs from 1 July to 30 June; dividends are taxed as a separate block at the withholding rate for filers, so for most individual investors the 15% already deducted is the final tax and nothing more is owed on this income at filing time. Being on the active taxpayer list is what keeps the rate at 15% rather than 30%.

## What is already announced
FFC's PKR 22 interim is worth PKR ${Math.round(22 * H("FFC").quantity * 0.85).toLocaleString()} net to you and UBL's PKR 11 quarterly another PKR ${Math.round(11 * H("UBL").quantity * 0.85).toLocaleString()}, both inside the next five weeks. Behind them, the platform forecasts OGDC at PKR 13 to 15 per share, MEBL at 13 to 15 and LUCK at 14 to 18; those are estimates, not yet announced.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Income scorecard, trailing twelve months",
          metrics: [
            { label: "Gross dividends", value: `PKR ${(grossIncome / 1000).toFixed(1)}k`, detail: "before tax", tone: "neutral" },
            { label: "Withholding tax", value: `-PKR ${(taxTaken / 1000).toFixed(1)}k`, detail: "15%, filer rate", tone: "negative" },
            { label: "Net received", value: `PKR ${(netIncome / 1000).toFixed(1)}k`, detail: `${yocNet.toFixed(1)}% net yield on cost`, tone: "positive" },
            { label: "Announced next", value: `PKR ${((Math.round(22 * H("FFC").quantity * 0.85) + Math.round(11 * H("UBL").quantity * 0.85)) / 1000).toFixed(1)}k`, detail: "FFC + UBL, net", tone: "positive" },
          ],
        },
        {
          kind: "allocation",
          title: "Who pays the income",
          description: "Net trailing dividends by holding",
          centerValue: `${yocNet.toFixed(1)}%`,
          centerLabel: "yield on cost",
          segments: Object.entries(divNet)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => ({ label, value })),
        },
        {
          kind: "table",
          title: "Announced and forecast payouts",
          columns: [
            { key: "ticker", label: "Holding" },
            { key: "status", label: "Status" },
            { key: "perShare", label: "Per share", align: "right" },
            { key: "net", label: "Net to you", align: "right" },
          ],
          rows: [
            { ticker: "FFC", status: "Announced", perShare: "PKR 22.00", net: `PKR ${Math.round(22 * H("FFC").quantity * 0.85).toLocaleString()}` },
            { ticker: "UBL", status: "Announced", perShare: "PKR 11.00", net: `PKR ${Math.round(11 * H("UBL").quantity * 0.85).toLocaleString()}` },
            { ticker: "OGDC", status: "Forecast, high confidence", perShare: "PKR 13 to 15", net: divNetRange("OGDC", 13, 15) },
            { ticker: "MEBL", status: "Forecast", perShare: "PKR 13 to 15", net: divNetRange("MEBL", 13, 15) },
            { ticker: "LUCK", status: "Forecast", perShare: "PKR 14 to 18", net: divNetRange("LUCK", 14, 18) },
          ],
        },
      ],
    },

    // 9 ─ A term explained with the user's own figure ─────────────────────────
    {
      title: "What does P/E mean, and what is HUBC's?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} price to earnings in plain words, shown on the one holding that is under water`,
      activity: [
        { id: "ctx", label: "Scanning your portfolio and HUBC context", done: true },
        { id: "t1", label: "HUBC — your position", detail: "500 shares, PKR 116,500", done: true },
        { id: "t2", label: "HUBC — valuation and fundamentals", detail: "FY26 EPS estimate PKR 39.8", done: true },
        { id: "t3", label: "PSX macro backdrop", detail: "policy rate 11.5%", done: true },
        { id: "analyze", label: "Analyzing the evidence", done: true },
        { id: "write", label: "Writing the answer", done: true },
      ],
      user: "What does P/E mean, and what is HUBC's?",
      assistant: `P/E is the share price divided by the company's earnings per share. It tells you how many years of current profit you are paying for when you buy one share, so a P/E of 6 means the price is six times one year's earnings. A low P/E can mean the shares are cheap, or that the market expects profit to fall; the number does not say which.

## HUBC's P/E, from your own figures
HUBC trades at PKR ${H("HUBC").price.toFixed(0)} and the FY26 earnings estimate is PKR ${hubcEps} per share, so the P/E is ${hubcPe.toFixed(1)}x (${H("HUBC").price.toFixed(0)} divided by ${hubcEps}). Turned the other way round, that is an earnings yield of ${hubcEarningsYield.toFixed(1)}%: for every PKR 100 of share price, the company is expected to earn PKR ${hubcEarningsYield.toFixed(0)} this year. The SBP policy rate is 11.5%, so HUBC's earnings yield sits well above the reference rate, which is the usual reason a P/E this low reads as cheap.

## Why the market might still pay this little
The low multiple is not the same as a bargain. HUBC's old contracted power revenue is rolling off as the IPP landscape restructures, and its PKR 15 annualized payout is increasingly funded by dividends from the Thar coal and CPHGC associates. The market is paying ${hubcPe.toFixed(1)}x for earnings it is not sure will hold. Your ${H("HUBC").quantity} shares at PKR ${H("HUBC").avg_cost.toFixed(0)} are down ${Math.abs(retPct(H("HUBC"))).toFixed(0)}% (${kfmt(pl(H("HUBC")))}) while the quarterly PKR 5 payout has kept arriving: PKR ${divNet.HUBC.toLocaleString()} net from the last two.`,
      cards: [
        {
          kind: "gauge",
          title: "HUBC earnings yield against the policy rate",
          value: Math.round(hubcEarningsYield * 10) / 10,
          min: 0,
          max: 25,
          unit: "%",
          markerLabel: `${hubcEarningsYield.toFixed(1)}%`,
          zones: [
            { upTo: 8, label: "Below the rate", tone: "negative" },
            { upTo: 12.5, label: "Around 11.5%", tone: "neutral" },
            { upTo: 25, label: "Well above", tone: "positive" },
          ],
          caption: `Earnings yield is 1 divided by P/E. HUBC at ${hubcPe.toFixed(1)}x gives ${hubcEarningsYield.toFixed(1)}%, versus the SBP rate of 11.5%.`,
        },
        {
          kind: "metric-strip",
          title: "HUBC valuation and position",
          metrics: [
            { label: "Price", value: `PKR ${H("HUBC").price.toFixed(0)}`, tone: "neutral" },
            { label: "FY26 EPS est.", value: `PKR ${hubcEps}`, detail: "consensus estimate", tone: "neutral" },
            { label: "P/E", value: `${hubcPe.toFixed(1)}x`, detail: `earnings yield ${hubcEarningsYield.toFixed(1)}%`, tone: "neutral" },
            { label: "Your position", value: kfmt(pl(H("HUBC"))), delta: `${retPct(H("HUBC")).toFixed(0)}% on cost`, tone: "negative" },
          ],
        },
      ],
    },
  ];
  // Insert oldest first so the newest (index 0, the health check) sorts to the
  // top of the thread list.
  for (let index = threads.length - 1; index >= 0; index -= 1) {
    const item = threads[index];
    const threadTime = iso(60 + index * 90);
    const { data: thread, error: threadError } = await supabase
      .from("chat_threads")
      .insert({
        user_id: userId,
        title: item.title,
        summary: item.summary,
        created_at: threadTime,
        updated_at: threadTime,
        last_message_at: threadTime,
      })
      .select("id")
      .single();
    if (threadError || !thread) throw threadError;

    await supabase.from("chat_messages").insert([
      {
        user_id: userId,
        thread_id: thread.id,
        role: "user",
        content: item.user,
        created_at: iso(60 + index * 90 + 1),
      },
      {
        user_id: userId,
        thread_id: thread.id,
        role: "assistant",
        content: item.assistant,
        cards: [...item.cards.map((spec) => ({ kind: "artifact", data: spec })), { kind: "activity", data: item.activity }],
        created_at: iso(60 + index * 90),
      },
    ]);
  }
}

/** YYYY-MM-DD offset from today. Positive = past, negative = future. */
function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}
