import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAlerts } from "@/lib/alerts";
import { takeSnapshot } from "@/lib/portfolio";

/**
 * Demo dataset: 5 PSX blue-chips with plausible (illustrative, NOT live)
 * prices, targets, theses, journal entries, news and a briefing — enough to
 * exercise every screen before importing real statements.
 */
const DEMO_HOLDINGS = [
  { ticker: "MEBL", company_name: "Meezan Bank Limited", sector: "Commercial Banks", quantity: 500, avg_cost: 215.5, price: 248.0 },
  { ticker: "FFC", company_name: "Fauji Fertilizer Company Limited", sector: "Fertilizer", quantity: 800, avg_cost: 142.25, price: 158.4 },
  { ticker: "HUBC", company_name: "The Hub Power Company Limited", sector: "Power Generation & Distribution", quantity: 1000, avg_cost: 128.75, price: 119.6 },
  { ticker: "SYS", company_name: "Systems Limited", sector: "Technology & Communication", quantity: 300, avg_cost: 455.0, price: 512.3 },
  { ticker: "ENGRO", company_name: "Engro Holdings Limited", sector: "Conglomerate", quantity: 400, avg_cost: 312.8, price: 298.5 },
];

export async function loadDemoData(supabase: SupabaseClient, userId: string) {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

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
    // a small price history so the value-over-time chart has data
    for (const [offset, drift] of [
      [14, 0.96],
      [7, 0.98],
      [0, 1.0],
    ] as const) {
      await supabase.from("prices").upsert(
        {
          user_id: userId,
          ticker: h.ticker,
          price: Math.round(h.price * drift * 100) / 100,
          price_date: daysAgo(offset),
          source: "demo",
        },
        { onConflict: "user_id,ticker,price_date" }
      );
    }
  }

  const targets = [
    { ticker: "MEBL", target_price: 275, target_allocation: 25, review_level: 200 },
    { ticker: "FFC", target_price: 175, target_allocation: 20, review_level: 130 },
    { ticker: "HUBC", target_price: 150, target_allocation: 15, review_level: 115 },
    { ticker: "SYS", target_price: 600, target_allocation: 25, review_level: 420 },
    { ticker: "ENGRO", target_price: 360, target_allocation: 15, review_level: 280 },
  ];
  for (const t of targets) {
    await supabase.from("targets").upsert({ user_id: userId, ...t }, { onConflict: "user_id,ticker" });
  }

  const theses = [
    {
      ticker: "MEBL",
      why_bought: "Largest Islamic bank in Pakistan with structurally higher deposit growth, strong CASA ratio and best-in-class ROE among PSX banks.",
      expectation: "Continued deposit growth and stable spreads support double-digit earnings growth over the holding period.",
      time_horizon: "3-5 years",
      key_risks: "Rapid policy-rate cuts compressing margins; regulatory changes to Islamic banking framework.",
      sell_conditions: "ROE falls below 20% for two consecutive years, or deposit growth stalls below sector average.",
      add_conditions: "Price weakness on macro fears while deposit growth and asset quality stay intact.",
      confidence: 4,
      status: "Active",
      review_date: daysAgo(-30),
    },
    {
      ticker: "FFC",
      why_bought: "Dominant urea producer with pricing power, reliable dividend stream and improved balance sheet after the FFBL consolidation.",
      expectation: "Stable urea offtake and dividends; payout supports total return even in flat markets.",
      time_horizon: "2-4 years",
      key_risks: "Gas supply pricing (GIDC-type interventions), urea price caps, weather-driven demand swings.",
      sell_conditions: "Dividend payout materially cut, or sustained gas curtailment.",
      add_conditions: "Yield above 9% with payout intact.",
      confidence: 4,
      status: "Active",
      review_date: daysAgo(-60),
    },
    {
      ticker: "HUBC",
      why_bought: "Cheap cash flows from power purchase agreements plus optionality on Thar coal and EV ventures.",
      expectation: "Dividend resumption and re-rating as circular-debt flows improve.",
      time_horizon: "2-3 years",
      key_risks: "Circular debt delaying payments; PPA renegotiations reducing returns; capex into new ventures diluting cash returns.",
      sell_conditions: "Another broad PPA renegotiation that cuts contracted returns.",
      add_conditions: "Confirmed dividend resumption at historical payout levels.",
      confidence: 2,
      status: "Weakening",
      review_date: daysAgo(2), // intentionally due -> generates a review alert
    },
    {
      ticker: "SYS",
      why_bought: "Pakistan's largest IT exporter; dollar-revenue hedge against PKR depreciation with a long runway in export markets.",
      expectation: "Export revenue growth above 20% annually; margin recovery as utilization improves.",
      time_horizon: "5+ years",
      key_risks: "Wage inflation, client concentration in the Middle East, global IT spending slowdown.",
      sell_conditions: "Export growth below 10% for a full year, or sustained margin erosion.",
      add_conditions: "Broad market sell-off pushing valuation below 15x earnings while growth holds.",
      confidence: 5,
      status: "Active",
      review_date: daysAgo(-90),
    },
    // ENGRO intentionally has NO thesis -> generates a missing-thesis alert
  ];
  for (const t of theses) {
    await supabase.from("theses").upsert({ user_id: userId, ...t }, { onConflict: "user_id,ticker" });
  }

  const journal = [
    {
      ticker: "MEBL",
      entry_date: daysAgo(45),
      entry_type: "buy_decision",
      title: "Started MEBL position after results",
      body: "Bought 500 shares after strong quarterly results. Deposit growth 18% YoY, ROE above 25%. Valuation still reasonable relative to growth.",
      expected_outcome: "Re-rating toward higher book multiples within 18 months.",
      risk: "Rate-cut cycle compressing spreads faster than deposit growth offsets.",
      confidence: 4,
      source: "demo",
    },
    {
      ticker: "HUBC",
      entry_date: daysAgo(20),
      entry_type: "hold_review",
      title: "HUBC thesis weakening — flagged for review",
      body: "Dividend still paused and PPA renegotiation chatter continues. Thesis status moved to Weakening. Will decide at the next review date whether the original cash-flow case still stands.",
      expected_outcome: "Clarity on dividend policy by next quarter.",
      risk: "Capital stuck in a position whose original thesis no longer holds.",
      confidence: 2,
      follow_up_date: daysAgo(-10),
      source: "demo",
    },
    {
      ticker: "SYS",
      entry_date: daysAgo(10),
      entry_type: "news_reaction",
      title: "Export numbers better than expected",
      body: "IT export remittances grew strongly this quarter. Supports the dollar-revenue thesis. No action needed; staying the course.",
      confidence: 5,
      source: "demo",
    },
  ];
  for (const j of journal) {
    await supabase.from("journal_entries").insert({ user_id: userId, ...j });
  }

  const news = [
    {
      ticker: "MEBL",
      company_name: "Meezan Bank Limited",
      sector: "Commercial Banks",
      title: "Demo: Meezan Bank posts record quarterly profit on deposit growth",
      url: "https://example.com/demo/mebl-results",
      source: "Demo Data",
      published_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      snippet: "Meezan Bank reported record quarterly profit driven by strong deposit growth and stable spreads. (Demo article for testing.)",
      ai_summary: "Demo article: record quarterly profit on deposit growth and stable margins; board also reviewed payout policy.",
      sentiment: "positive",
      relevance_score: 9,
      why_it_matters: "Directly confirms the earnings-growth leg of your MEBL thesis.",
      thesis_impact: "Supports the thesis; no change needed.",
      review_question: "Is deposit growth still above the sector average?",
      category: "result",
    },
    {
      ticker: "HUBC",
      company_name: "The Hub Power Company Limited",
      sector: "Power Generation & Distribution",
      title: "Demo: Government revisits IPP agreements in new round of talks",
      url: "https://example.com/demo/hubc-ipp-talks",
      source: "Demo Data",
      published_at: new Date(Date.now() - 1 * 86400000).toISOString(),
      snippet: "A new round of discussions with independent power producers could revisit contracted returns. (Demo article for testing.)",
      ai_summary: "Demo article: renewed IPP renegotiation talks may touch contracted returns for legacy power producers.",
      sentiment: "negative",
      relevance_score: 8,
      why_it_matters: "PPA renegotiation is the exact risk named in your HUBC thesis.",
      thesis_impact: "May affect your thesis — the cash-flow assumption depends on contracted returns.",
      review_question: "Does the original cash-flow case survive another round of PPA cuts?",
      category: "general",
    },
    {
      ticker: "FFC",
      company_name: "Fauji Fertilizer Company Limited",
      sector: "Fertilizer",
      title: "Demo: Fauji Fertilizer announces interim cash dividend",
      url: "https://example.com/demo/ffc-dividend",
      source: "Demo Data",
      published_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      snippet: "FFC board announced an interim cash dividend alongside quarterly results. (Demo article for testing.)",
      ai_summary: "Demo article: interim cash dividend declared, consistent with historical payout pattern.",
      sentiment: "positive",
      relevance_score: 8,
      why_it_matters: "The dividend stream is the core of your FFC position.",
      thesis_impact: "Supports the income leg of the thesis.",
      review_question: "Is the payout ratio holding at historical levels?",
      category: "dividend",
    },
  ];
  for (const n of news) {
    await supabase
      .from("news_articles")
      .upsert({ user_id: userId, ...n }, { onConflict: "user_id,url", ignoreDuplicates: true });
  }

  await supabase.from("dividends").insert([
    { user_id: userId, ticker: "FFC", pay_date: daysAgo(40), amount: 4400, tax: 660, net_amount: 3740, source: "demo", notes: "Demo dividend", row_hash: `demo-ffc-${userId}` },
    { user_id: userId, ticker: "MEBL", pay_date: daysAgo(25), amount: 3500, tax: 525, net_amount: 2975, source: "demo", notes: "Demo dividend", row_hash: `demo-mebl-${userId}` },
  ]);

  await supabase.from("ai_briefings").insert({
    user_id: userId,
    briefing_type: "daily",
    title: "Demo Daily Briefing",
    content: `## Portfolio overview\nThis is a **demo briefing** so you can see the format before connecting your own data. Your demo portfolio holds 5 PSX positions worth roughly PKR 6.9M at illustrative prices.\n\n## Important news\n- **HUBC**: renewed IPP renegotiation talks (demo article) — this touches the exact risk named in your thesis. [Source](https://example.com/demo/hubc-ipp-talks)\n- **FFC**: interim dividend declared (demo article). [Source](https://example.com/demo/ffc-dividend)\n\n## Holdings requiring review\n- **ENGRO** has no recorded thesis.\n- **HUBC** review date has passed and the thesis is marked *Weakening*.\n\n## Questions to consider\n1. What would confirm or refute the HUBC cash-flow case this quarter?\n2. Why do you hold ENGRO — can you write it down in one paragraph?\n\n_This is portfolio research support, not financial advice._`,
    model: "demo",
  });

  await supabase.from("profiles").update({ demo_mode: true }).eq("id", userId);
  await takeSnapshot(supabase, userId);
  await refreshAlerts(supabase, userId);
}

/** Removes everything tagged as demo data. Real (imported/manual) data is untouched. */
export async function clearDemoData(supabase: SupabaseClient, userId: string) {
  const demoTickers = DEMO_HOLDINGS.map((h) => h.ticker);
  await supabase.from("holdings").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("prices").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("dividends").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("journal_entries").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("news_articles").delete().eq("user_id", userId).eq("source", "Demo Data");
  await supabase.from("ai_briefings").delete().eq("user_id", userId).eq("model", "demo");
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
  await supabase.from("profiles").update({ demo_mode: false }).eq("id", userId);
  await refreshAlerts(supabase, userId);
}
