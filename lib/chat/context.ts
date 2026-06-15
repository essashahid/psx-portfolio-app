import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedMessage } from "@/lib/chat/resolver";
import {
  getQuoteCard, getPositionCard, getRatioCard, getTechnicalCard, getDividendCard,
  getNewsCard, getMarketCard, getHoldingsSummary,
  type QuoteCard, type PositionCard, type RatioCard, type TechnicalCard, type DividendCard, type NewsCard, type MarketCard, type HoldingsSummary,
} from "@/lib/chat/data";
import { fmtPct, fmtCompact } from "@/lib/market/format";

/** A typed card the UI renders directly (free — no LLM drew it). */
export type Card =
  | { kind: "quote"; data: QuoteCard }
  | { kind: "position"; data: PositionCard }
  | { kind: "ratios"; data: RatioCard }
  | { kind: "technical"; data: TechnicalCard }
  | { kind: "dividend"; data: DividendCard }
  | { kind: "news"; data: NewsCard }
  | { kind: "market"; data: MarketCard }
  | { kind: "holdings"; data: HoldingsSummary };

/**
 * Gather the cards relevant to a resolved message — the free layer. Intent
 * decides which getters run so we don't over-fetch, but for a single ticker we
 * lean toward a rich overview since that's what most questions want.
 */
export async function gatherCards(db: SupabaseClient, userId: string, resolved: ResolvedMessage): Promise<Card[]> {
  const cards: Card[] = [];
  const { tickers, intent } = resolved;

  if (intent === "market" || (tickers.length === 0 && intent !== "position")) {
    const m = await getMarketCard(db);
    if (m) cards.push({ kind: "market", data: m });
    const news = await getNewsCard(db, null, 6);
    if (news) cards.push({ kind: "news", data: news });
  }

  if (tickers.length === 0 && (intent === "position" || intent === "market")) {
    const h = await getHoldingsSummary(db, userId);
    if (h) cards.push({ kind: "holdings", data: h });
  }

  for (const ticker of tickers.slice(0, 4)) {
    const [quote, position, ratios, technical, dividend, news] = await Promise.all([
      getQuoteCard(db, ticker),
      getPositionCard(db, userId, ticker),
      intent === "valuation" || intent === "overview" || intent === "compare" || intent === "position" ? getRatioCard(db, ticker) : Promise.resolve(null),
      intent === "technical" || intent === "overview" || intent === "position" ? getTechnicalCard(db, ticker) : Promise.resolve(null),
      intent === "dividend" || intent === "overview" ? getDividendCard(db, ticker) : Promise.resolve(null),
      intent === "news" || intent === "overview" ? getNewsCard(db, ticker, 4) : Promise.resolve(null),
    ]);
    if (quote) cards.push({ kind: "quote", data: quote });
    if (position) cards.push({ kind: "position", data: position });
    if (ratios) cards.push({ kind: "ratios", data: ratios });
    if (technical) cards.push({ kind: "technical", data: technical });
    if (dividend) cards.push({ kind: "dividend", data: dividend });
    if (news) cards.push({ kind: "news", data: news });
  }

  return cards;
}

/**
 * Render the gathered cards into a compact text brief for Claude — numbers
 * already digested, so the model writes the narrative without re-reading
 * anything. This is the single biggest cost lever.
 */
export function briefFromCards(cards: Card[]): string {
  const lines: string[] = [];
  for (const c of cards) {
    switch (c.kind) {
      case "market": {
        const m = c.data;
        lines.push(`MARKET ${m.date}: ${m.indexName ?? "index"} ${m.indexValue?.toLocaleString() ?? "n/a"} (${fmtPct(m.indexChangePct)}), ${m.advancers} up / ${m.decliners} down. Leading: ${m.topSector ?? "n/a"}; lagging: ${m.bottomSector ?? "n/a"}.`);
        break;
      }
      case "holdings": {
        const h = c.data;
        const up = h.holdings.filter((x) => (x.changePct ?? 0) > 0).length;
        lines.push(`YOUR HOLDINGS: ${h.count} positions, ${up} up today. Tickers: ${h.holdings.map((x) => `${x.ticker} ${fmtPct(x.changePct)}`).join(", ")}.`);
        break;
      }
      case "quote": {
        const q = c.data;
        lines.push(`${q.ticker} (${q.companyName ?? ""}${q.sector ? `, ${q.sector}` : ""}): ${q.price ?? "n/a"} PKR, ${fmtPct(q.changePct)} today, vol ${fmtCompact(q.volume)}${q.marketCap ? `, mkt cap ${fmtCompact(q.marketCap)}` : ""} (as of ${q.asOf ?? "n/a"}).`);
        break;
      }
      case "position": {
        const p = c.data;
        lines.push(`${p.ticker} YOUR POSITION: ${p.quantity} sh @ avg ${p.avgCost.toFixed(2)}; cost ${fmtCompact(p.totalCost)}, value ${fmtCompact(p.marketValue)}, unrealized ${p.unrealizedPL != null ? fmtCompact(p.unrealizedPL) : "n/a"} (${fmtPct(p.unrealizedPLPct)}).`);
        break;
      }
      case "ratios": {
        const r = c.data;
        const parts = r.rows.filter((x) => x.value != null).map((x) => `${x.name} ${x.value!.toFixed(2)}`);
        if (parts.length) lines.push(`${r.ticker} RATIOS (${r.sourcePeriod ?? "latest"}): ${parts.join(", ")}.`);
        break;
      }
      case "technical": {
        const t = c.data;
        lines.push(`${t.ticker} TECHNICALS: 52w ${t.fiftyTwoWeekLow ?? "?"}-${t.fiftyTwoWeekHigh ?? "?"}${t.rsi != null ? `, RSI ${t.rsi.toFixed(0)}` : ""}${t.ma50 != null && t.price != null ? `, vs MA50 ${fmtPct(((t.price - t.ma50) / t.ma50) * 100)}` : ""}${t.ma200 != null && t.price != null ? `, vs MA200 ${fmtPct(((t.price - t.ma200) / t.ma200) * 100)}` : ""}.`);
        break;
      }
      case "dividend": {
        const d = c.data;
        lines.push(`${d.ticker} DIVIDENDS: TTM cash DPS ${d.ttmDps?.toFixed(2) ?? "n/a"}; recent ${d.recent.map((x) => x.raw).filter(Boolean).join(", ") || "none"}.`);
        break;
      }
      case "news": {
        const n = c.data;
        lines.push(`${n.ticker ?? "MARKET"} FILINGS: ${n.items.map((i) => `${i.title} (${i.type}, ${i.date})`).slice(0, 4).join("; ")}.`);
        break;
      }
    }
  }
  return lines.join("\n");
}
