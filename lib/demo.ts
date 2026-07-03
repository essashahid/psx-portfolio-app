import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAlerts } from "@/lib/alerts";

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
  await supabase.from("news_articles").delete().eq("user_id", userId).eq("source", "Demo Data");
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

  // UBL addition scenario (PKR 150k of new money at the current price).
  const addPkr = 150_000;
  const addShares = Math.round(addPkr / H("UBL").price);
  const addCost = addShares * H("UBL").price;
  const ublSharesAfter = H("UBL").quantity + addShares;
  const ublAvgAfter = (posCost("UBL") + addCost) / ublSharesAfter;
  const totalAfter = totalValue + addCost;
  const ublWtAfter = ((ublSharesAfter * H("UBL").price) / totalAfter) * 100;
  const banksAfter = ((ublSharesAfter * H("UBL").price + marketValue(H("MEBL"))) / totalAfter) * 100;
  // The same PKR 150k into SYS instead.
  const sysShares = Math.round(addPkr / H("SYS").price);
  const sysCost = sysShares * H("SYS").price;
  const sysWtAfter = ((marketValue(H("SYS")) + sysCost) / (totalValue + sysCost)) * 100;
  const banksIfSys = ((marketValue(H("MEBL")) + marketValue(H("UBL"))) / (totalValue + sysCost)) * 100;
  const ublIncomeAdd = Math.round(44 * addShares * 0.85);

  // LUCK addition scenario (PKR 100k at the current price).
  const luckPkr = 100_000;
  const luckShares = Math.round(luckPkr / H("LUCK").price);
  const luckCost = luckShares * H("LUCK").price;
  const luckSharesAfter = H("LUCK").quantity + luckShares;
  const luckAvgAfter = (posCost("LUCK") + luckCost) / luckSharesAfter;
  const luckWtAfter = ((luckSharesAfter * H("LUCK").price) / (totalValue + luckCost)) * 100;

  const threads: {
    title: string;
    summary: string;
    user: string;
    assistant: string;
    cards: Record<string, unknown>[];
  }[] = [
    // 1 ─ Comprehensive portfolio assessment (flagship, newest) ──────────────
    {
      title: "Portfolio health check",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} concentration, benchmark, income and what needs attention`,
      user: "Give me a full health check on my portfolio and tell me what actually needs attention.",
      assistant: `The book is in good shape: PKR ${valueM}M across eight names, up ${unrealizedPct}% on cost, and roughly ${excessPts.toFixed(0)} points ahead of the KSE-100 on the same contributions, so it is earning its place rather than riding the index. Two items need attention, and neither is about performance: **HUBC** (${wt("HUBC").toFixed(1)}% of the book, thesis marked weakening, review overdue) and **ENGROH** (${wt("ENGROH").toFixed(1)}%, no written thesis).

## Concentration is the one real risk
MEBL at ${wt("MEBL").toFixed(1)}% and UBL at ${wt("UBL").toFixed(1)}% put ${banksWt.toFixed(0)}% of the book in two banks that share one driver: the policy rate. With the SBP back at 11.5% after April's surprise hike and holding in June, that driver is a near-term margin tailwind, so the urgency here is about shape, not earnings. It is still one bet, not two, so treat the pair as a single sleeve when sizing anything new.

## The gains are broad, which is what you want
SYS is your best position at +${retPct(H("SYS")).toFixed(0)}%, MEBL +${retPct(H("MEBL")).toFixed(0)}% and UBL +${retPct(H("UBL")).toFixed(0)}%. Six of eight names are green and no single one carries the result. The two reds are the same two names flagged above: HUBC at ${retPct(H("HUBC")).toFixed(0)}% and ENGROH at ${retPct(H("ENGROH")).toFixed(0)}%, which is not a coincidence, positions without a live thesis tend to drift.

## Income is solid but concentrated
Trailing dividends are PKR ${(netIncome / 1000).toFixed(1)}k net, a ${yocNet.toFixed(1)}% yield on cost. UBL alone is ${incomeShare("UBL").toFixed(0)}% of that, so a UBL payout cut would hit both the price and the income line at once.

## What I would do
Nothing forced. Resolve HUBC at the overdue review, write a one-paragraph thesis for ENGROH or trim it, and treat the banking pair as your first source of funds if it drifts above ${(banksWt + 3).toFixed(0)}%.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Portfolio at a glance",
          metrics: [
            { label: "Market value", value: `PKR ${valueM}M`, tone: "neutral" },
            { label: "Unrealized P/L", value: `+${kfmt(unrealized)}`, delta: `+${unrealizedPct}% on cost`, tone: "positive" },
            { label: "vs KSE-100", value: `+${excessPts.toFixed(0)} pts`, detail: "excess over the index", tone: "positive" },
            { label: "Income yield on cost", value: `${yocNet.toFixed(1)}%`, detail: `PKR ${(netIncome / 1000).toFixed(0)}k net trailing`, tone: "neutral" },
          ],
        },
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
          description: "Bars are current weights, ticks are your targets",
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
          kind: "portfolio-attribution",
          title: "Unrealized P/L by holding",
          description: "Where the gain actually comes from",
          items: DEMO_HOLDINGS.map((h) => ({ label: h.ticker, value: pl(h), tone: pl(h) >= 0 ? "positive" : "negative" }))
            .sort((a, b) => b.value - a.value),
        },
      ],
    },

    // 2 ─ Event-aware macro: the April hike and June hold ────────────────────
    {
      title: "The April rate hike: which side am I on?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} what the surprise 100bps hike and June hold do to each sleeve`,
      user: "I thought rates were coming down, but the SBP hiked in April and held in June. Which side of that is my portfolio on?",
      assistant: `Mostly the right side, by construction rather than luck. The rate cycle reversed: the SBP took the policy rate from a 22% peak down to 10.5%, then hiked 100 basis points to 11.5% on 27 April as inflation came back, and held there on 15 June. Your ${banksWt.toFixed(0)}% banking sleeve is the direct beneficiary, and it is the largest thing you own.

## Why the SBP turned
CPI printed 11.7% in May, the highest since June 2024 and well above the 5 to 7% target band. That puts the real policy rate at about minus 0.2 points, so there is no room to resume cutting until inflation rolls over. Plan around 11.5% persisting, not around the easing cycle you originally positioned for.

## Who is on which side
- **Banks (MEBL, UBL, ${banksWt.toFixed(0)}%)**: higher for longer protects spreads. The margin-compression risk written in both theses has been pushed out, not cancelled.
- **Cement (LUCK, ${wt("LUCK").toFixed(1)}%)**: the one clear loser. Its profit recovery leaned on a 36% drop in finance costs, and that tailwind stalls at 11.5%. Demand is still recovering, so this cools the thesis rather than breaking it.
- **Power (HUBC, ${wt("HUBC").toFixed(1)}%)**: leverage makes rate relief welcome, and it is now delayed.
- **Dollar earners (SYS ${wt("SYS").toFixed(1)}%, OGDC ${wt("OGDC").toFixed(1)}%)**: rates barely matter here. USD/PKR near 277 and slightly firmer means the FX kicker is dormant; these run on export volumes and oil.

## The read
No action required. The book is hedged across the rate cycle: what the hike takes from LUCK and HUBC it hands to MEBL and UBL with interest. The real casualty is any plan that assumed cheap money by December, so do not size new cyclical buys on that assumption.`,
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

    // 3 ─ Event-aware: OGDC circular debt settlement completed ───────────────
    {
      title: "OGDC after the circular debt settlement",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} the final PKR 7.7bn instalment landed on 24 June, what it changes`,
      user: "OGDC just received the final circular debt payment. Should I add more, or is the catalyst spent?",
      assistant: `Hold what you have and let the next payout announcement decide. The catalyst you bought this for has now fully landed: on 24 June OGDC received the final PKR 7.7 billion instalment, completing the PKR 92 billion interest schedule on top of the PKR 82 billion of principal paid earlier. Your thesis said progress on receivable settlement was upside you were not paying for. It arrived, and the position is up ${retPct(H("OGDC")).toFixed(0)}% against your PKR ${H("OGDC").avg_cost.toFixed(0)} cost.

## Why not add on the news
Two reasons, both from your own book. First, at ${wt("OGDC").toFixed(1)}% the position already sits at your ${targetWt.OGDC}% target, so there is no room without displacing something. Second, the settlement fixes the balance sheet story, but the re-rating from here depends on what management does with the cash: a higher payout, exploration capex, or letting it sit. The platform's forecast payout of PKR 13 to 15 per share would be worth ${divNetRange("OGDC", 13, 15)} net to you.

## What would change the answer
Adding is more defensible if: the next dividend announcement routes settlement cash to shareholders, or production guidance turns up while the valuation stays in the bottom quartile.
Trimming is more defensible if: the cash disappears into unfunded receivables again over the next two results, or the payout stays flat despite the settlement, which would say minority shareholders are last in line.`,
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
          title: "The position after the catalyst",
          metrics: [
            { label: "Unrealized P/L", value: `+${kfmt(pl(H("OGDC")))}`, delta: `+${retPct(H("OGDC")).toFixed(0)}% on cost`, tone: "positive" },
            { label: "Weight", value: `${wt("OGDC").toFixed(1)}%`, detail: `target ${targetWt.OGDC}%`, tone: "neutral" },
            { label: "Settlement received", value: "PKR 174bn", detail: "82bn principal + 92bn interest", tone: "positive" },
            { label: "Forecast payout", value: "PKR 13 to 15", detail: "per share, platform estimate", tone: "neutral" },
          ],
        },
      ],
    },

    // 4 ─ Best position, quality radar ───────────────────────────────────────
    {
      title: "Has the SYS run gone too far?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} quality radar on the best position after a 55% gain`,
      user: "SYS is my best position after this run. Is it too expensive to keep holding?",
      assistant: `Keep it. The question that matters for a held position is whether the growth leg is intact, and the sector tape just confirmed it: Pakistan's IT exports hit a record USD 4.2 billion in the first eleven months of FY26, up about 20% year on year, with December the first ever month above USD 400 million. Your thesis needs export growth above 20%, and the industry is delivering exactly that.

## What the run actually changed
Your ${H("SYS").quantity.toLocaleString()} shares at PKR ${H("SYS").avg_cost.toFixed(0)} are up ${retPct(H("SYS")).toFixed(0)}%, worth ${kfmt(marketValue(H("SYS")))} at ${wt("SYS").toFixed(1)}% of the book. The run raised the price of new money, not the risk of held money. At the current PKR ${H("SYS").price.toFixed(0)} the margin of safety on fresh purchases is thin, which is why the radar scores value lowest, but selling a compounder while its core assumption is being confirmed is how long-term returns get destroyed.

## What would actually end the thesis
Your own sell condition is export growth below 10% for a full year or sustained margin erosion from the wage bill. Neither is in sight: the sector is compounding near 20% and the rupee sitting firm near 277 keeps the dollar-revenue story about volumes, not currency luck. Watch utilisation and wage inflation at the next result; those are the two numbers that would crack the margin before the revenue line slows.`,
      cards: [
        {
          kind: "snowflake",
          title: "SYS quality profile",
          description: "Scored on the evidence in the thesis and the sector tape",
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

    // 5 ─ Decision: add to LUCK on the cement recovery ───────────────────────
    {
      title: "Add PKR 100k to LUCK on the cement recovery?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} strong company case, but the sizing math says no at 100k`,
      user: "Cement demand is clearly recovering. Should I put another PKR 100k into LUCK?",
      assistant: `The company case is the strongest in your book right now, and the portfolio case still says no at that size. PKR 100k would take LUCK from ${wt("LUCK").toFixed(1)}% to ${luckWtAfter.toFixed(1)}% of the book against your ${targetWt.LUCK}% target. You would be right about the company and still have made the book worse.

## The company case is real, not a story
FY26 dispatches are heading for roughly 50 million tonnes, up 7%, the second straight year of recovery, with local sales up 9%. LUCK is taking more than its share: April dispatches rose 18% with local sales up 33%, it produced about a quarter of the entire sector's profit, and its earnings grew 18% helped by a 36% drop in finance costs. Your buy journal from a month ago called exactly this.

## The two things the math cannot ignore
First, the scenario: ${luckShares} shares at PKR ${H("LUCK").price.toFixed(0)} costs PKR ${luckCost.toLocaleString()}, lifts your average from PKR ${H("LUCK").avg_cost.toFixed(0)} to PKR ${luckAvgAfter.toFixed(0)}, and puts ${luckWtAfter.toFixed(1)}% of the portfolio behind one cyclical, ${(luckWtAfter - targetWt.LUCK).toFixed(1)} points over target. Second, the rate turn: the recovery leaned on falling finance costs, and with the SBP holding at 11.5% that specific tailwind has stalled even though demand is intact.

Adding is more defensible if: you first raise the cement target deliberately, dispatches keep compounding near double digits into the winter season, or the SBP resumes cutting.
Waiting is more defensible if: you respect the ${targetWt.LUCK}% cap you set, or the next result shows pricing discipline slipping as volume returns.

If you want cement exposure without the concentration, half the size keeps LUCK inside ${(targetWt.LUCK + 2).toFixed(0)}% and leaves cash for the OGDC payout decision due within weeks.`,
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
          title: "The PKR 100k scenario, computed",
          columns: [
            { key: "metric", label: "Metric" },
            { key: "before", label: "Before", align: "right" },
            { key: "after", label: "After", align: "right" },
          ],
          rows: [
            { metric: "Shares", before: H("LUCK").quantity, after: luckSharesAfter },
            { metric: "Average cost (PKR)", before: H("LUCK").avg_cost.toFixed(0), after: luckAvgAfter.toFixed(0) },
            { metric: "Position weight", before: `${wt("LUCK").toFixed(1)}%`, after: `${luckWtAfter.toFixed(1)}%` },
            { metric: "Target weight", before: `${targetWt.LUCK}%`, after: `${targetWt.LUCK}%` },
            { metric: "New money", before: "", after: `PKR ${luckCost.toLocaleString()} (${luckShares} shares)` },
          ],
        },
      ],
    },

    // 6 ─ The losing position ────────────────────────────────────────────────
    {
      title: "HUBC is red. Cut it or wait?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} the only losing position, judged against a thesis that changed shape`,
      user: "HUBC is my biggest losing position. Do I cut it or give the new story time?",
      assistant: `Hold to your scheduled review with one hard condition attached, and do not add. The position is down ${Math.abs(retPct(H("HUBC"))).toFixed(0)}% (${kfmt(pl(H("HUBC")))}), but the company is not broken: consensus FY26 earnings near PKR 39.8 per share cover the PKR 15 annualized payout more than two and a half times, and you have banked PKR ${divNet.HUBC.toLocaleString()} net from the last two quarterly payments.

## What actually changed
You bought contracted PPA cash flows. That company is going away: legacy PPA revenue is declining as the IPP landscape restructures, and the payout is increasingly funded by dividends from the Thar coal and CPHGC associates, whose contribution grew about 6% last period. Your journal already flagged this when you downgraded the thesis to weakening. The story is now "energy holding company living off associate income", which may be a fine story, but it is not the one you wrote.

## The condition that decides it
If the next two quarterly results show associate dividends covering the PKR 5 per share quarterly payout on their own, rewrite the thesis around that and keep the position. If they do not, exit into strength rather than averaging down: the OGDC settlement completing on 24 June means the same energy-chain capital has a home where the catalyst has already paid, and this ${wt("HUBC").toFixed(1)}% is your natural funding source.`,
      cards: [
        {
          kind: "metric-strip",
          title: "HUBC position",
          metrics: [
            { label: "Unrealized P/L", value: kfmt(pl(H("HUBC"))), delta: `${retPct(H("HUBC")).toFixed(0)}% on cost`, tone: "negative" },
            { label: "Weight", value: `${wt("HUBC").toFixed(1)}%`, detail: `target ${targetWt.HUBC}%`, tone: "neutral" },
            { label: "Payout", value: "PKR 15/sh", detail: "annualized, paid quarterly", tone: "positive" },
            { label: "FY26 EPS est.", value: "PKR 39.8", detail: "covers payout ~2.7x", tone: "neutral" },
          ],
        },
        {
          kind: "comparison-table",
          title: "The thesis you wrote versus the company you own",
          columns: [
            { key: "leg", label: "Thesis leg" },
            { key: "original", label: "As written" },
            { key: "now", label: "Where it stands" },
          ],
          rows: [
            { leg: "Contracted PPA cash", original: "Core of the case", now: "Rolling off as the IPP landscape restructures" },
            { leg: "Dividend", original: "Await resumption", now: "PKR 5 quarterly, funded by associates" },
            { leg: "Thar optionality", original: "Free upside", now: "Now the main earnings driver, up ~6%" },
            { leg: "Circular debt", original: "Key risk", now: "Still gates cash timing across the chain" },
          ],
        },
        {
          kind: "price-chart",
          title: "HUBC against your cost basis",
          ticker: "HUBC",
          period: "1Y",
          overlay: ["cost-basis", "dividends"],
          description: "Underwater on price while the quarterly payout keeps arriving.",
        },
      ],
    },

    // 7 ─ Income deep-dive ───────────────────────────────────────────────────
    {
      title: "Where my dividend income comes from",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} trailing income, payer concentration and what is confirmed next`,
      user: "How much income does this book actually produce, and would it survive one payout cut?",
      assistant: `PKR ${(netIncome / 1000).toFixed(1)}k net over the trailing twelve months, a ${yocNet.toFixed(1)}% yield on cost, and it would survive any single cut except UBL's. UBL alone pays ${incomeShare("UBL").toFixed(0)}% of the total, a ${yoc("UBL").toFixed(1)}% net yield on your cost. That is the best income asset you own and also the single point of failure.

## The shape of the income
Seven of eight holdings paid something in the last year, which is unusually broad. Behind UBL sit OGDC at ${incomeShare("OGDC").toFixed(0)}%, FFC at ${incomeShare("FFC").toFixed(0)}% and MEBL at ${incomeShare("MEBL").toFixed(0)}%, so the middle of the distribution is healthy. LUCK contributes only ${incomeShare("LUCK").toFixed(0)}%, which is fine: that position is there for the construction cycle, not the payout.

## What is already confirmed
FFC's announced PKR 22 interim is worth PKR ${Math.round(22 * H("FFC").quantity * 0.85).toLocaleString()} net to you and UBL's PKR 11 quarterly another PKR ${Math.round(11 * H("UBL").quantity * 0.85).toLocaleString()}, both inside the next five weeks. Behind them, the platform forecasts OGDC at PKR 13 to 15 (the settlement cash makes the top of that range live), MEBL at 13 to 15 and LUCK at 14 to 18 per share.

## The one thing to fix
Nothing needs action today, but note that your income and your capital share the same concentration: the two banks are ${(incomeShare("UBL") + incomeShare("MEBL")).toFixed(0)}% of income and ${banksWt.toFixed(0)}% of value. A rate cycle that eventually turns down would squeeze both at once. Diversifying the next PKR of income toward FFC or OGDC costs you nothing in yield.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Income scorecard, trailing twelve months",
          metrics: [
            { label: "Net income", value: `PKR ${(netIncome / 1000).toFixed(1)}k`, detail: "after 15% withholding", tone: "positive" },
            { label: "Yield on cost", value: `${yocNet.toFixed(1)}%`, detail: "net, whole book", tone: "neutral" },
            { label: "Largest payer", value: `UBL ${incomeShare("UBL").toFixed(0)}%`, detail: `${yoc("UBL").toFixed(1)}% net on cost`, tone: "neutral" },
            { label: "Confirmed next", value: `PKR ${((Math.round(22 * H("FFC").quantity * 0.85) + Math.round(11 * H("UBL").quantity * 0.85)) / 1000).toFixed(1)}k`, detail: "FFC + UBL announced", tone: "positive" },
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

    // 8 ─ Decision: reinvest dividend cash ───────────────────────────────────
    {
      title: "PKR 150k of dividends: UBL or SYS?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} reinvestment decided by portfolio shape, not company merit`,
      user: "I have PKR 150k of dividend cash sitting idle. Reinvest in UBL for the yield or add to SYS?",
      assistant: `SYS, and the deciding factor is what UBL would do to the shape of your book, not any flaw in UBL itself. PKR 150k into UBL lifts the two-bank sleeve from ${banksWt.toFixed(0)}% to ${banksAfter.toFixed(0)}% of the portfolio: one variable, the policy rate, would then set the direction of over 40% of your capital. No single company is good enough to justify that.

## What each option actually does
Into UBL: ${addShares} shares at PKR ${H("UBL").price.toFixed(0)} takes you to ${ublSharesAfter} shares at an average of PKR ${ublAvgAfter.toFixed(0)}, position weight ${ublWtAfter.toFixed(1)}%. The reward is income: at UBL's trailing PKR 44 per share this adds about PKR ${(ublIncomeAdd / 1000).toFixed(1)}k net a year, roughly a ${((ublIncomeAdd / netIncome) * 100).toFixed(0)}% raise to your entire dividend stream.

Into SYS: ${sysShares} shares at PKR ${H("SYS").price.toFixed(0)} dilutes the banks to ${banksIfSys.toFixed(0)}% and makes SYS your largest position at ${sysWtAfter.toFixed(1)}%. You give up essentially all the income and buy more of the one holding whose growth engine, record IT exports compounding near 20%, is independent of the domestic rate cycle that already drives a third of your book.

## The honest trade-off
This is income now versus balance and growth. Since your trailing ${yocNet.toFixed(1)}% yield on cost already leans on UBL for ${incomeShare("UBL").toFixed(0)}% of income, buying more of it concentrates both lines at once. If ${sysWtAfter.toFixed(1)}% in a single name feels heavy, split the ticket: half to SYS, half to OGDC, where the completed circular debt settlement makes the payout forecast of PKR 13 to 15 the next catalyst and your weight still has room only if you rebalance. But between the two names you asked about, it is SYS.`,
      cards: [
        {
          kind: "bar-chart",
          title: "What PKR 150k does to the book's shape",
          description: "Banking sleeve versus SYS weight under each option",
          xKey: "option",
          yUnit: "% of portfolio",
          bars: [
            { key: "banks", label: "Banks (MEBL + UBL)" },
            { key: "sys", label: "SYS" },
          ],
          data: [
            { option: "Today", banks: Math.round(banksWt * 10) / 10, sys: Math.round(wt("SYS") * 10) / 10 },
            { option: "150k into UBL", banks: Math.round(banksAfter * 10) / 10, sys: Math.round(((marketValue(H("SYS")) / totalAfter) * 100) * 10) / 10 },
            { option: "150k into SYS", banks: Math.round(banksIfSys * 10) / 10, sys: Math.round(sysWtAfter * 10) / 10 },
          ],
        },
        {
          kind: "comparison-table",
          title: "The two options, computed",
          columns: [
            { key: "factor", label: "Factor" },
            { key: "ubl", label: "Into UBL" },
            { key: "sys", label: "Into SYS" },
          ],
          rows: [
            { factor: "Shares bought", ubl: `${addShares} at PKR ${H("UBL").price.toFixed(0)}`, sys: `${sysShares} at PKR ${H("SYS").price.toFixed(0)}` },
            { factor: "Banking sleeve after", ubl: `${banksAfter.toFixed(1)}%`, sys: `${banksIfSys.toFixed(1)}%` },
            { factor: "Largest position after", ubl: `UBL ${ublWtAfter.toFixed(1)}%`, sys: `SYS ${sysWtAfter.toFixed(1)}%` },
            { factor: "Income added (net/yr)", ubl: `~PKR ${(ublIncomeAdd / 1000).toFixed(1)}k`, sys: "Negligible" },
            { factor: "Driver added", ubl: "Policy rate (already 33% of book)", sys: "Dollar exports (independent of rates)" },
          ],
        },
      ],
    },

    // 9 ─ Light / concise: benchmark ─────────────────────────────────────────
    {
      title: "Am I beating the market?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} money-weighted return versus the KSE-100 and inflation`,
      user: "The KSE-100 was up 44% in FY26. Am I actually beating the market, or just riding a bull run?",
      assistant: `Beating it, once the comparison is honest. Your capital went in over eighteen months in stages, so the fair benchmark is not the headline 44% fiscal-year print but what the KSE-100 would have returned on your exact contribution schedule: roughly ${kseRet.toFixed(0)}%. Against that, your ${portRet.toFixed(0)}% means about ${excessPts.toFixed(0)} points of excess return that came from selection, not timing luck. Much of your capital arrived after a large part of the FY26 rally had already happened, which is why both numbers sit below 44%.

The index itself is at 184,832, about 3% below its record 189,556, after beating every other asset class for a third straight fiscal year. Inflation is the other hurdle: with CPI at 11.7%, your gains clear the real-wealth bar, but the margin over the index is the number that reflects skill. Keep scoring yourself on that excess, not on the bull-market tide.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Return scorecard",
          metrics: [
            { label: "Your portfolio", value: `+${portRet.toFixed(0)}%`, detail: "on invested capital", tone: "positive" },
            { label: "KSE-100, same schedule", value: `+${kseRet.toFixed(0)}%`, detail: "money-weighted equivalent", tone: "neutral" },
            { label: "Excess return", value: `+${excessPts.toFixed(0)} pts`, detail: "your selection", tone: "positive" },
            { label: "Inflation (CPI)", value: "11.7%", detail: "year-on-year hurdle", tone: "neutral" },
          ],
        },
        {
          kind: "benchmark-excess",
          title: "Is each holding earning its place?",
          description: "Return since purchase minus the index over your holding period",
          benchmarkLabel: "KSE-100",
          items: DEMO_HOLDINGS.map((h) => ({
            label: h.ticker,
            returnPct: Math.round(retPct(h) * 10) / 10,
            benchmarkPct: Math.round(kseRet * 10) / 10,
          })).sort((a, b) => b.returnPct - a.returnPct),
        },
        {
          kind: "gauge",
          title: "KSE-100 within its 52-week range",
          value: 184832,
          min: 129776,
          max: 191033,
          unit: "pts",
          markerLabel: "184,832",
          zones: [
            { upTo: 150000, label: "Washed out", tone: "positive" },
            { upTo: 178000, label: "Mid range", tone: "neutral" },
            { upTo: 191033, label: "Near record", tone: "negative" },
          ],
          caption: "Third straight fiscal year the index beat every other asset class; +44% in FY26.",
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
        cards: item.cards.map((spec) => ({ kind: "artifact", data: spec })),
        created_at: iso(60 + index * 90),
      },
    ]);
  }
}

/** YYYY-MM-DD offset from today. Positive = past, negative = future. */
function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}
