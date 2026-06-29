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

const DEMO_CHAT_SUMMARY_PREFIX = "Demo library:";

export async function loadDemoData(supabase: SupabaseClient, userId: string) {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await clearDemoRows(supabase, userId);

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

  await seedDemoChatThreads(supabase, userId);
  await supabase.from("profiles").update({ demo_mode: true }).eq("id", userId);
  await takeSnapshot(supabase, userId);
  await refreshAlerts(supabase, userId);
}

async function clearDemoRows(supabase: SupabaseClient, userId: string) {
  const demoTickers = DEMO_HOLDINGS.map((h) => h.ticker);
  await supabase.from("holdings").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("prices").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("dividends").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("journal_entries").delete().eq("user_id", userId).eq("source", "demo");
  await supabase.from("news_articles").delete().eq("user_id", userId).eq("source", "Demo Data");
  await supabase.from("ai_briefings").delete().eq("user_id", userId).eq("model", "demo");
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

async function seedDemoChatThreads(supabase: SupabaseClient, userId: string) {
  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const threads = [
    {
      title: "Portfolio health check",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} concentration, laggards and next review priorities`,
      user: "Give me a portfolio health check and show what needs attention.",
      assistant: `## Short answer
The demo portfolio is healthy enough to review, but it is not "set and forget." The main watch item is **HUBC**, where the thesis is already marked weakening and the review date has passed. The second issue is process quality: **ENGRO has no written thesis**, so the position needs a documented reason to keep holding.

## What I would review first
- **HUBC**: unrealized loss plus IPP renegotiation risk means the original cash-flow case needs confirmation.
- **ENGRO**: no thesis on file. Decide whether this is a deliberate conglomerate exposure or just legacy portfolio drift.
- **MEBL and SYS**: both are working positions. The question is sizing discipline, not urgency.

## Portfolio read
This is a concentrated five-stock PSX portfolio with exposure across banks, fertilizer, power, technology and conglomerates. That is a useful demo shape: it shows gains, losses, dividends, thesis tracking and market relevance without needing imported statements.

## Next actions I would take
1. Read HUBC's latest official filings and dividend posture before adding any money.
2. Write a one-paragraph thesis for ENGRO or remove it from the "conviction" bucket.
3. Keep MEBL and FFC on normal review cadence unless position weight drifts materially above target.`,
      cards: [
        {
          kind: "metric-strip",
          title: "Demo portfolio snapshot",
          metrics: [
            { label: "Holdings", value: "5" },
            { label: "Largest position", value: "SYS", detail: "Technology exporter" },
            { label: "Needs review", value: "2", tone: "negative", detail: "HUBC and ENGRO" },
            { label: "Dividend names", value: "2", detail: "FFC, MEBL" },
          ],
        },
        {
          kind: "portfolio-attribution",
          title: "What is driving demo portfolio P/L",
          description: "Illustrative unrealized contribution by holding",
          items: [
            { label: "SYS", value: 17190, percent: 45, tone: "positive" },
            { label: "MEBL", value: 16250, percent: 35, tone: "positive" },
            { label: "FFC", value: 12920, percent: 27, tone: "positive" },
            { label: "ENGRO", value: -5720, percent: -12, tone: "negative" },
            { label: "HUBC", value: -9150, percent: -19, tone: "negative" },
          ],
        },
      ],
    },
    {
      title: "MEBL position review",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} bank thesis, price action and portfolio fit`,
      user: "Review MEBL for a long-term investor. Should I add, hold, or wait?",
      assistant: `## Provisional view
For this demo portfolio, **MEBL is a hold / selective add-on-weakness candidate**, not an urgent buy. The thesis quality is strong: Islamic banking leadership, deposit growth and high ROE. The portfolio question is whether adding would over-concentrate the financials sleeve.

## Company case
MEBL is the cleanest thesis in the demo data. The recorded thesis says the bank has structurally stronger Islamic deposit growth and best-in-class profitability. The demo news also supports the thesis with record quarterly profit driven by deposits and stable spreads.

## Portfolio case
You already own 500 shares at an average cost of PKR 215.50. The latest demo price is around PKR 248, so the position is profitable. Adding here would average up, which can be fine, but only if the bank's ROE and deposit growth remain intact through a rate-cut cycle.

## Decision conditions
- Add only if deposit growth remains above sector average and valuation does not price in perfection.
- Hold if spreads begin normalizing but asset quality stays strong.
- Revisit the thesis if ROE falls below the recorded sell-condition threshold for two consecutive years.`,
      cards: [
        {
          kind: "price-chart",
          title: "MEBL demo price vs cost basis",
          ticker: "MEBL",
          period: "3M",
          overlay: ["cost-basis", "transactions"],
          description: "Uses the seeded demo price history and holding cost.",
        },
        {
          kind: "table",
          title: "MEBL decision checklist",
          columns: [
            { key: "item", label: "Check" },
            { key: "status", label: "Status" },
            { key: "read", label: "Read" },
          ],
          rows: [
            { item: "Thesis written", status: "Yes", read: "Largest Islamic bank, deposit-led growth" },
            { item: "Position P/L", status: "Positive", read: "Demo price above average cost" },
            { item: "Main risk", status: "Rate cuts", read: "Margin compression can reduce earnings momentum" },
            { item: "Action", status: "Hold", read: "Add only if valuation and deposit growth still support it" },
          ],
        },
      ],
    },
    {
      title: "Dividend income review",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} received income, yield quality and next checks`,
      user: "Summarise dividend income and what I should watch next.",
      assistant: `## Short answer
The demo income stream is concentrated in **FFC and MEBL**. That is acceptable for a starter PSX portfolio, but it means the income case depends heavily on fertilizer payout stability and bank profitability.

## What was received
The seeded demo records show received dividends from FFC and MEBL. FFC is the clearer income holding because the thesis explicitly depends on reliable payout. MEBL contributes income, but its primary case is quality growth rather than yield.

## What to watch
- **FFC**: gas pricing, urea price controls and payout ratio.
- **MEBL**: whether profitability remains high enough to support both growth and dividends.
- **HUBC**: do not count it as an income holding until dividend resumption is clear.

## Portfolio implication
Dividend income is useful here, but not broad enough to treat the full portfolio as an income portfolio. It is still a balanced growth/income demo portfolio.`,
      cards: [
        {
          kind: "bar-chart",
          title: "Received demo dividends",
          xKey: "ticker",
          yUnit: "PKR",
          bars: [{ key: "net", label: "Net received", color: "#059669" }],
          data: [
            { ticker: "FFC", net: 3740 },
            { ticker: "MEBL", net: 2975 },
          ],
        },
        {
          kind: "timeline",
          title: "Dividend timeline",
          events: [
            { date: "40 days ago", label: "FFC dividend received", type: "dividend", value: "PKR 3,740 net" },
            { date: "25 days ago", label: "MEBL dividend received", type: "dividend", value: "PKR 2,975 net" },
            { date: "Next review", label: "Check payout consistency", type: "other", detail: "Confirm whether payout matches the written thesis." },
          ],
        },
      ],
    },
    {
      title: "Market pulse impact",
      summary: `${DEMO_CHAT_SUMMARY_PREFIX} how market moves affect the demo portfolio`,
      user: "Explain today's market pulse through the lens of my holdings.",
      assistant: `## Read of the market
The right demo workflow is not "what moved the index?" but "which market moves matter to my holdings?" In this portfolio, banks, fertilizer, power and technology each respond to different drivers, so one index move is not enough.

## Holding sensitivity
- **MEBL** responds most to rates, deposit growth, asset quality and banking-sector sentiment.
- **FFC** responds to gas pricing, fertilizer demand, urea policy and dividend expectations.
- **HUBC** responds to circular debt, PPA renegotiation and dividend visibility.
- **SYS** responds to IT exports, PKR movement and global tech spending.

## Practical use
Use Market Pulse to separate broad market noise from holding-specific signal. A weak index day is less important than a filing or policy item that directly touches one of your recorded theses.`,
      cards: [
        {
          kind: "comparison-table",
          title: "Market driver map",
          columns: [
            { key: "holding", label: "Holding" },
            { key: "driver", label: "Primary driver" },
            { key: "watch", label: "What to watch" },
          ],
          rows: [
            { holding: "MEBL", driver: "Rates and deposits", watch: "Deposit growth vs sector" },
            { holding: "FFC", driver: "Fertilizer policy", watch: "Gas pricing and payout ratio" },
            { holding: "HUBC", driver: "Power policy", watch: "PPA/circular debt updates" },
            { holding: "SYS", driver: "IT exports", watch: "Export growth and margins" },
          ],
        },
      ],
    },
  ];

  for (let index = 0; index < threads.length; index += 1) {
    const item = threads[index];
    const threadTime = iso(240 - index * 45);
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
        created_at: iso(239 - index * 45),
      },
      {
        user_id: userId,
        thread_id: thread.id,
        role: "assistant",
        content: item.assistant,
        cards: item.cards.map((spec) => ({ kind: "artifact", data: spec })),
        created_at: iso(238 - index * 45),
      },
    ]);
  }
}
