import type { SupabaseClient } from "@supabase/supabase-js";
import { getPortfolio } from "@/lib/portfolio";
import { chatMarkdown } from "@/lib/ai/openai";
import { getDividends, summarizeDividends } from "@/lib/dividends";
import { getTaxSettings } from "@/lib/dividends/tax";
import { normalizeEvent } from "@/lib/dividends/engine";
import type { BriefingType } from "@/lib/types";

/** Assembles a factual, compact context block the model can rely on. */
export async function buildPortfolioContext(
  supabase: SupabaseClient,
  userId: string,
  opts: { newsDays?: number } = {}
): Promise<string> {
  const summary = await getPortfolio(supabase, userId);
  const dividends = await getDividends(supabase, userId);
  const dividendSummary = summarizeDividends(dividends);
  const since = new Date(Date.now() - (opts.newsDays ?? 7) * 86400000).toISOString();

  const [newsRes, alertsRes, journalRes, snapshotsRes] = await Promise.all([
    supabase
      .from("news_articles")
      .select("ticker, title, url, source, published_at, ai_summary, sentiment, relevance_score, category, saved, source_quality, link_reason, low_confidence")
      .eq("user_id", userId)
      .eq("ignored", false)
      .or("low_confidence.eq.false,saved.eq.true")
      .gte("created_at", since)
      .order("relevance_score", { ascending: false })
      .limit(25),
    supabase
      .from("alerts")
      .select("ticker, alert_type, severity, title, message")
      .eq("user_id", userId)
      .eq("status", "open")
      .limit(30),
    supabase
      .from("journal_entries")
      .select("ticker, entry_date, entry_type, title, confidence")
      .eq("user_id", userId)
      .order("entry_date", { ascending: false })
      .limit(15),
    supabase
      .from("portfolio_snapshots")
      .select("snapshot_date, total_value, unrealized_pl")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false })
      .limit(8),
  ]);

  const { data: theses } = await supabase
    .from("theses")
    .select("ticker, status, confidence, review_date, key_risks, why_bought")
    .eq("user_id", userId);

  const lines: string[] = [];
  lines.push(`# Portfolio (PKR)`);
  lines.push(
    `Total value: ${summary.totalValue.toFixed(0)} | Total cost: ${summary.totalCost.toFixed(0)} | Unrealized P/L: ${summary.unrealizedPl.toFixed(0)} (${summary.unrealizedPlPct?.toFixed(1) ?? "n/a"}%) | Realized P/L: ${summary.realizedPl.toFixed(0)} | Dividend received: ${summary.dividendIncome.toFixed(0)} | Expected dividends: ${summary.expectedDividendIncome.toFixed(0)} | Pending dividends: ${summary.pendingDividends} | Holdings: ${summary.holdingsCount} | Priced holdings: ${summary.pricedHoldings}/${summary.holdingsCount}`
  );
  if (summary.pricedHoldings < summary.holdingsCount) {
    lines.push(
      `NOTE: ${summary.holdingsCount - summary.pricedHoldings} holding(s) have no latest price — their market value falls back to cost.`
    );
  }
  lines.push(`\n## Holdings`);
  for (const h of summary.holdings) {
    lines.push(
      `- ${h.ticker} (${h.company_name ?? "?"}, ${h.sector ?? "?"}): qty ${h.quantity}, avg cost ${h.avg_cost.toFixed(2)}, latest price ${h.latest_price?.toFixed(2) ?? "MISSING"}, weight ${h.weight?.toFixed(1) ?? "?"}%, target alloc ${h.target_allocation ?? "none"}%, target price ${h.target_price ?? "none"}, review level ${h.review_level ?? "none"}, unrealized P/L ${h.unrealized_pl?.toFixed(0) ?? "n/a"} (${h.unrealized_pl_pct?.toFixed(1) ?? "n/a"}%), thesis: ${h.has_thesis ? `${h.thesis_status} (confidence ${h.thesis_confidence ?? "?"}/5)` : "MISSING"}, review date: ${h.review_date ?? "none"}`
    );
  }
  lines.push(`\n## Sector weights`);
  for (const s of summary.sectorWeights) lines.push(`- ${s.sector}: ${s.weight.toFixed(1)}%`);

  lines.push(`\n## Dividend summary`);
  lines.push(
    `Received net: ${dividendSummary.netReceived.toFixed(0)} | Gross total: ${dividendSummary.totalGross.toFixed(0)} | Tax deducted: ${dividendSummary.totalTax.toFixed(0)} | Expected net: ${dividendSummary.expectedNet.toFixed(0)} | Pending count: ${dividendSummary.pendingCount}`
  );
  if (dividendSummary.topPayers.length) {
    lines.push(`Top dividend payers: ${dividendSummary.topPayers.map((p) => `${p.ticker} ${p.net.toFixed(0)}`).join(", ")}`);
  }
  const pendingDividends = dividends.filter((d) => d.status !== "received").slice(0, 10);
  if (pendingDividends.length) {
    for (const d of pendingDividends) {
      lines.push(
        `- Pending ${d.ticker}: status ${d.status}, gross ${d.amount.toFixed(0)}, net ${(d.net_amount ?? d.amount).toFixed(0)}, payment ${d.payment_date ?? d.pay_date ?? "unknown"}`
      );
    }
  }

  // Dividend receivables engine (confirmed announcements, forecasts, overdue)
  const { data: eventRows } = await supabase
    .from("dividend_events")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["announced", "expected", "overdue", "needs_review", "forecasted"])
    .order("created_at", { ascending: false })
    .limit(40);
  const taxSettings = await getTaxSettings(supabase, userId);
  const events = (eventRows ?? []).map((r) => normalizeEvent(r as Record<string, unknown>));
  if (events.length > 0 || taxSettings.configured) {
    lines.push(`\n## Dividend receivables`);
    lines.push(
      `Tax assumption: ${taxSettings.taxpayer_status === "filer" ? "Pakistan filer / ATL" : taxSettings.taxpayer_status}, dividend WHT rate ${taxSettings.dividend_tax_rate !== null ? `${(taxSettings.dividend_tax_rate * 100).toFixed(1)}%` : "NOT CONFIGURED — net amounts are rough"}, tax year ${taxSettings.tax_year}${taxSettings.configured ? "" : " (defaults — user has not confirmed the tax profile)"}.`
    );
    lines.push(
      `RULES FOR YOU: Never state a dividend will definitely be received. Confirmed items are announced but eligibility/receipt may be unconfirmed — use wording like "estimated net receivable based on your current holding and configured filer tax rate". Items marked forecast are NOT announced; always label them "forecast only". Mention eligibility uncertainty and missing data explicitly.`
    );
    const confirmed = events.filter(
      (e) =>
        !e.is_forecast &&
        !e.is_possible_duplicate &&
        e.event_type !== "credit" &&
        (e.status === "announced" || e.status === "expected")
    );
    for (const e of confirmed) {
      lines.push(
        `- CONFIRMED ${e.ticker}: ${e.dividend_type} dividend${e.dividend_per_share !== null ? ` Rs ${e.dividend_per_share}/share` : ""}, announced ${e.announcement_date ?? "?"}, qty ${e.eligible_quantity ?? "?"}, gross ~${e.gross_expected?.toFixed(0) ?? "?"}, est. tax ${e.estimated_tax?.toFixed(0) ?? "?"}, est. net ~${e.net_expected?.toFixed(0) ?? "?"}, payment ${e.payment_date ?? `est. ${e.estimated_payment_start ?? "?"} to ${e.estimated_payment_end ?? "?"}`}, eligibility ${e.eligibility_status}${e.face_value_assumed ? ", face value assumed (needs review)" : ""}`
      );
    }
    const overdueEvents = events.filter((e) => e.status === "overdue");
    for (const e of overdueEvents) {
      lines.push(
        `- OVERDUE ${e.ticker}: expected net ~${e.net_expected?.toFixed(0) ?? "?"} — payment window (${e.estimated_payment_start ?? "?"} to ${e.estimated_payment_end ?? "?"}) has passed without being marked received. Needs follow-up.`
      );
    }
    const forecasts = events.filter((e) => e.is_forecast && e.status === "forecasted");
    for (const e of forecasts) {
      lines.push(
        `- FORECAST ONLY (not announced) ${e.ticker}: possible payout window ${e.estimated_payment_start ?? "?"} to ${e.estimated_payment_end ?? "?"}, est. net range ${e.net_low?.toFixed(0) ?? "?"}–${e.net_high?.toFixed(0) ?? "?"} (basis: ${e.forecast_basis ?? "history"}, confidence ${e.confidence_level})`
      );
    }
    const staged = events.filter((e) => e.status === "needs_review").length;
    if (staged > 0) lines.push(`- ${staged} detected announcement(s) are staged and need user review (value could not be fully parsed).`);
    const eligibilityUnknown = confirmed.filter((e) => e.eligibility_status !== "eligible").length;
    if (eligibilityUnknown > 0) {
      lines.push(`- Missing data: ${eligibilityUnknown} confirmed event(s) have unconfirmed eligibility (transaction history incomplete — user should confirm holdings before ex-date/book closure).`);
    }
  }

  if ((theses ?? []).length) {
    lines.push(`\n## Theses`);
    for (const t of theses ?? []) {
      lines.push(
        `- ${t.ticker} [${t.status}, confidence ${t.confidence ?? "?"}/5, review ${t.review_date ?? "none"}]: ${(t.why_bought ?? "").slice(0, 200)} | Risks: ${(t.key_risks ?? "none stated").slice(0, 150)}`
      );
    }
  }
  if ((newsRes.data ?? []).length) {
    lines.push(`\n## Recent news (last ${opts.newsDays ?? 7} days)`);
    for (const n of newsRes.data ?? []) {
      lines.push(
        `- [${n.ticker ?? "general"}] ${n.title} (${n.sentiment ?? "?"}, relevance ${n.relevance_score ?? "?"}/10, ${n.category ?? "general"}, source ${n.source_quality ?? "unknown"}${n.saved ? ", saved" : ""}) ${n.url} :: linked because ${(n.link_reason ?? "not stated").slice(0, 120)} :: ${(n.ai_summary ?? "").slice(0, 200)}`
      );
    }
  } else {
    lines.push(`\n## Recent news\nNo stored news. Suggest the user refresh news from the News Center.`);
  }
  if ((alertsRes.data ?? []).length) {
    lines.push(`\n## Open alerts`);
    for (const a of alertsRes.data ?? []) {
      lines.push(`- [${a.severity}] ${a.ticker ?? "portfolio"} ${a.alert_type}: ${a.title}`);
    }
  }
  if ((journalRes.data ?? []).length) {
    lines.push(`\n## Recent journal entries`);
    for (const j of journalRes.data ?? []) {
      lines.push(`- ${j.entry_date} [${j.entry_type}] ${j.ticker ?? ""} ${j.title}`);
    }
  }
  if ((snapshotsRes.data ?? []).length > 1) {
    lines.push(`\n## Recent portfolio snapshots`);
    for (const s of snapshotsRes.data ?? []) {
      lines.push(`- ${s.snapshot_date}: value ${Number(s.total_value).toFixed(0)}, unrealized P/L ${Number(s.unrealized_pl).toFixed(0)}`);
    }
  }
  lines.push(`\nToday's date: ${new Date().toISOString().slice(0, 10)}`);
  return lines.join("\n");
}

const BRIEFING_INSTRUCTIONS: Record<string, { title: string; prompt: string }> = {
  daily: {
    title: "Daily Briefing",
    prompt: `Write a concise daily portfolio brief for a serious PSX investor. This is not a blog post.

Format rules:
- Use markdown only.
- Start with a one-sentence **Bottom line**.
- Use H2 headings only. Do not use H1, H3, H4, numbered headings, or "Here is...".
- Keep it under 450 words.
- Prefer short bullets over paragraphs.
- Do not repeat every holding; mention only items that require attention.
- If prices are missing, say exactly what is missing and how that limits the analysis. Do not say P/L "cannot be calculated" if the context provides cost-based fallback values.

Use exactly these sections:
## Bottom line
## Portfolio state
## Review queue
## Dividends
## News and filings
## Data quality
## Review questions

The "Review queue" must list the 3-6 most important actions or checks, ordered by urgency.
The "Dividends" section must summarize received income, expected income, pending dividends, and missing dividend setup when applicable.`,
  },
  weekly: {
    title: "Weekly Briefing",
    prompt: `Write a weekly portfolio review in markdown: performance summary (note missing data plainly), allocation drift vs targets, the week's relevant news with source URLs, thesis changes or theses needing re-confirmation, key risks, dividends recorded, a concrete review list for next week, and a short journal summary if entries exist.`,
  },
  risk_review: {
    title: "Portfolio Risk Review",
    prompt: `Write a portfolio risk review in markdown: concentration (single stock and sector), missing-thesis exposure, theses with low confidence or Weakening/Broken status, negative-news exposure, holdings without price data, and 3-5 specific review questions. Do not invent risks not supported by the data.`,
  },
  news_only: {
    title: "News Briefing",
    prompt: `Write a news-only briefing in markdown. Group stored news by holding, summarize each item with its source URL, flag anything that may affect a stated thesis, and list which holdings had no news coverage.`,
  },
  dividend_review: {
    title: "Dividend Review",
    prompt: `Write a dividend review in markdown: dividend income recorded so far (by ticker if linkable), any dividend-related news with source URLs, and what dividend data is missing or worth confirming.`,
  },
  thesis_review: {
    title: "Thesis Review",
    prompt: `Review every holding's thesis in markdown. For each holding: thesis status and confidence, whether recent news supports or challenges it, and what would need to change for the status to move. Explicitly list holdings with no thesis — that is the biggest gap.`,
  },
};

export async function generateBriefing(
  supabase: SupabaseClient,
  userId: string,
  type: BriefingType
): Promise<{ title: string; content: string; model: string }> {
  const instructions = BRIEFING_INSTRUCTIONS[type] ?? BRIEFING_INSTRUCTIONS.daily;
  const context = await buildPortfolioContext(supabase, userId, {
    newsDays: type === "weekly" ? 7 : type === "daily" ? 2 : 14,
  });
  const { content, model } = await chatMarkdown(
    `You write portfolio briefings from the provided context only. Never fabricate prices, news, or events not in the context.`,
    `${instructions.prompt}\n\n--- CONTEXT ---\n${context}`,
    2200
  );
  return { title: instructions.title, content, model };
}
