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
export const DEMO_THREAD_COUNT = 7;

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
      expectation: "Dividend resumption and a re-rating as circular-debt flows improve.",
      time_horizon: "2-3 years",
      key_risks: "Circular debt delaying payments; PPA renegotiation reducing returns; capex into new ventures diluting cash returns.",
      sell_conditions: "Another broad PPA renegotiation that cuts contracted returns.",
      add_conditions: "Confirmed dividend resumption at historical payout levels.",
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
      title: "IT export remittances hit a new high",
      body: "Sector export remittances printed another record this quarter. Reinforces the dollar-revenue thesis for SYS. No action needed, staying the course and watching utilisation and the wage bill.",
      confidence: 5,
      source: "demo",
    },
    {
      ticker: "HUBC",
      entry_date: daysAgo(18),
      entry_type: "hold_review",
      title: "HUBC thesis downgraded to weakening",
      body: "Dividend is still paused and the PPA renegotiation chatter has not gone away. Moved the thesis to Weakening. I will decide at the next review whether the original contracted-cash-flow case still stands or whether this capital is better placed in OGDC.",
      expected_outcome: "Clarity on the dividend and on contracted returns within one or two quarters.",
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
      entry_date: daysAgo(34),
      entry_type: "thesis_note",
      title: "Why OGDC despite the circular debt",
      body: "The valuation already prices in a permanently broken balance sheet. I am being paid a dividend to wait, and any progress on receivable settlement is upside that I am not paying for. Watching the receivable balance closely each result.",
      confidence: 3,
      source: "demo",
    },
  ];
  for (const j of journal) {
    await supabase.from("journal_entries").insert({ user_id: userId, ...j });
  }

  // ── News ────────────────────────────────────────────────────────────────────
  const news = [
    {
      ticker: "MEBL",
      company_name: "Meezan Bank Limited",
      sector: "Commercial Banks",
      title: "Meezan Bank posts record quarterly profit on deposit growth",
      url: "https://example.com/demo/mebl-results",
      source: "Demo Data",
      published_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      snippet: "Meezan Bank reported a record quarterly profit driven by strong deposit growth and a stable spread. (Illustrative demo article.)",
      ai_summary: "Record quarterly profit on deposit growth and a stable margin. The board also reviewed the payout policy.",
      sentiment: "positive",
      relevance_score: 9,
      why_it_matters: "Directly confirms the earnings-growth leg of your MEBL thesis.",
      thesis_impact: "Supports the thesis. No change needed.",
      review_question: "Is deposit growth still above the sector average?",
      category: "result",
    },
    {
      ticker: "SYS",
      company_name: "Systems Limited",
      sector: "Technology & Communication",
      title: "Systems Limited guides to over 20% export revenue growth",
      url: "https://example.com/demo/sys-guidance",
      source: "Demo Data",
      published_at: new Date(Date.now() - 1 * 86400000).toISOString(),
      snippet: "Management reiterated guidance for export-led revenue growth above 20% and flagged improving utilisation. (Illustrative demo article.)",
      ai_summary: "Guidance for over 20% export revenue growth with improving utilisation and a stable margin outlook.",
      sentiment: "positive",
      relevance_score: 9,
      why_it_matters: "This is the core growth assumption behind your SYS position.",
      thesis_impact: "Supports the thesis. The dollar-revenue case is intact.",
      review_question: "Is the growth coming from new logos or just existing accounts?",
      category: "result",
    },
    {
      ticker: "HUBC",
      company_name: "The Hub Power Company Limited",
      sector: "Power Generation & Distribution",
      title: "Government revisits IPP agreements in a new round of talks",
      url: "https://example.com/demo/hubc-ipp-talks",
      source: "Demo Data",
      published_at: new Date(Date.now() - 1 * 86400000).toISOString(),
      snippet: "A fresh round of discussions with independent power producers could revisit contracted returns. (Illustrative demo article.)",
      ai_summary: "Renewed IPP renegotiation talks may touch contracted returns for legacy power producers.",
      sentiment: "negative",
      relevance_score: 8,
      why_it_matters: "PPA renegotiation is the exact risk named in your HUBC thesis.",
      thesis_impact: "May weaken the thesis. The cash-flow case depends on contracted returns.",
      review_question: "Does the original cash-flow case survive another round of PPA cuts?",
      category: "corporate_announcement",
    },
    {
      ticker: "FFC",
      company_name: "Fauji Fertilizer Company Limited",
      sector: "Fertilizer",
      title: "Fauji Fertilizer announces interim cash dividend",
      url: "https://example.com/demo/ffc-dividend",
      source: "Demo Data",
      published_at: new Date(Date.now() - 4 * 86400000).toISOString(),
      snippet: "The FFC board announced an interim cash dividend alongside quarterly results. (Illustrative demo article.)",
      ai_summary: "Interim cash dividend declared, consistent with the historical payout pattern.",
      sentiment: "positive",
      relevance_score: 8,
      why_it_matters: "The dividend stream is the core of your FFC position.",
      thesis_impact: "Supports the income leg of the thesis.",
      review_question: "Is the payout ratio holding at historical levels?",
      category: "dividend",
    },
    {
      ticker: "OGDC",
      company_name: "Oil & Gas Development Company Limited",
      sector: "Oil & Gas Exploration",
      title: "E&P sector receivables ease as settlement plan advances",
      url: "https://example.com/demo/ogdc-receivables",
      source: "Demo Data",
      published_at: new Date(Date.now() - 5 * 86400000).toISOString(),
      snippet: "Reports suggest progress on a plan to settle long-standing energy-sector receivables. (Illustrative demo article.)",
      ai_summary: "Progress on an energy-chain receivable settlement that has historically capped exploration-company cash returns.",
      sentiment: "positive",
      relevance_score: 7,
      why_it_matters: "Receivable settlement is the upside trigger in your OGDC thesis.",
      thesis_impact: "Supports the re-rating case if the plan is actually funded.",
      review_question: "Is this a funded settlement or another announcement without cash behind it?",
      category: "corporate_announcement",
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
- **SYS** reiterated guidance for export revenue growth above 20%. This is the core assumption behind the position, and it is holding. [Source](https://example.com/demo/sys-guidance)
- **MEBL** posted a record quarterly profit on deposit growth, which confirms the earnings leg of the thesis. [Source](https://example.com/demo/mebl-results)
- **HUBC** is back in the news on a fresh round of IPP renegotiation talks. This is the exact risk named in the thesis. [Source](https://example.com/demo/hubc-ipp-talks)

## Holdings requiring review
- **HUBC** review date has passed and the thesis is marked *Weakening*.
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
  const divNet: Record<string, number> = {
    UBL: Math.round(44 * H("UBL").quantity * 0.85),
    OGDC: Math.round(27 * H("OGDC").quantity * 0.85),
    FFC: Math.round(45 * H("FFC").quantity * 0.85),
    MEBL: Math.round(28 * H("MEBL").quantity * 0.85),
    ENGROH: Math.round(20 * H("ENGROH").quantity * 0.85),
    LUCK: Math.round(16 * H("LUCK").quantity * 0.85),
  };
  const netIncome = Object.values(divNet).reduce((s, v) => s + v, 0);
  const yocNet = (netIncome / totalCost) * 100;
  const yoc = (t: string) => (divNet[t] / posCost(t)) * 100;
  const incomeShare = (t: string) => (divNet[t] / netIncome) * 100;

  // Benchmark comparison, computed the same way as seedBenchmarkSeries so prose
  // and the growth chart agree: KSE lands at 0.74 of the portfolio's excess.
  const portRet = (totalValue / totalCost - 1) * 100;
  const kseRet = portRet * 0.74;
  const excessPts = portRet - kseRet;

  // UBL addition scenario (PKR 150k of new money at the current price).
  const addPkr = 150_000;
  const addShares = Math.round(addPkr / H("UBL").price);
  const addCost = addShares * H("UBL").price;
  const ublSharesAfter = H("UBL").quantity + addShares;
  const ublAvgAfter = (posCost("UBL") + addCost) / ublSharesAfter;
  const totalAfter = totalValue + addCost;
  const ublWtAfter = ((ublSharesAfter * H("UBL").price) / totalAfter) * 100;
  const banksAfter = ((ublSharesAfter * H("UBL").price + marketValue(H("MEBL"))) / totalAfter) * 100;

  const threads: {
    title: string;
    summary: string;
    user: string;
    assistant: string;
    cards: Record<string, unknown>[];
  }[] = [
    // 1 ─ Comprehensive portfolio assessment ────────────────────────────────
    {
      title: "Portfolio health check",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} concentration, benchmark, income and what needs attention`,
      user: "Give me a full health check on my portfolio and tell me what actually needs attention.",
      assistant: `The book is in good shape: PKR ${valueM}M across eight names, up ${unrealizedPct}% on cost, and roughly ${excessPts.toFixed(0)} points ahead of the KSE-100 over the same capital, so it is earning its place rather than just riding the index. Two items need attention, and neither is about performance: **HUBC** (${wt("HUBC").toFixed(0)}% of the book, thesis marked weakening, review overdue) and **ENGROH** (${wt("ENGROH").toFixed(0)}%, no written thesis).

## Concentration is the one real risk
MEBL at ${wt("MEBL").toFixed(0)}% and UBL at ${wt("UBL").toFixed(0)}% put ${banksWt.toFixed(0)}% of the book in two banks that share one driver: the policy rate. With the SBP at 11% and cutting, that is a slow margin headwind for both at once, cushioned by bond-book revaluation. It is a deliberate bet, but it is one bet, not two, so size it as a pair.

## The gains are broad, which is what you want
SYS is your best position at +${retPct(H("SYS")).toFixed(0)}%, MEBL +${retPct(H("MEBL")).toFixed(0)}% and UBL +${retPct(H("UBL")).toFixed(0)}%. No single name carries the result, so a stumble in one does not sink the portfolio.

## Income is solid but concentrated
Trailing dividends are PKR ${(netIncome / 1000).toFixed(1)}k net, a ${yocNet.toFixed(1)}% yield on cost. UBL alone is ${incomeShare("UBL").toFixed(0)}% of that, so a UBL payout cut would be felt across both the price and the income line.

## What I would do
Nothing forced. Resolve HUBC on the next results or PPA update, write a one-line thesis for ENGROH or trim it, and treat the banking pair as your first source of funds if it drifts higher.`,
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
          kind: "portfolio-attribution",
          title: "Unrealized P/L by holding",
          description: "Where the gain actually comes from",
          items: DEMO_HOLDINGS.map((h) => ({ label: h.ticker, value: pl(h), tone: pl(h) >= 0 ? "positive" : "negative" }))
            .sort((a, b) => b.value - a.value),
        },
        {
          kind: "comparison-table",
          title: "Concentration versus target",
          columns: [
            { key: "ticker", label: "Holding" },
            { key: "weight", label: "Weight" },
            { key: "target", label: "Target" },
            { key: "read", label: "Read" },
          ],
          rows: [
            { ticker: "MEBL", weight: `${wt("MEBL").toFixed(0)}%`, target: "16%", read: "In line, quality bank" },
            { ticker: "UBL", weight: `${wt("UBL").toFixed(0)}%`, target: "14%", read: "Above target, income bank" },
            { ticker: "OGDC", weight: `${wt("OGDC").toFixed(0)}%`, target: "13%", read: "In line" },
            { ticker: "HUBC", weight: `${wt("HUBC").toFixed(0)}%`, target: "8%", read: "Weakening thesis, review" },
            { ticker: "ENGROH", weight: `${wt("ENGROH").toFixed(0)}%`, target: "9%", read: "No thesis on file" },
          ],
        },
      ],
    },

    // 2 ─ Stress Testing / Scenario Analysis ─────────────────────────────────
    {
      title: "Stress test: another 200bps rate cut?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} simulating the impact of a sharp rate cut on portfolio beta and margins`,
      user: "What happens to my portfolio if the SBP cuts rates by another 200bps sharply?",
      assistant: `A 200bps cut is a net positive for your portfolio overall, but it fundamentally reshapes where your returns come from. Your banking sleeve (${banksWt.toFixed(0)}%) takes a direct margin hit, while your cyclicals (${(wt("LUCK") + wt("HUBC")).toFixed(0)}%) see a sharp re-rating.
      
## The Banking Drag
MEBL and UBL will see net interest margins compress. While bond-book revaluation provides a one-off cushion, the core earnings power drops. A 200bps cut typically shaves 12-15% off forward EPS estimates for the sector.

## The Cyclical Offset
LUCK is the primary beneficiary. Lower financing costs improve margins, but more importantly, a lower cost of capital stimulates construction demand. HUBC also benefits from reduced leverage costs, although circular debt remains the gating factor for cash.

## The Verdict
Your portfolio is well-balanced for this scenario. The capital appreciation from LUCK and the broader market multiple expansion (KSE-100 re-rating) will more than offset the income drag from the banks. No urgent reallocation is required, but capping the banking sleeve is crucial.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Simulated 200bps Cut Impact",
          metrics: [
            { label: "Portfolio Beta", value: "0.85", detail: "Defensive leaning", tone: "neutral" },
            { label: "Simulated P/L", value: `+PKR ${Math.round(totalValue * 0.045 / 1000)}k`, detail: "+4.5% net impact", tone: "positive" },
            { label: "Bank EPS Impact", value: "-14%", detail: "Forward 12m est.", tone: "negative" },
            { label: "Cement Re-rating", value: "+22%", detail: "Multiple expansion", tone: "positive" },
          ],
        },
        {
          kind: "comparison-table",
          title: "Pre vs Post Rate Cut EPS Estimates (Illustrative)",
          columns: [
            { key: "ticker", label: "Holding" },
            { key: "current", label: "Current Est. EPS" },
            { key: "post", label: "Post-Cut EPS" },
            { key: "impact", label: "Impact" },
          ],
          rows: [
            { ticker: "MEBL", current: "PKR 45.0", post: "PKR 39.5", impact: "-12%" },
            { ticker: "UBL", current: "PKR 52.0", post: "PKR 44.5", impact: "-14%" },
            { ticker: "LUCK", current: "PKR 85.0", post: "PKR 98.0", impact: "+15%" },
            { ticker: "SYS", current: "PKR 32.0", post: "PKR 32.5", impact: "Neutral" },
          ],
        },
      ],
    },

    // 3 ─ Tactical Reallocation / DRIP ───────────────────────────────────────
    {
      title: "Reinvest PKR 150k in UBL or buy SYS?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} analyzing dividend reinvestment vs growth diversification`,
      user: "I have PKR 150k in cash from dividends. Should I reinvest it in UBL for the yield or buy more SYS?",
      assistant: `Buy SYS. Reinvesting in UBL right now increases an already concentrated banking bet, whereas SYS offers a fundamentally different growth engine and diversifies your income away from the domestic rate cycle.
      
## The Concentration Problem
Putting PKR 150k back into UBL lifts your banking sleeve to ${banksAfter.toFixed(0)}%. While the ${yoc("UBL").toFixed(0)}% yield is tempting, you are doubling down on a single macroeconomic driver (the policy rate) right as it enters an easing cycle.

## The Growth Alternative
SYS (${wt("SYS").toFixed(0)}% of book) provides a US-dollar revenue hedge and export-led growth. While its dividend yield is negligible, its total return profile is driven by volume and utilization, not interest rates. 

## The Compounding Math
If you DRIP into UBL, your current income rises, but your capital is exposed to margin compression. Allocating to SYS sacrifices immediate yield for capital appreciation, keeping your portfolio balanced between domestic income and export growth.`,
      cards: [
        {
          kind: "bar-chart",
          title: "Projected 5-Year Value: UBL DRIP vs SYS Growth (Illustrative)",
          xKey: "year",
          yUnit: "PKR '000",
          bars: [
            { key: "ubl", label: "UBL (Yield Focus)", color: "#0ea5e9" },
            { key: "sys", label: "SYS (Growth Focus)", color: "#10b981" },
          ],
          data: [
            { year: "Year 1", ubl: 165, sys: 175 },
            { year: "Year 2", ubl: 182, sys: 205 },
            { year: "Year 3", ubl: 200, sys: 240 },
            { year: "Year 4", ubl: 220, sys: 280 },
            { year: "Year 5", ubl: 242, sys: 325 },
          ],
        },
        {
          kind: "comparison-table",
          title: "Risk/Reward Profile",
          columns: [
            { key: "factor", label: "Factor" },
            { key: "ubl", label: "UBL Reinvestment" },
            { key: "sys", label: "SYS Allocation" },
          ],
          rows: [
            { factor: "Primary Driver", ubl: "Policy Rate (Domestic)", sys: "Export Volumes (Global)" },
            { factor: "Portfolio Risk", ubl: `Increases Bank Weight to ${banksAfter.toFixed(0)}%`, sys: "Maintains balanced exposure" },
            { factor: "Expected Return", ubl: "High Yield, Low Growth", sys: "Low Yield, High Growth" },
          ],
        },
      ],
    },

    // 4 ─ Deep Dive Fundamental Convergence ──────────────────────────────────
    {
      title: "Is SYS fundamentally overvalued?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} converging technical momentum with valuation multiples for SYS`,
      user: "SYS has run up significantly. Is it fundamentally overvalued now, or does the growth justify it?",
      assistant: `The growth justifies the current valuation, but the margin of safety is narrower than it was at your entry. At your cost basis of PKR ${H("SYS").avg_cost}, you captured the re-rating. At the current price of PKR ${H("SYS").price}, you are paying a premium for execution, but the multiples are not yet stretched into bubble territory.

## The Valuation Case
SYS is currently trading at a trailing P/E of roughly 18x. While this is a premium to the KSE-100 average, it is reasonable for a company guiding to >20% export revenue growth. The PEG (Price/Earnings-to-Growth) ratio remains below 1.0, indicating that the growth rate still outpaces the multiple.

## The Technical View
The price chart shows strong momentum, comfortably above its 50-day and 200-day moving averages. The recent run-up is supported by volume, confirming institutional appetite. 

## The Verdict
Hold. Taking profit now means stepping off a compounding engine prematurely. As long as management delivers on the 20% growth guidance and utilization improves, the premium multiple is warranted.`,
      cards: [
        {
          kind: "metric-strip",
          title: "SYS Valuation & Momentum",
          metrics: [
            { label: "Trailing P/E", value: "18.2x", detail: "Premium to market", tone: "neutral" },
            { label: "Est. PEG Ratio", value: "0.85", detail: "< 1.0 is favorable", tone: "positive" },
            { label: "Export Growth", value: ">20%", detail: "Management guidance", tone: "positive" },
            { label: "RSI (14-day)", value: "68", detail: "Approaching overbought", tone: "negative" },
          ],
        },
        {
          kind: "price-chart",
          title: "SYS Price vs Cost Basis",
          ticker: "SYS",
          period: "1Y",
          overlay: ["cost-basis"],
          description: "Strong momentum, well above your entry price.",
        },
      ],
    },

    // 5 ─ Sector Rotation Warning ────────────────────────────────────────────
    {
      title: "Rotate from FFC into OGDC?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} analyzing a sector rotation from Fertilizer to E&P`,
      user: "Should I take my profits in FFC and rotate into OGDC ahead of the winter gas shortages?",
      assistant: `This is a classic "Quality vs. Deep Value" rotation. It is defensible if you have a high risk tolerance, but you would be trading a highly reliable dividend stream (FFC) for a volatile re-rating story (OGDC) that relies on government action.

## The Case for FFC (Quality & Income)
FFC gives you pricing power. Even with gas price hikes or winter curtailments, they have historically passed costs onto the farmer. The ${yoc("FFC").toFixed(0)}% yield on cost is arguably the safest in your book. Selling it removes your most reliable defensive anchor.

## The Case for OGDC (Deep Value)
OGDC trades at distressed multiples (P/E < 4x). The upside is massive *if* the circular debt settlement plan is executed. However, if the plan stalls, you are holding dead money that only pays a modest dividend while you wait.

## The Verdict
Do not rotate completely. FFC and OGDC serve different purposes. If you want more exposure to the E&P re-rating, use fresh capital or trim your banking exposure (UBL/MEBL) rather than selling your best defensive asset.`,
      cards: [
        {
          kind: "portfolio-attribution",
          title: "Current Risk Contribution",
          description: "How these sectors affect your P/L",
          items: [
            { label: "FFC (Fertilizer)", value: pl(H("FFC")), tone: "positive" },
            { label: "OGDC (E&P)", value: pl(H("OGDC")), tone: "positive" },
          ],
        },
        {
          kind: "timeline",
          title: "The Circular Debt & Gas Pricing Catalyst",
          events: [
            { date: isoDate(5), label: "E&P receivables settlement plan advances", type: "corporate", detail: "Positive for OGDC." },
            { date: isoDate(12), label: "Expected winter gas tariff hikes", type: "news", detail: "Cost pressure for FFC, revenue boost for OGDC." },
            { date: isoDate(60), label: "FFC interim cash dividend declared", type: "dividend", detail: "Confirms FFC's cash generation." },
          ],
        },
      ],
    },

    // 6 ─ Light / concise: benchmark (Original 4) ────────────────────────────
    {
      title: "Am I beating the market?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} portfolio return versus the KSE-100 and inflation`,
      user: "Am I actually beating the market, or just riding it?",
      assistant: `Beating it, and by a real margin rather than noise. You are up ${portRet.toFixed(0)}% on invested capital against roughly ${kseRet.toFixed(0)}% for the KSE-100 over the same contributions, so about ${excessPts.toFixed(0)} points of excess return that is yours, not the index's.

Inflation is the honest hurdle. With CPI running near 11.7% year-on-year, a nominal gain has to clear that to build real wealth, and this book does, but not by a wide margin. The number to keep watching is the excess over the index, because that is the part that reflects your selection rather than the market tide.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Return scorecard",
          metrics: [
            { label: "Your portfolio", value: `+${portRet.toFixed(0)}%`, detail: "on invested capital", tone: "positive" },
            { label: "KSE-100 equivalent", value: `+${kseRet.toFixed(0)}%`, detail: "same contributions", tone: "neutral" },
            { label: "Excess return", value: `+${excessPts.toFixed(0)} pts`, detail: "your selection", tone: "positive" },
            { label: "Inflation (CPI)", value: "~11.7%", detail: "year-on-year hurdle", tone: "neutral" },
          ],
        },
      ],
    },

    // 7 ─ Moderate: macro / rate exposure (Original 6) ───────────────────────
    {
      title: "What falling rates mean for me",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} policy-rate and USD/PKR exposure across the book`,
      user: "Rates are coming down and the rupee has been stable. What does that mean for my holdings?",
      assistant: `Net effect is close to neutral, because the biggest lever cuts two ways across your book. The SBP has taken the policy rate to 11% from a 22% peak, and your ${banksWt.toFixed(0)}% banking weight sees slowly compressing margins from that, offset by revaluation gains on bank bond books. The rate-sensitive cyclicals lean the other way.

## Who gains as rates fall
- **LUCK** (${wt("LUCK").toFixed(0)}%): cheaper project financing and stronger construction demand. This is the clearest beneficiary and the reason the position was added.
- **HUBC** (${wt("HUBC").toFixed(0)}%): heavy leverage means lower financing costs help, though circular debt still gates the cash.

## Who the currency drives, not rates
- **SYS** (${wt("SYS").toFixed(0)}%) and **OGDC** (${wt("OGDC").toFixed(0)}%) earn in US dollars. That normally makes rupee weakness a tailwind, but USD/PKR near 278 is actually about 1.8% firmer over the past year, so the currency kicker is dormant. SYS rests on volume and utilisation right now, not depreciation, and OGDC on the oil price.

## The read
No trade here, just awareness: your largest sleeve is a mild rate headwind, your cyclicals are the offset, and your dollar earners are not getting the FX help this year that the thesis assumes long term. With CPI near 11.7% and the policy rate at 11%, the real rate is about 0.7 points below inflation, so the easing cycle has less cushion than the headline rate suggests.`,
      cards: [
        {
          kind: "metric-strip",
          title: "PSX macro backdrop",
          metrics: [
            { label: "Policy rate", value: "11.0%", delta: "from 22% peak", tone: "neutral" },
            { label: "Inflation (CPI)", value: "11.7%", detail: "year-on-year", tone: "neutral" },
            { label: "Real policy rate", value: "-0.7 pts", detail: "rate minus CPI", tone: "neutral" },
            { label: "USD/PKR", value: "278", delta: "PKR firmer, -1.8% y/y", tone: "neutral" },
          ],
        },
        {
          kind: "comparison-table",
          title: "How the backdrop hits each sleeve",
          columns: [
            { key: "sleeve", label: "Sleeve" },
            { key: "weight", label: "Weight" },
            { key: "driver", label: "Main driver" },
            { key: "read", label: "Net read" },
          ],
          rows: [
            { sleeve: "Banks (MEBL, UBL)", weight: `${banksWt.toFixed(0)}%`, driver: "Policy rate", read: "Margin drag, bond-book offset" },
            { sleeve: "Cement (LUCK)", weight: `${wt("LUCK").toFixed(0)}%`, driver: "Rates + construction", read: "Tailwind as rates fall" },
            { sleeve: "Power (HUBC)", weight: `${wt("HUBC").toFixed(0)}%`, driver: "Leverage + circular debt", read: "Helped, but cash gated" },
            { sleeve: "Exporters (SYS, OGDC)", weight: `${(wt("SYS") + wt("OGDC")).toFixed(0)}%`, driver: "USD/PKR", read: "FX kicker dormant, PKR firm" },
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
