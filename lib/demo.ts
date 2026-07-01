import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAlerts } from "@/lib/alerts";

/**
 * Demo dataset for the shared, read-only public demo workspace.
 *
 * The goal is that a first-time visitor sees a realistic, fully populated PSX
 * portfolio: eight blue-chip positions across seven sectors, a six-month value
 * history, a portfolio-vs-KSE-100-vs-inflation growth series, received and
 * upcoming dividends, theses, journal entries, news and a library of curated
 * Research Copilot threads that show off every chart and table the assistant
 * can render.
 *
 * Prices are anchored to the real PSX close (June 2026) so the inline price
 * charts, which pull live end-of-day data, agree with the position values and
 * metric strips shown next to them. Cost bases, dividends and commentary are
 * illustrative but internally consistent, so no screen contradicts another.
 */

// ── Holdings ──────────────────────────────────────────────────────────────────
// price ~ real PSX close; avg_cost is the illustrative entry. quantity x price
// drives the live valuation, quantity x avg_cost drives the cost basis.
const DEMO_HOLDINGS = [
  { ticker: "MEBL", company_name: "Meezan Bank Limited", sector: "Commercial Banks", quantity: 400, avg_cost: 400.0, price: 516.0 },
  { ticker: "UBL", company_name: "United Bank Limited", sector: "Commercial Banks", quantity: 450, avg_cost: 360.0, price: 448.0 },
  { ticker: "FFC", company_name: "Fauji Fertilizer Company Limited", sector: "Fertilizer", quantity: 250, avg_cost: 470.0, price: 573.0 },
  { ticker: "OGDC", company_name: "Oil & Gas Development Company Limited", sector: "Oil & Gas Exploration", quantity: 500, avg_cost: 300.0, price: 335.0 },
  { ticker: "SYS", company_name: "Systems Limited", sector: "Technology & Communication", quantity: 1000, avg_cost: 118.0, price: 147.0 },
  { ticker: "LUCK", company_name: "Lucky Cement Limited", sector: "Cement", quantity: 250, avg_cost: 400.0, price: 470.0 },
  { ticker: "HUBC", company_name: "The Hub Power Company Limited", sector: "Power Generation & Distribution", quantity: 500, avg_cost: 260.0, price: 233.0 },
  { ticker: "ENGROH", company_name: "Engro Holdings Limited", sector: "Conglomerate", quantity: 450, avg_cost: 315.0, price: 288.0 },
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
    { ticker: "MEBL", target_price: 620, target_allocation: 16, review_level: 460 },
    { ticker: "UBL", target_price: 540, target_allocation: 14, review_level: 400 },
    { ticker: "FFC", target_price: 680, target_allocation: 12, review_level: 520 },
    { ticker: "OGDC", target_price: 400, target_allocation: 13, review_level: 300 },
    { ticker: "SYS", target_price: 185, target_allocation: 14, review_level: 130 },
    { ticker: "LUCK", target_price: 560, target_allocation: 10, review_level: 420 },
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
3. The two banks together are the largest sleeve in the book. Is that deliberate?

_This is portfolio research support, not financial advice._`,
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
  // beats both the index and inflation modestly. Inflation grows each
  // contribution from the month it was actually made (~0.6%/month, ~7.4%/year),
  // so recent capital is not over-inflated and the path stays below the
  // portfolio, matching the commentary.
  const months = 18;
  const monthlyInflation = 0.006;
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
    const kse = Math.round(contributed * (1 + (totalValue / totalCost - 1) * 0.82 * t + Math.sin(i * 0.7) * 0.02));
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
  const wt = (t: string) => (marketValue(H(t)) / totalValue) * 100;
  const banksWt = ((marketValue(H("MEBL")) + marketValue(H("UBL"))) / totalValue) * 100;

  // Net received per holding over the trailing 12 months (gross x 0.85).
  const divNet: Record<string, number> = {
    UBL: Math.round(44 * H("UBL").quantity * 0.85),
    OGDC: Math.round(27 * H("OGDC").quantity * 0.85),
    FFC: Math.round(45 * H("FFC").quantity * 0.85),
    MEBL: Math.round(28 * H("MEBL").quantity * 0.85),
    ENGROH: Math.round(20 * H("ENGROH").quantity * 0.85),
    LUCK: Math.round(16 * H("LUCK").quantity * 0.85),
  };

  const threads: {
    title: string;
    summary: string;
    user: string;
    assistant: string;
    cards: Record<string, unknown>[];
  }[] = [
    {
      title: "Portfolio health check",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} concentration, P/L drivers and what needs attention`,
      user: "Give me a full health check on my portfolio and tell me what needs attention.",
      assistant: `## Short answer
The portfolio is in good shape and well diversified, up about ${unrealizedPct}% on cost at roughly PKR ${valueM}M. It is not "set and forget," though. Two things need attention: **HUBC**, where the thesis is already marked weakening and the review date has passed, and **ENGROH**, which has no written thesis on file.

## What is working
The gains are broad rather than reliant on one name. MEBL, UBL, SYS and FFC are all contributing, so the result does not depend on a single bet. That is the shape you want.

## What I would review first
- **HUBC** is one of only two losers and the thesis is weakening. The IPP renegotiation risk named in the thesis is back in the news, so the contracted-cash-flow case needs confirming before any decision.
- **ENGROH** has no thesis. Decide whether it is deliberate conglomerate exposure or just drift, then either write the reason down or trim it.
- **Banking weight**: MEBL and UBL together are the single largest sleeve at about ${banksWt.toFixed(0)}%. Both are working, but hold that exposure on purpose rather than by accident.

## Next actions
1. Read HUBC's latest filings and dividend posture before adding or trimming.
2. Write a one-paragraph thesis for ENGROH or move it out of the conviction bucket.
3. Keep the rest on a normal review cadence unless a position drifts well above its target weight.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Portfolio snapshot",
          metrics: [
            { label: "Market value", value: `PKR ${valueM}M`, tone: "neutral" },
            { label: "Unrealized P/L", value: `+PKR ${(unrealized / 1000).toFixed(0)}k`, delta: `+${unrealizedPct}%`, tone: "positive" },
            { label: "Holdings", value: "8", detail: "7 sectors" },
            { label: "Needs review", value: "2", tone: "negative", detail: "HUBC, ENGROH" },
          ],
        },
        {
          kind: "portfolio-attribution",
          title: "What is driving the unrealized P/L",
          description: "Contribution to unrealized gain or loss by holding",
          items: DEMO_HOLDINGS.map((h) => ({ label: h.ticker, value: pl(h), tone: pl(h) >= 0 ? "positive" : "negative" }))
            .sort((a, b) => b.value - a.value),
        },
        {
          kind: "comparison-table",
          title: "Concentration check",
          description: "Position weight against your target allocation",
          columns: [
            { key: "ticker", label: "Holding" },
            { key: "weight", label: "Current weight" },
            { key: "target", label: "Target" },
            { key: "read", label: "Read" },
          ],
          rows: [
            { ticker: "MEBL", weight: `${wt("MEBL").toFixed(0)}%`, target: "16%", read: "In line" },
            { ticker: "UBL", weight: `${wt("UBL").toFixed(0)}%`, target: "14%", read: "Above target" },
            { ticker: "OGDC", weight: `${wt("OGDC").toFixed(0)}%`, target: "13%", read: "In line" },
            { ticker: "SYS", weight: `${wt("SYS").toFixed(0)}%`, target: "14%", read: "In line" },
            { ticker: "HUBC", weight: `${wt("HUBC").toFixed(0)}%`, target: "8%", read: "Weakening thesis" },
          ],
        },
      ],
    },
    {
      title: "MEBL position review",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} bank thesis, price vs cost and peer comparison`,
      user: "Review MEBL for me as a long-term holder. Add, hold, or wait? Show it against the other banks.",
      assistant: `## Provisional view
**Hold, and add only on weakness.** MEBL has the cleanest thesis in the book: Islamic-banking leadership, a low-cost deposit base and the highest ROE among the listed banks. The position is well in profit. The only real question is whether adding here would push the banking sleeve above where you want it, since you also hold UBL.

## Company case
The recorded thesis is built on a structurally cheaper deposit base and best-in-class profitability, and the latest results support it with a record quarterly profit on deposit growth. The chart below shows the price against your average cost.

## Versus the other banks
MEBL is the quality-and-growth name; UBL is the income name. Held together they cover both ends of the banking trade, but they will move together when rates move, so size the pair as one decision.

## Decision conditions
- Add only if deposit growth stays above the sector average and the valuation does not already price in perfection.
- Hold while spreads normalise as long as asset quality holds.
- Revisit if ROE falls below the recorded sell-condition threshold for two consecutive years.`,
      cards: [
        {
          kind: "price-chart",
          title: "MEBL price vs your cost basis",
          ticker: "MEBL",
          period: "1Y",
          overlay: ["cost-basis"],
          description: "Live PSX price history with your average cost overlaid.",
        },
        {
          kind: "comparison-table",
          title: "Listed banks at a glance",
          description: "Illustrative figures for context, not live quotes.",
          columns: [
            { key: "bank", label: "Bank" },
            { key: "role", label: "Role in book" },
            { key: "roe", label: "ROE" },
            { key: "yield", label: "Div. yield" },
            { key: "note", label: "Note" },
          ],
          rows: [
            { bank: "MEBL", role: "Quality / growth", roe: "~26%", yield: "~5%", note: "Held. Low-cost deposit base" },
            { bank: "UBL", role: "Income", roe: "~20%", yield: "~10%", note: "Held. High payout" },
            { bank: "HBL", role: "Scale", roe: "~16%", yield: "~9%", note: "Not held" },
            { bank: "MCB", role: "Quality / income", roe: "~19%", yield: "~9%", note: "Not held" },
          ],
        },
        {
          kind: "metric-strip",
          title: "Your MEBL position",
          metrics: [
            { label: "Shares", value: `${H("MEBL").quantity}` },
            { label: "Avg cost", value: `PKR ${H("MEBL").avg_cost.toFixed(2)}` },
            { label: "Last price", value: `PKR ${H("MEBL").price.toFixed(2)}` },
            { label: "Unrealized", value: `+PKR ${(pl(H("MEBL")) / 1000).toFixed(1)}k`, delta: `+${retPct(H("MEBL")).toFixed(1)}%`, tone: "positive" },
          ],
        },
      ],
    },
    {
      title: "Dividend income review",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} received income, receivables and forward estimate`,
      user: "Summarise my dividend income over the last year and what is coming next.",
      assistant: `## Short answer
The income base is healthy and broad. Over the last year you received cash dividends from **UBL, OGDC, FFC, MEBL, ENGROH and LUCK**. UBL is the single largest payer, with OGDC and FFC close behind, so the income leans on the banks, energy and fertilizer rather than any one name. There are confirmed receivables from FFC and UBL right now, plus forward estimates for OGDC, MEBL and LUCK.

## What was received
The bar below shows net dividends by holding over the trailing twelve months. UBL does the heavy lifting through its high quarterly payout, which fits the thesis: UBL is held partly for income.

## What is coming
FFC and UBL have already announced their next payouts, so those are confirmed receivables. OGDC, MEBL and LUCK are model estimates based on payout history and expected earnings, so treat them as a range rather than a promise.

## What to watch
- **UBL**: whether the payout stays covered by earnings as rates fall.
- **FFC**: gas pricing, urea price caps and the payout ratio.
- **HUBC**: do not count it as income until the dividend actually resumes.`,
      cards: [
        {
          kind: "bar-chart",
          title: "Net dividends received (trailing 12 months)",
          xKey: "ticker",
          yUnit: "PKR",
          bars: [{ key: "net", label: "Net received", color: "#059669" }],
          data: [
            { ticker: "UBL", net: divNet.UBL },
            { ticker: "OGDC", net: divNet.OGDC },
            { ticker: "FFC", net: divNet.FFC },
            { ticker: "MEBL", net: divNet.MEBL },
            { ticker: "ENGROH", net: divNet.ENGROH },
            { ticker: "LUCK", net: divNet.LUCK },
          ],
        },
        {
          kind: "table",
          title: "Dividend ledger and estimate",
          description: "Received income plus confirmed and estimated receivables.",
          columns: [
            { key: "ticker", label: "Holding" },
            { key: "status", label: "Status" },
            { key: "dps", label: "Per share" },
            { key: "net", label: "Net", align: "right", format: "currency" },
          ],
          rows: [
            { ticker: "UBL", status: "Received x4", dps: "11.00 x4", net: divNet.UBL },
            { ticker: "OGDC", status: "Received x2", dps: "13.00 + 14.00", net: divNet.OGDC },
            { ticker: "FFC", status: "Received x2", dps: "22.00 + 23.00", net: divNet.FFC },
            { ticker: "FFC", status: "Announced", dps: "22.00", net: Math.round(22 * H("FFC").quantity * 0.85) },
            { ticker: "UBL", status: "Announced", dps: "11.00", net: Math.round(11 * H("UBL").quantity * 0.85) },
            { ticker: "OGDC", status: "Estimated", dps: "13.00 to 15.00", net: Math.round(14 * H("OGDC").quantity * 0.85) },
            { ticker: "MEBL", status: "Estimated", dps: "13.00 to 15.00", net: Math.round(14 * H("MEBL").quantity * 0.85) },
          ],
        },
        {
          kind: "timeline",
          title: "Dividend calendar",
          events: [
            { date: isoDate(45), label: "OGDC dividend received", type: "dividend", value: `PKR ${(Math.round(14 * H("OGDC").quantity * 0.85) / 1000).toFixed(1)}k net` },
            { date: isoDate(-10), label: "FFC interim ex-date", type: "dividend", detail: "Announced. Confirmed receivable." },
            { date: isoDate(-16), label: "UBL quarterly ex-date", type: "dividend", detail: "Announced. Confirmed receivable." },
            { date: isoDate(-40), label: "OGDC next payout (estimate)", type: "dividend", detail: "Model estimate from payout history." },
            { date: isoDate(-55), label: "MEBL final (estimate)", type: "dividend", detail: "Model estimate from expected earnings." },
          ],
        },
      ],
    },
    {
      title: "Sector allocation vs target",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} where the book is over- and under-weight`,
      user: "How is my capital spread across sectors, and where am I off my targets?",
      assistant: `## Short answer
The book is genuinely diversified across seven sectors, with no single sector dominating. The one thing to watch is **banks**, where MEBL and UBL together are the largest sleeve at about ${banksWt.toFixed(0)}%, a little above the 30% target. Everything else sits close to its intended weight.

## Read
Banking is the biggest exposure and it is intentional, since both names are working and pay you to hold them. The risk is that they share the same driver: when policy rates move, both move together. So treat the banking weight as one position-sizing decision, not two.

Cement and technology are your growth-cyclical exposures. Power, through HUBC, is one of the smaller and weaker sleeves, which is appropriate given the weakening thesis.

## What I would do
Nothing urgent. If the banking sleeve drifts further above target on price appreciation, that is the first place to trim. Do not add to HUBC to "rebalance" a weak thesis into a bigger position.`,
      cards: [
        {
          kind: "bar-chart",
          title: "Sector weight: current vs target",
          xKey: "sector",
          yUnit: "%",
          bars: [
            { key: "current", label: "Current", color: "#2563eb" },
            { key: "target", label: "Target", color: "#94a3b8" },
          ],
          data: [
            { sector: "Banks", current: Number(banksWt.toFixed(1)), target: 30 },
            { sector: "Oil & Gas", current: Number(wt("OGDC").toFixed(1)), target: 13 },
            { sector: "Tech", current: Number(wt("SYS").toFixed(1)), target: 14 },
            { sector: "Fertilizer", current: Number(wt("FFC").toFixed(1)), target: 12 },
            { sector: "Conglomerate", current: Number(wt("ENGROH").toFixed(1)), target: 9 },
            { sector: "Cement", current: Number(wt("LUCK").toFixed(1)), target: 10 },
            { sector: "Power", current: Number(wt("HUBC").toFixed(1)), target: 8 },
          ],
        },
        {
          kind: "comparison-table",
          title: "Allocation read",
          columns: [
            { key: "sector", label: "Sector" },
            { key: "state", label: "State" },
            { key: "action", label: "Action" },
          ],
          rows: [
            { sector: "Banks", state: "Largest sleeve, on purpose", action: "Trim first if it drifts higher" },
            { sector: "Cement", state: "Cyclical growth bet", action: "Hold into the rate-cut cycle" },
            { sector: "Power", state: "Small, weakening", action: "Do not add to rebalance" },
            { sector: "Conglomerate", state: "No thesis on ENGROH", action: "Write it down or trim" },
          ],
        },
      ],
    },
    {
      title: "SYS export thesis",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} IT exporter growth, FX hedge and what to watch`,
      user: "Is the SYS thesis still intact? Walk me through the growth and the risks.",
      assistant: `## Provisional view
**Intact, and the highest-conviction position in the book.** SYS is a dollar-revenue business in a rupee-cost country, so it works as both a growth holding and a currency hedge. The latest guidance for export revenue growth above 20% is exactly what the thesis is built on.

## Why it works
Revenue is earned largely in US dollars while a big share of the cost base is in rupees. When the rupee weakens, reported earnings get a tailwind. When it is stable, growth carries the result. That asymmetry is rare on the PSX.

## The risks, honestly
- **Client concentration** in the Middle East. A slowdown there hits harder than a broad market dip.
- **Wage inflation** in a tight engineering labour market can compress the margin even as revenue grows.
- **Global IT spending**. A worldwide pullback in tech budgets would slow new-logo growth.

## What to watch
Track whether growth is coming from new clients or just more work from existing ones, and watch the wage bill against revenue. The sell condition stays the same: export growth below 10% for a full year, or sustained margin erosion.`,
      cards: [
        {
          kind: "price-chart",
          title: "SYS price vs your cost basis",
          ticker: "SYS",
          period: "1Y",
          overlay: ["cost-basis"],
          description: "Live PSX price history with your average cost overlaid.",
        },
        {
          kind: "bar-chart",
          title: "Illustrative export revenue growth",
          description: "Year-on-year growth, illustrative for the demo.",
          xKey: "year",
          yUnit: "%",
          bars: [{ key: "growth", label: "YoY growth", color: "#7c3aed" }],
          data: [
            { year: "FY23", growth: 31 },
            { year: "FY24", growth: 28 },
            { year: "FY25", growth: 22 },
            { year: "FY26", growth: 24 },
          ],
        },
        {
          kind: "metric-strip",
          title: "Your SYS position",
          metrics: [
            { label: "Shares", value: `${H("SYS").quantity.toLocaleString("en-PK")}` },
            { label: "Avg cost", value: `PKR ${H("SYS").avg_cost.toFixed(2)}` },
            { label: "Last price", value: `PKR ${H("SYS").price.toFixed(2)}` },
            { label: "Unrealized", value: `+PKR ${(pl(H("SYS")) / 1000).toFixed(1)}k`, delta: `+${retPct(H("SYS")).toFixed(1)}%`, tone: "positive" },
          ],
        },
      ],
    },
    {
      title: "HUBC: is the thesis still valid?",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} weakening power position, the renegotiation risk and a decision`,
      user: "My HUBC thesis is marked weakening. Walk me through whether to hold or cut.",
      assistant: `## Short answer
This is the one position where the original reason to own it is genuinely in question. The thesis rested on cheap, contracted cash flows and an eventual dividend resumption. The dividend is still paused and IPP renegotiation talks, the exact risk you wrote down, are back in the news. That does not automatically mean sell, but it does mean the burden of proof has flipped.

## The timeline
The events below are why the thesis moved to weakening. Each one chips at the contracted-cash-flow assumption.

## How I would frame the decision
- **The bull case** needs one concrete thing: a confirmed dividend resumption at something close to the historical payout. Until that happens, you are holding on hope.
- **The bear case** is that another PPA renegotiation permanently lowers contracted returns, in which case the cheap-cash-flow story is just cheap for a reason.
- **The opportunity cost** matters. OGDC offers a similar "discounted, paid to wait" profile with a thesis that is currently intact.

## Suggested next step
Set a hard review trigger on the next results or any formal PPA announcement. If there is no credible path to dividend resumption by then, this capital has a better home.`,
      cards: [
        {
          kind: "timeline",
          title: "Why the HUBC thesis weakened",
          events: [
            { date: isoDate(1), label: "New round of IPP renegotiation talks", type: "corporate", detail: "Touches contracted returns, the named thesis risk." },
            { date: isoDate(18), label: "Thesis downgraded to Weakening", type: "news", detail: "Logged in the journal." },
            { date: isoDate(90), label: "Dividend remains paused", type: "dividend", detail: "No resumption signal yet." },
            { date: isoDate(160), label: "Original purchase", type: "transaction", detail: "Bought on the contracted-cash-flow case." },
          ],
        },
        {
          kind: "comparison-table",
          title: "Hold versus reallocate",
          columns: [
            { key: "factor", label: "Factor" },
            { key: "hubc", label: "HUBC (hold)" },
            { key: "ogdc", label: "OGDC (reallocate)" },
          ],
          rows: [
            { factor: "Thesis status", hubc: "Weakening", ogdc: "Active" },
            { factor: "Income now", hubc: "Dividend paused", ogdc: "Paying a dividend" },
            { factor: "Main risk", hubc: "PPA renegotiation", ogdc: "Circular debt" },
            { factor: "Upside trigger", hubc: "Dividend resumption", ogdc: "Receivable settlement" },
          ],
        },
        {
          kind: "metric-strip",
          title: "Your HUBC position",
          metrics: [
            { label: "Shares", value: `${H("HUBC").quantity}` },
            { label: "Avg cost", value: `PKR ${H("HUBC").avg_cost.toFixed(2)}` },
            { label: "Last price", value: `PKR ${H("HUBC").price.toFixed(2)}` },
            { label: "Unrealized", value: `PKR ${(pl(H("HUBC")) / 1000).toFixed(1)}k`, delta: `${retPct(H("HUBC")).toFixed(1)}%`, tone: "negative" },
          ],
        },
      ],
    },
    {
      title: "Cement cycle: LUCK",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} the rate-cut cyclical bet and the peer set`,
      user: "Why do I own LUCK and how does it sit against the other cement names?",
      assistant: `## Short answer
LUCK is a deliberate cyclical bet on falling interest rates and a domestic construction recovery, held through the lowest-cost producer with the cleanest balance sheet. It is not an income holding, it is a growth-cyclical one, and it is sized to stay under the cement sector cap.

## The case
Cement is geared to two things: the cost of capital and construction activity. As rates fall, both demand and the discount on future earnings improve. LUCK adds a second layer through its holding structure across autos, chemicals and power, so you are not betting on cement alone.

## Against the peers
LUCK trades at a premium to DGKC and MLCF, and that premium is earned: lower cost per tonne, a stronger balance sheet and the diversified holdings. The chart shows the price against your cost. The comparison table is why I am comfortable paying up rather than reaching for the cheaper, more leveraged names.

## What to watch
Domestic dispatch volumes and coal costs. The thesis breaks if a fresh wave of industry capacity crushes pricing for more than a year, which is the recorded sell condition.`,
      cards: [
        {
          kind: "price-chart",
          title: "LUCK price vs your cost basis",
          ticker: "LUCK",
          period: "1Y",
          overlay: ["cost-basis"],
          description: "Live PSX price history with your average cost overlaid.",
        },
        {
          kind: "comparison-table",
          title: "Cement peers",
          description: "Illustrative figures for context, not live quotes.",
          columns: [
            { key: "name", label: "Producer" },
            { key: "cost", label: "Cost position" },
            { key: "balance", label: "Balance sheet" },
            { key: "note", label: "Note" },
          ],
          rows: [
            { name: "LUCK", cost: "Lowest", balance: "Net cash, diversified", note: "Held. Premium is earned" },
            { name: "DGKC", cost: "Mid", balance: "Leveraged", note: "Cheaper, more cyclical risk" },
            { name: "MLCF", cost: "Mid", balance: "Improving", note: "Smaller, less diversified" },
          ],
        },
        {
          kind: "bar-chart",
          title: "Illustrative domestic dispatch trend",
          description: "Index of domestic volumes, illustrative for the demo.",
          xKey: "period",
          yUnit: "",
          bars: [{ key: "dispatch", label: "Dispatch index", color: "#ea580c" }],
          data: [
            { period: "Q1", dispatch: 96 },
            { period: "Q2", dispatch: 99 },
            { period: "Q3", dispatch: 104 },
            { period: "Q4", dispatch: 111 },
          ],
        },
      ],
    },
  ];

  for (let index = 0; index < threads.length; index += 1) {
    const item = threads[index];
    const threadTime = iso(600 - index * 70);
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
        created_at: iso(599 - index * 70),
      },
      {
        user_id: userId,
        thread_id: thread.id,
        role: "assistant",
        content: item.assistant,
        cards: item.cards.map((spec) => ({ kind: "artifact", data: spec })),
        created_at: iso(598 - index * 70),
      },
    ]);
  }
}

/** YYYY-MM-DD offset from today. Positive = past, negative = future. */
function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}
