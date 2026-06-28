import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedMessage } from "@/lib/chat/resolver";
import {
  getQuoteCard, getPositionCard, getRatioCard, getTechnicalCard, getDividendCard,
  getNewsCard, getMarketCard, getHoldingsSummary, getSectorCard,
  type QuoteCard, type PositionCard, type RatioCard, type TechnicalCard, type DividendCard, type NewsCard, type MarketCard, type HoldingsSummary, type SectorCard,
  type PositionHistoryCard,
} from "@/lib/chat/data";
import { getForeignFlowSnapshot, type ForeignFlowSnapshot } from "@/lib/market/foreign-flows";
import { fmtPct, fmtCompact } from "@/lib/market/format";
import type { TechnicalSignals } from "@/lib/market/technicals";

/** A typed card the UI renders directly (free — no LLM drew it). */
export type Card =
  | { kind: "quote"; data: QuoteCard }
  | { kind: "position"; data: PositionCard }
  | { kind: "ratios"; data: RatioCard }
  | { kind: "technical"; data: TechnicalCard }
  | { kind: "dividend"; data: DividendCard }
  | { kind: "news"; data: NewsCard }
  | { kind: "market"; data: MarketCard }
  | { kind: "sector"; data: SectorCard }
  | { kind: "foreign_flow"; data: ForeignFlowSnapshot }
  | { kind: "holdings"; data: HoldingsSummary };

/**
 * Gather the cards relevant to a resolved message — the free layer. Intent
 * decides which getters run so we don't over-fetch, but for a single ticker we
 * lean toward a rich overview since that's what most questions want.
 */
export async function gatherCards(db: SupabaseClient, userId: string, resolved: ResolvedMessage): Promise<Card[]> {
  const cards: Card[] = [];
  const { tickers, intent } = resolved;

  // A named sector ("how did cement do?") — show that sector's card.
  if (resolved.sector) {
    const sc = await getSectorCard(db, resolved.sector);
    if (sc) cards.push({ kind: "sector", data: sc });
  }

  if (!resolved.sector && (intent === "market" || (tickers.length === 0 && intent !== "position"))) {
    const m = await getMarketCard(db);
    if (m) cards.push({ kind: "market", data: m });
    const sectors = await getSectorCard(db, null); // full ranked list
    if (sectors) cards.push({ kind: "sector", data: sectors });
    const flows = await getForeignFlowSnapshot(db);
    if (flows) cards.push({ kind: "foreign_flow", data: flows });
    const news = await getNewsCard(db, userId, null, 6);
    if (news) cards.push({ kind: "news", data: news });
  }

  if (tickers.length === 0 && (intent === "position" || intent === "market")) {
    const h = await getHoldingsSummary(db, userId);
    if (h) cards.push({ kind: "holdings", data: h });
    // For portfolio gap/concentration questions, include the full PSX sector
    // list so the model can compare the user's sector mix against what exists in
    // the market (answering "what am I lacking") instead of guessing.
    if (h && intent === "position" && !resolved.sector && !cards.some((c) => c.kind === "sector")) {
      const sectors = await getSectorCard(db, null);
      if (sectors) cards.push({ kind: "sector", data: sectors });
    }
  }

  for (const ticker of tickers.slice(0, 4)) {
    const [quote, position, ratios, technical, dividend, news] = await Promise.all([
      getQuoteCard(db, ticker),
      getPositionCard(db, userId, ticker),
      intent === "valuation" || intent === "overview" || intent === "compare" || intent === "position" ? getRatioCard(db, ticker) : Promise.resolve(null),
      intent === "technical" || intent === "overview" || intent === "position" ? getTechnicalCard(db, ticker) : Promise.resolve(null),
      intent === "dividend" || intent === "overview" ? getDividendCard(db, ticker) : Promise.resolve(null),
      intent === "news" || intent === "overview" ? getNewsCard(db, userId, ticker, 4) : Promise.resolve(null),
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

/** "2026-06-24" -> "Wed 24 Jun"; passes the raw string through if unparseable. */
function fmtCloseDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const dm = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${wd} ${dm}`;
}

/**
 * Tag a quote's close date with its weekday and, when it lags the latest PSX
 * session, flag that it is not live. Staleness is judged against the actual last
 * session in the data (`latestSession`), not the calendar, so weekends and
 * public holidays (Ashura, Eid, etc.) never count as missed sessions — there is
 * simply no newer session to be behind. This stops the model from confabulating
 * a weekday ("up 2.84% on Friday") or treating a holiday gap as stale data.
 */
function asOfLabel(asOf: string | null, latestSession: string | null): string {
  if (!asOf) return "as of date n/a";
  const label = fmtCloseDate(asOf);
  if (latestSession && asOf < latestSession) {
    return `as of ${label}, last close; not updated to the latest PSX session ${fmtCloseDate(latestSession)}`;
  }
  return `as of ${label}`;
}

/**
 * Render the gathered cards into a compact text brief for Claude — numbers
 * already digested, so the model writes the narrative without re-reading
 * anything. This is the single biggest cost lever. `latestSession` is the most
 * recent PSX session date on record, used to flag genuinely stale quotes.
 */
export function briefFromCards(cards: Card[], latestSession: string | null = null): string {
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
        const valueBit =
          h.totalValue != null
            ? ` Total value ${fmtCompact(h.totalValue)} PKR, cost ${fmtCompact(h.totalCost)}${h.unrealizedPL != null ? `, unrealized ${fmtCompact(h.unrealizedPL)}` : ""} (${h.pricedCount}/${h.count} priced).`
            : " (no live prices — value/weights unavailable).";
        lines.push(`YOUR HOLDINGS: ${h.count} positions, ${up} up today.${valueBit}`);
        if (h.sectors.length) {
          lines.push(
            `SECTOR CONCENTRATION (by value): ${h.sectors
              .map((s) => `${s.sector} ${s.weightPct.toFixed(0)}% (${s.count} stock${s.count === 1 ? "" : "s"})`)
              .join(", ")}.`
          );
        }
        const byWeight = [...h.holdings].sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));
        lines.push(
          `POSITIONS (by weight): ${byWeight
            .map((x) => `${x.ticker} [${x.sector ?? "Unclassified"}] ${x.weightPct != null ? `${x.weightPct.toFixed(0)}%` : "unpriced"} ${fmtPct(x.changePct)}`)
            .join(", ")}.`
        );
        break;
      }
      case "sector": {
        const sc = c.data;
        const rows = sc.sectors.slice(0, sc.filter ? sc.sectors.length : 12);
        const body = rows
          .map((s) => `${s.sector} ${fmtPct(s.avgReturn)} (${s.advancers}↑/${s.decliners}↓, ${s.stockCount} stocks${s.topGainer ? `, top ${s.topGainer} ${fmtPct(s.topGainerPct)}` : ""})`)
          .join("; ");
        lines.push(`SECTORS ${sc.date}${sc.filter ? ` [${sc.filter}]` : " (avg return)"}: ${body}.`);
        break;
      }
      case "foreign_flow": {
        const f = c.data;
        const unit = `${f.day.currency} mn`;
        const buckets = f.buckets.map((b) => `${b.label} ${b.net >= 0 ? "+" : ""}${b.net.toFixed(2)}`).join(", ") || "no sector buckets";
        const sectors = f.sectors.slice(0, 6).map((s) => `${s.sector} ${s.net != null && s.net >= 0 ? "+" : ""}${s.net?.toFixed(2) ?? "n/a"}`).join(", ");
        const locals = f.participants.slice(0, 5).map((p) => `${p.label} ${p.net != null && p.net >= 0 ? "+" : ""}${p.net?.toFixed(2) ?? "n/a"}`).join(", ");
        lines.push(`FOREIGN FLOWS latest available ${f.day.date}: FIPI ${f.day.fipiNet != null && f.day.fipiNet >= 0 ? "+" : ""}${f.day.fipiNet?.toFixed(2) ?? "n/a"} ${unit}; ${f.stanceLabel}; ${f.series.length}-day cumulative ${f.cumulativeNet != null && f.cumulativeNet >= 0 ? "+" : ""}${f.cumulativeNet?.toFixed(2) ?? "n/a"} ${unit}. By bucket: ${buckets}. Top sectors: ${sectors || "n/a"}. Local participants: ${locals || "n/a"}. Source ${f.day.sourceProvider}${f.day.sourceUrl ? ` (${f.day.sourceUrl})` : ""}.`);
        break;
      }
      case "quote": {
        const q = c.data;
        lines.push(`${q.ticker} (${q.companyName ?? ""}${q.sector ? `, ${q.sector}` : ""}): ${q.price ?? "n/a"} PKR, ${fmtPct(q.changePct)} on the day, vol ${fmtCompact(q.volume)}${q.marketCap ? `, mkt cap ${fmtCompact(q.marketCap)}` : ""} (${asOfLabel(q.asOf, latestSession)}).`);
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
        const sigLine = technicalSignalsLine(t.ticker, t.signals);
        if (sigLine) lines.push(sigLine);
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

export function briefFromPositionHistory(h: PositionHistoryCard): string {
  const lines: string[] = [];
  const priceBit = h.quote.price != null
    ? `${h.quote.price.toFixed(2)} PKR${h.quote.asOf ? ` as of ${h.quote.asOf}` : ""}`
    : "price unavailable";
  lines.push(
    `${h.ticker} DECISION EVIDENCE: current ${priceBit}; sector ${h.quote.sector ?? "n/a"}; cash ${fmtCompact(h.portfolio.cashBalance)} PKR; portfolio net worth ${fmtCompact(h.portfolio.netWorth)} PKR. Current weight: ${fmtPct(h.portfolio.currentNetWorthWeightPct, false)} of net worth (${fmtPct(h.portfolio.currentEquityWeightPct, false)} of equities). Sector weight: ${fmtPct(h.portfolio.sectorNetWorthWeightPct, false)} of net worth (${fmtPct(h.portfolio.sectorEquityWeightPct, false)} of equities).`
  );
  if (h.holding) {
    lines.push(
      `${h.ticker} HOLDINGS ROW: ${h.holding.quantity} sh @ avg ${h.holding.avgCost.toFixed(2)}; cost ${fmtCompact(h.holding.totalCost)}; source ${h.holding.source ?? "n/a"}; updated ${h.holding.lastUpdated ?? "n/a"}.`
    );
  } else {
    lines.push(`${h.ticker} HOLDINGS ROW: no open holding row found.`);
  }
  const q = h.quantityReconciliation;
  lines.push(
    `${h.ticker} QUANTITY RECONCILIATION: holdings ${q.holdingsQuantity ?? "n/a"}; transaction-ledger ${q.transactionLedgerQuantity ?? "n/a"}; broker inventory ${q.brokerInventoryQuantity ?? "n/a"}${q.brokerAsOf ? ` as of ${q.brokerAsOf}` : ""}; post-checkpoint transaction delta ${q.postCheckpointTransactionDelta ?? "n/a"}; manual purchases after broker snapshot ${q.manualPurchaseQuantity}; expected ${q.expectedQuantity ?? "n/a"}; holding-ledger diff ${q.holdingVsLedgerDifference ?? "n/a"}; holding-broker diff ${q.holdingVsBrokerExpectedDifference ?? "n/a"}; status ${q.status}.`
  );
  lines.push(
    `${h.ticker} LEDGER SUMMARY: ${h.ledger.transactionCount} rows; buys ${h.ledger.buyCount}, sells ${h.ledger.sellCount}; first buy ${h.ledger.firstBuyDate ?? "n/a"}, latest buy ${h.ledger.latestBuyDate ?? "n/a"}; bought ${h.ledger.totalBoughtQuantity} sh for ${fmtCompact(h.ledger.totalBuyCost)} PKR (weighted avg ${h.ledger.weightedAverageBuyCost?.toFixed(2) ?? "n/a"}); sold ${h.ledger.totalSoldQuantity} sh; current ledger avg ${h.ledger.avgCost?.toFixed(2) ?? "n/a"}; sources ${Object.entries(h.ledger.sourceBreakdown).map(([k, v]) => `${k}:${v}`).join(", ") || "n/a"}.`
  );
  if (h.ledger.rows.length) {
    lines.push(
      `${h.ticker} VERIFIED TRANSACTION ROWS: ${h.ledger.rows
        .map((r) =>
          `${r.date ?? "n/a"} ${r.type} qty ${r.quantity ?? "n/a"} @ ${r.price ?? "n/a"} net ${r.netAmount ?? "n/a"} fees ${r.fees} -> qty ${r.quantityAfter}, avg ${r.avgCostAfter} (${r.source ?? "n/a"})`
        )
        .join(" | ")}.`
    );
  }
  if (h.additionScenarios.length) {
    lines.push(
      `${h.ticker} ADDITION SCENARIOS: ${h.additionScenarios
        .map((s) =>
          `${s.label}: amount ${fmtCompact(s.amount)} PKR, est shares ${s.estimatedShares ?? "n/a"}, new avg ${s.newAvgCost?.toFixed(2) ?? "n/a"}, weight ${fmtPct(s.currentWeightPct, false)} -> ${fmtPct(s.newWeightPct, false)}, sector weight after ${fmtPct(s.newSectorWeightPct, false)}, cash after ${s.cashAfter != null ? `${fmtCompact(s.cashAfter)} PKR` : "n/a"}, external capital ${s.externalCapitalRequired != null ? `${fmtCompact(s.externalCapitalRequired)} PKR` : "n/a"}`
        )
        .join(" | ")}.`
    );
  }
  for (const note of h.notes) lines.push(`${h.ticker} DATA NOTE: ${note}`);
  return lines.join("\n");
}

/**
 * One dense line of the LONG-TERM structure read for the LLM: multi-year trend
 * (weekly EMA21/55), momentum-divergence trend warnings, the healthy
 * accumulation/pullback band (no stop-loss, no targets — this is for investors,
 * not traders), and multi-year seasonality for timing gradual deployment.
 */
function technicalSignalsLine(ticker: string, s: TechnicalSignals | null): string | null {
  if (!s) return null;
  const parts: string[] = [];
  parts.push(`long-term trend ${s.longTermTrend}`);
  if (s.emaWeekly?.fast != null && s.emaWeekly.slow != null) {
    parts.push(`wEMA21/55 ${s.emaWeekly.fast.toFixed(1)}/${s.emaWeekly.slow.toFixed(1)} (${s.emaWeekly.fastAboveSlow ? "fast>slow" : "fast<slow"})`);
  }
  for (const d of s.divergences) parts.push(`${d.kind} momentum divergence`);
  const acc = s.accumulation;
  if (acc) {
    if (acc.zoneLow != null && acc.zoneHigh != null) parts.push(`accumulation range ${acc.zoneLow} to ${acc.zoneHigh} (status: ${acc.status})`);
    if (acc.distanceFromHighPct != null) parts.push(`${acc.distanceFromHighPct >= 0 ? "+" : ""}${acc.distanceFromHighPct}% vs 52w high`);
  }
  for (const w of s.seasonality) parts.push(`${w.label} ${w.winRatePct.toFixed(0)}% positive over ${w.years}y, avg ${w.avgReturnPct >= 0 ? "+" : ""}${w.avgReturnPct.toFixed(1)}%`);
  const accNote = acc?.note ? ` ${acc.note}` : "";
  return `${ticker} LONG-TERM STRUCTURE: ${parts.join("; ")}.${accNote} (This is context for accumulation timing only. Fundamentals drive the decision. This is not a trade signal.)`;
}
