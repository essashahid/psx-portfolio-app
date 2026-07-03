import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedMessage } from "@/lib/chat/resolver";
import {
  getQuoteCard, getPositionCard, getRatioCard, getTechnicalCard, getDividendCard,
  getNewsCard, getMarketCard, getHoldingsSummary, getSectorCard,
  type QuoteCard, type PositionCard, type RatioCard, type TechnicalCard, type DividendCard, type NewsCard, type MarketCard, type HoldingsSummary, type SectorCard,
  type PositionHistoryCard, type DecisionNotes,
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

  // A move-explanation question about a named ticker ("why did PTC rise
  // today?") needs the same-session market backdrop to attribute the move:
  // index direction and breadth, the full sector ranking, and foreign flows.
  // Without these the model only sees the stock's own quote and falls back to
  // stale web snippets or invented mechanisms.
  if (resolved.movement && !cards.some((c) => c.kind === "market")) {
    const [m, sectors, flows] = await Promise.all([
      getMarketCard(db),
      cards.some((c) => c.kind === "sector") ? Promise.resolve(null) : getSectorCard(db, null),
      getForeignFlowSnapshot(db),
    ]);
    if (m) cards.push({ kind: "market", data: m });
    if (sectors) cards.push({ kind: "sector", data: sectors });
    if (flows) cards.push({ kind: "foreign_flow", data: flows });
  }

  // A no-ticker dividend, valuation, or compare question ("which of my holdings
  // carry my income", "which look cheapest", "plot yield versus P/E for every
  // holding I have") is inherently about the user's book, so load holdings for
  // those too. Without this, a no-ticker "compare"/"versus" question (no named
  // tickers to compare) got zero holdings data and the model would fabricate a
  // full ratio table into a chart rather than say the data was not loaded. This
  // is what lets dividend income, cross-holding patterns, benchmark returns and
  // the macro overlay all flow into the brief for whole-portfolio questions, not
  // just "position" ones.
  if (
    tickers.length === 0 &&
    (intent === "position" || intent === "market" || intent === "dividend" || intent === "valuation" || intent === "compare")
  ) {
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
      intent === "dividend" || intent === "overview" || intent === "position" ? getDividendCard(db, ticker) : Promise.resolve(null),
      intent === "news" || intent === "overview" || intent === "position" ? getNewsCard(db, userId, ticker, 4) : Promise.resolve(null),
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
        lines.push(briefFromHoldingsSummary(c.data));
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

/**
 * Decision evidence for an add/trim/hold question, formatted as labeled sections
 * and Markdown tables. Everything is PRE-COMPUTED here: weights, allocation
 * impact, blended-cost evolution, tranche margins. The model reads these numbers
 * and narrates; it must never recompute them. Clear structure (headings + small
 * tables) is deliberate — weaker models skim dense run-on lines but reliably read
 * tables, and this is the most decision-relevant block in the whole context.
 */
export function briefFromPositionHistory(h: PositionHistoryCard): string {
  const p = h.portfolio;
  const out: string[] = [];
  const priceBit = h.quote.price != null
    ? `${h.quote.price.toFixed(2)} PKR${h.quote.asOf ? ` (as of ${h.quote.asOf})` : ""}`
    : "unavailable";

  out.push(`## ${h.ticker} — decision evidence (all figures pre-computed; do not recalculate)`);
  out.push(
    [
      `- Current price: ${priceBit}`,
      `- Sector: ${h.quote.sector ?? "n/a"}`,
      `- Cash available: ${fmtCompact(p.cashBalance)} PKR`,
      `- Portfolio net worth: ${fmtCompact(p.netWorth)} PKR`,
      `- ${h.ticker} weight: ${fmtPct(p.currentNetWorthWeightPct, false)} of net worth (${fmtPct(p.currentEquityWeightPct, false)} of equities)`,
      `- ${h.quote.sector ?? "Sector"} weight: ${fmtPct(p.sectorNetWorthWeightPct, false)} of net worth (${fmtPct(p.sectorEquityWeightPct, false)} of equities)`,
    ].join("\n")
  );

  if (h.holding) {
    out.push(
      `### Current holding\n${h.holding.quantity} sh @ avg ${h.holding.avgCost.toFixed(2)}; cost ${fmtCompact(h.holding.totalCost)} PKR; source ${h.holding.source ?? "n/a"}; updated ${h.holding.lastUpdated ?? "n/a"}.`
    );
  } else {
    out.push(`### Current holding\nNo open holding row found.`);
  }

  out.push(
    `### Ledger summary\n${h.ledger.transactionCount} rows (${h.ledger.buyCount} buys, ${h.ledger.sellCount} sells); first buy ${h.ledger.firstBuyDate ?? "n/a"}, latest buy ${h.ledger.latestBuyDate ?? "n/a"}; bought ${h.ledger.totalBoughtQuantity} sh for ${fmtCompact(h.ledger.totalBuyCost)} PKR (weighted avg ${h.ledger.weightedAverageBuyCost?.toFixed(2) ?? "n/a"}); sold ${h.ledger.totalSoldQuantity} sh; current ledger avg ${h.ledger.avgCost?.toFixed(2) ?? "n/a"}.`
  );

  if (h.ledger.rows.length) {
    const rows = h.ledger.rows
      .map((r) => `| ${r.date ?? "n/a"} | ${r.type} | ${r.quantity ?? "n/a"} | ${r.price ?? "n/a"} | ${r.quantityAfter} | ${r.avgCostAfter} | ${r.source ?? "n/a"} |`)
      .join("\n");
    out.push(
      `### Verified transaction tranches\n| Date | Type | Qty | Price | Qty after | Avg cost after | Source |\n|---|---|---|---|---|---|---|\n${rows}\nUse these rows to judge tranche margins directly. The current price is ${h.quote.price?.toFixed(2) ?? "n/a"}; compare each tranche price to it.`
    );
  }

  if (h.additionScenarios.length) {
    const rows = h.additionScenarios
      .map((s) =>
        `| ${s.label} | ${fmtCompact(s.amount)} | ${s.estimatedShares ?? "n/a"} | ${s.newAvgCost?.toFixed(2) ?? "n/a"} | ${fmtPct(s.currentWeightPct, false)} → ${fmtPct(s.newWeightPct, false)} | ${fmtPct(s.newSectorWeightPct, false)} | ${s.cashAfter != null ? fmtCompact(s.cashAfter) : "n/a"} | ${s.externalCapitalRequired != null ? fmtCompact(s.externalCapitalRequired) : "n/a"} |`
      )
      .join("\n");
    out.push(
      `### Addition scenarios (pre-computed)\n| Scenario | Amount PKR | Est shares | New avg cost | Weight → | Sector wt after | Cash after | External capital |\n|---|---|---|---|---|---|---|---|\n${rows}`
    );
  }

  const q = h.quantityReconciliation;
  if (q.status !== "reconciled" || q.holdingVsLedgerDifference || q.holdingVsBrokerExpectedDifference) {
    out.push(
      `### Quantity reconciliation\nholdings ${q.holdingsQuantity ?? "n/a"}; ledger ${q.transactionLedgerQuantity ?? "n/a"}; broker ${q.brokerInventoryQuantity ?? "n/a"}${q.brokerAsOf ? ` (as of ${q.brokerAsOf})` : ""}; expected ${q.expectedQuantity ?? "n/a"}; holding-vs-ledger diff ${q.holdingVsLedgerDifference ?? "n/a"}; holding-vs-broker diff ${q.holdingVsBrokerExpectedDifference ?? "n/a"}; status ${q.status}.`
    );
  }

  if (h.notes.length) out.push(`### Data notes\n${h.notes.map((n) => `- ${n}`).join("\n")}`);
  return out.join("\n\n");
}

/**
 * Whole-portfolio overview as labeled text plus a positions table and a sector
 * table. Used both as a rendered card brief and injected into single-ticker
 * decision questions, so the model can assess concentration against the user's
 * actual book instead of guessing. All weights are pre-computed.
 */
export function briefFromHoldingsSummary(h: HoldingsSummary): string {
  const out: string[] = [];
  const up = h.holdings.filter((x) => (x.changePct ?? 0) > 0).length;
  const valueBit =
    h.totalValue != null
      ? `total value ${fmtCompact(h.totalValue)} PKR, cost ${fmtCompact(h.totalCost)}${h.unrealizedPL != null ? `, unrealized ${fmtCompact(h.unrealizedPL)}` : ""} (${h.pricedCount}/${h.count} priced)`
      : "no live prices, so value/weights are unavailable";
  out.push(`## Your portfolio (pre-computed; do not recalculate)\n${h.count} positions, ${up} up today; ${valueBit}.`);

  const byWeight = [...h.holdings].sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));
  const posRows = byWeight
    .map((x) => `| ${x.ticker} | ${x.sector ?? "Unclassified"} | ${x.weightPct != null ? `${x.weightPct.toFixed(1)}%` : "unpriced"} | ${fmtPct(x.changePct)} |`)
    .join("\n");
  out.push(`### Positions by weight\n| Ticker | Sector | Weight | Day |\n|---|---|---|---|\n${posRows}`);

  if (h.sectors.length) {
    const secRows = h.sectors
      .map((s) => `| ${s.sector} | ${s.weightPct.toFixed(1)}% | ${s.count} |`)
      .join("\n");
    out.push(`### Sector concentration\n| Sector | Weight | Stocks |\n|---|---|---|\n${secRows}`);
  }
  return out.join("\n\n");
}

/** Compact brief of the user's own thesis + recent journal for a ticker. */
export function briefFromThesisJournal(notes: DecisionNotes, ticker: string): string {
  const out: string[] = [];
  const t = notes.thesis;
  if (t) {
    const bits = [
      t.why_bought ? `why bought: ${t.why_bought}` : null,
      t.expectation ? `expectation: ${t.expectation}` : null,
      t.time_horizon ? `horizon: ${t.time_horizon}` : null,
      t.key_risks ? `key risks: ${t.key_risks}` : null,
      t.add_conditions ? `add when: ${t.add_conditions}` : null,
      t.sell_conditions ? `sell when: ${t.sell_conditions}` : null,
      t.confidence != null ? `confidence: ${t.confidence}` : null,
      t.status ? `status: ${t.status}` : null,
    ].filter(Boolean);
    if (bits.length) out.push(`### ${ticker} — your thesis\n${bits.map((b) => `- ${b}`).join("\n")}`);
  }
  if (notes.journal.length) {
    const rows = notes.journal
      .map((e) => `- ${e.entry_date ?? "n/a"} (${e.entry_type ?? "note"})${e.title ? ` ${e.title}` : ""}: ${(e.body ?? "").slice(0, 240)}`)
      .join("\n");
    out.push(`### ${ticker} — your recent journal\n${rows}`);
  }
  return out.join("\n\n");
}

/**
 * Cross-holding patterns computed deterministically so the model reasons about
 * the book as a whole, not one name in isolation: single-name and sector
 * concentration, shared-sector clusters (positions that move on the same
 * drivers), and diversification via the effective number of positions (1/HHI).
 * This is what lets an answer say "you already hold three fertilizer names that
 * all track gas pricing" instead of generic commentary.
 */
export function briefFromPortfolioPatterns(h: HoldingsSummary): string {
  if (h.count < 2) return "";
  const byWeight = [...h.holdings]
    .filter((x) => x.weightPct != null)
    .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0));
  const lines: string[] = [];

  const top = byWeight[0];
  if (top?.weightPct != null) {
    lines.push(`- Largest position: ${top.ticker} at ${top.weightPct.toFixed(1)}% of the book${top.weightPct >= 20 ? " — single-name concentration above 20%" : ""}.`);
  }
  if (byWeight.length >= 3) {
    const top3 = byWeight.slice(0, 3);
    const sum = top3.reduce((s, x) => s + (x.weightPct ?? 0), 0);
    lines.push(`- Top 3 (${top3.map((x) => x.ticker).join(", ")}) are ${sum.toFixed(0)}% of the book.`);
  }

  const topSec = h.sectors[0];
  if (topSec) {
    lines.push(`- Heaviest sector: ${topSec.sector} at ${topSec.weightPct.toFixed(1)}% across ${topSec.count} name${topSec.count === 1 ? "" : "s"}${topSec.weightPct >= 35 ? " — sector concentration above 35%" : ""}.`);
  }

  const clusters = h.sectors.filter((s) => s.count > 1);
  if (clusters.length) {
    for (const s of clusters) {
      const names = byWeight.filter((x) => (x.sector ?? "Unclassified") === s.sector).map((x) => x.ticker);
      lines.push(`- Shared ${s.sector} exposure: ${names.join(", ")} (${s.weightPct.toFixed(0)}% combined) — these move on the same sector drivers.`);
    }
  } else {
    lines.push(`- No two holdings share a sector; exposure is spread across ${h.sectors.length} sectors.`);
  }

  const hhi = byWeight.reduce((s, x) => s + Math.pow((x.weightPct ?? 0) / 100, 2), 0);
  if (hhi > 0) {
    lines.push(`- Effective number of positions: ${(1 / hhi).toFixed(1)} (of ${h.count} held); a lower number than the count signals concentration.`);
  }

  return `## Portfolio patterns (pre-computed; reason across holdings, do not recompute)\n${lines.join("\n")}`;
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
