import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfigured, chatMarkdown } from "@/lib/ai/openai";

/**
 * AI daily market brief. ONE LLM call per snapshot, cached in market_ai_briefs
 * by date so the page never pays for generation on load. The prompt is built
 * entirely from the already-computed snapshot aggregates (breadth, sectors,
 * movers, events) — a compact summary, not raw tickers — so it stays cheap and
 * grounded. Strictly descriptive: no buy/sell/hold, and it states data gaps
 * (e.g. missing index) explicitly.
 */

const BRIEF_SYSTEM = `You write a concise daily market brief for PortfolioOS PK, a private PSX research tool.

Rules:
- Purely descriptive market commentary. NEVER recommend buying, selling, or holding; never use those words as advice.
- Ground every claim in the numbers provided. Do not invent tickers, sectors, or figures.
- If index-level data is marked unavailable, say the overview is based on stock-level breadth instead.
- 120-180 words, 2-3 short paragraphs. Plain, confident, useful. No headings, no bullet lists, no disclaimers footer.`;

interface SnapshotForBrief {
  snapshot_date: string;
  index_name: string | null;
  index_value: number | null;
  index_change_percent: number | null;
  total_advancers: number;
  total_decliners: number;
  total_unchanged: number;
  total_volume: number;
  top_sector: string | null;
  bottom_sector: string | null;
  most_active_ticker: string | null;
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export interface BriefResult {
  generated: boolean;
  date: string;
  content?: string;
  error?: string;
}

/**
 * Generate (or reuse) the brief for a snapshot date. Pass force=true to
 * regenerate. Reads the snapshot, top sectors, top movers and event counts,
 * then asks the model for a short narrative.
 */
export async function generateMarketBrief(snapshotDate: string, opts: { force?: boolean; client?: SupabaseClient } = {}): Promise<BriefResult> {
  const db = opts.client ?? createAdminClient();

  if (!opts.force) {
    const { data: existing } = await db.from("market_ai_briefs").select("content").eq("snapshot_date", snapshotDate).maybeSingle();
    if (existing?.content) return { generated: false, date: snapshotDate, content: existing.content };
  }

  if (!aiConfigured()) return { generated: false, date: snapshotDate, error: "GEMINI_API_KEY is not configured." };

  const { data: snap } = await db
    .from("market_snapshots")
    .select("id, snapshot_date, index_name, index_value, index_change_percent, total_advancers, total_decliners, total_unchanged, total_volume, top_sector, bottom_sector, most_active_ticker")
    .eq("snapshot_date", snapshotDate)
    .maybeSingle();
  if (!snap) return { generated: false, date: snapshotDate, error: "No snapshot for that date." };

  const s = snap as SnapshotForBrief & { id: string };

  const [{ data: sectors }, { data: gainers }, { data: losers }, { data: events }] = await Promise.all([
    db.from("sector_snapshots").select("sector, average_return, advancers, decliners, stock_count").eq("snapshot_id", s.id).order("average_return", { ascending: false }),
    db.from("market_movers").select("ticker, change_percent").eq("snapshot_id", s.id).eq("category", "gainers").order("rank").limit(5),
    db.from("market_movers").select("ticker, change_percent").eq("snapshot_id", s.id).eq("category", "losers").order("rank").limit(5),
    db.from("market_events").select("ticker, event_type").eq("event_date", snapshotDate),
  ]);

  const topSectors = (sectors ?? []).slice(0, 3).map((x) => `${x.sector} ${fmtPct(x.average_return)}`).join(", ");
  const lagSectors = (sectors ?? []).slice(-3).reverse().map((x) => `${x.sector} ${fmtPct(x.average_return)}`).join(", ");
  const gainersTxt = (gainers ?? []).map((g) => `${g.ticker} ${fmtPct(g.change_percent)}`).join(", ") || "none";
  const losersTxt = (losers ?? []).map((g) => `${g.ticker} ${fmtPct(g.change_percent)}`).join(", ") || "none";
  const resultCount = (events ?? []).filter((e) => e.event_type === "result").length;
  const divCount = (events ?? []).filter((e) => e.event_type === "dividend").length;

  const facts = [
    `Date: ${snapshotDate}`,
    s.index_name ? `Index ${s.index_name}: ${s.index_value?.toLocaleString() ?? "n/a"} (${fmtPct(s.index_change_percent)})` : "Index level: UNAVAILABLE from providers",
    `Breadth: ${s.total_advancers} advancing, ${s.total_decliners} declining, ${s.total_unchanged} unchanged`,
    `Total volume: ${Math.round(s.total_volume).toLocaleString()} shares`,
    `Leading sectors (avg return): ${topSectors || "n/a"}`,
    `Lagging sectors: ${lagSectors || "n/a"}`,
    `Top gainers: ${gainersTxt}`,
    `Top losers: ${losersTxt}`,
    `Most active: ${s.most_active_ticker ?? "n/a"}`,
    `Official PSX filings today: ${resultCount} results, ${divCount} dividend-related, ${(events ?? []).length} total`,
  ].join("\n");

  let content: string;
  let model: string;
  try {
    const r = await chatMarkdown(BRIEF_SYSTEM, `Write today's PSX market brief from these facts:\n\n${facts}`, 2_000, { thinkingBudget: 1_024 });
    content = r.content;
    model = r.model;
  } catch (e) {
    return { generated: false, date: snapshotDate, error: e instanceof Error ? e.message : String(e) };
  }

  await db.from("market_ai_briefs").upsert(
    {
      snapshot_id: s.id,
      snapshot_date: snapshotDate,
      title: `PSX Market Brief — ${snapshotDate}`,
      content,
      structured_output: { index: s.index_name, breadth: { adv: s.total_advancers, dec: s.total_decliners }, topSectors, lagSectors },
      model,
    },
    { onConflict: "snapshot_date" }
  );

  return { generated: true, date: snapshotDate, content };
}
