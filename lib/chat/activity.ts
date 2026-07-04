/**
 * Structured research-activity steps for the Copilot's progress panel.
 *
 * The old pipeline streamed the same canned strings on every question
 * ("Checking valuation and fundamentals"). These helpers produce steps that
 * name what is actually being read ("FFC — valuation and fundamentals") and,
 * once a lookup returns, a compact factual outcome ("12 payouts on record"),
 * the way first-class research products show their work. Pure functions so
 * both provider paths and the tests share them.
 */

export interface ActivityEvent {
  type: "activity";
  /** Stable id so the client patches the same step from running to done. */
  id: string;
  label: string;
  detail?: string;
  done?: boolean;
}

// ── Start labels (tool + its input) ──────────────────────────────────────────

const TOOL_VERBS: Record<string, string> = {
  get_portfolio_summary: "Portfolio — allocation and performance",
  list_holdings: "Portfolio — all holdings and sector weights",
  get_performance: "Portfolio — performance history",
  get_thesis: "Your thesis",
  get_journal: "Your decision journal",
  get_market_overview: "PSX — index, breadth and leaders",
  get_sector_performance: "PSX — sector performance",
  get_foreign_flows: "PSX — foreign and institutional flows",
  list_company_reports: "Research library — saved company reports",
};

const TICKER_VERBS: Record<string, string> = {
  get_quote: "latest quote",
  get_position: "your position",
  get_position_history: "your transactions and tranches",
  get_ratios: "valuation and fundamentals",
  get_technicals: "price structure and momentum",
  compute_indicator: "custom indicator",
  get_dividends: "dividend history",
  get_news: "filings and news",
};

function tickerOf(input: Record<string, unknown>): string | null {
  if (typeof input.ticker === "string" && input.ticker.trim()) return input.ticker.toUpperCase();
  return null;
}

function tickersOf(input: Record<string, unknown>): string[] {
  if (Array.isArray(input.tickers)) {
    return input.tickers.filter((t): t is string => typeof t === "string").map((t) => t.toUpperCase());
  }
  const single = tickerOf(input);
  return single ? [single] : [];
}

export function toolStartLabel(name: string, input: Record<string, unknown> = {}): string {
  if (name === "web_search") {
    const q = typeof input.query === "string" ? input.query.trim() : "";
    return q ? `Web — “${q.length > 60 ? `${q.slice(0, 57)}…` : q}”` : "Web — searching recent coverage";
  }
  if (name === "search_ticker") {
    const q = typeof input.query === "string" ? input.query.trim() : "";
    return q ? `PSX universe — “${q}”` : "PSX universe — symbol lookup";
  }
  if (name === "get_performance") {
    const days = typeof input.days === "number" && Number.isFinite(input.days) ? Math.round(input.days) : null;
    return days ? `Portfolio — ${days}-day performance history` : TOOL_VERBS.get_performance;
  }
  if (name === "get_sector_performance" && typeof input.sector === "string" && input.sector.trim()) {
    return `PSX — ${input.sector.trim()} sector performance`;
  }
  if (name === "get_foreign_flows" && typeof input.sector === "string" && input.sector.trim()) {
    return `PSX — ${input.sector.trim()} foreign-flow read`;
  }
  if (name === "list_company_reports") {
    const t = tickerOf(input);
    return t ? `${t} — saved research reports` : TOOL_VERBS.list_company_reports;
  }
  if (name === "get_company_report") {
    const t = tickerOf(input);
    return t ? `${t} — saved research report` : "Research library — saved company report";
  }
  if (name in TOOL_VERBS) {
    const t = tickerOf(input);
    return t && (name === "get_thesis" || name === "get_journal") ? `${TOOL_VERBS[name]} — ${t}` : TOOL_VERBS[name];
  }
  if (name in TICKER_VERBS) {
    const list = tickersOf(input);
    if (name === "compute_indicator" && typeof input.indicator === "string") {
      const spec = `${String(input.indicator).toUpperCase()}${input.period ? `(${input.period})` : ""}`;
      return list.length ? `${list[0]} — ${spec}` : spec;
    }
    if (list.length > 3) return `${list.slice(0, 3).join(", ")} +${list.length - 3} more — ${TICKER_VERBS[name]}`;
    if (list.length > 0) return `${list.join(", ")} — ${TICKER_VERBS[name]}`;
    return name === "get_news" ? "Portfolio and market news" : `Reading ${TICKER_VERBS[name]}`;
  }
  return `Reading ${name.replace(/_/g, " ")}`;
}

// ── Outcome details (tool + its result) ──────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function count(v: unknown): number | null {
  return Array.isArray(v) ? v.length : null;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function money(value: number): string {
  return `PKR ${value.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}%`;
}

/**
 * One short factual phrase about what a tool call returned, or null when
 * there is nothing better than "done". Never guesses: reads only fields that
 * are actually present.
 */
export function toolDoneDetail(name: string, result: unknown): string | null {
  if (!isRecord(result)) return null;
  if (typeof result.error === "string") return "nothing on record";

  switch (name) {
    case "get_quote": {
      const price = numberField(result, "price");
      const date = stringField(result, "asOf") ?? stringField(result, "date");
      return price != null ? `PKR ${price.toLocaleString("en-PK", { maximumFractionDigits: 2 })}${date ? ` (${date})` : ""}` : null;
    }
    case "get_position": {
      if (result.owned === false) return "not in portfolio";
      const quantity = numberField(result, "quantity");
      const marketValue = numberField(result, "marketValue");
      if (quantity != null && marketValue != null) return `${quantity.toLocaleString("en-PK")} shares, ${money(marketValue)}`;
      return quantity != null ? `${quantity.toLocaleString("en-PK")} shares` : null;
    }
    case "get_ratios": {
      const n = Array.isArray(result.rows)
        ? result.rows.filter((row) => isRecord(row) && numberField(row, "value") != null).length
        : null;
      const period = stringField(result, "sourcePeriod");
      return n != null ? `${n} ratio${n === 1 ? "" : "s"}${period ? ` (${period})` : ""}` : null;
    }
    case "get_technicals": {
      const price = numberField(result, "price");
      const rsi = numberField(result, "rsi");
      const bits = [
        price != null ? `PKR ${price.toLocaleString("en-PK", { maximumFractionDigits: 2 })}` : null,
        rsi != null ? `RSI ${Math.round(rsi)}` : null,
      ].filter((bit): bit is string => !!bit);
      return bits.length ? bits.join(", ") : null;
    }
    case "compute_indicator": {
      const indicator = stringField(result, "indicator");
      const period = numberField(result, "period");
      const value = numberField(result, "value");
      const asOf = stringField(result, "asOf");
      if (value == null) return stringField(result, "note");
      return `${indicator ?? "indicator"}${period != null ? `(${period})` : ""} ${value.toLocaleString("en-PK", { maximumFractionDigits: 3 })}${asOf ? ` (${asOf})` : ""}`;
    }
    case "get_news": {
      const n = count(result.items);
      return n != null ? (n === 0 ? "no items in the window" : `${n} item${n === 1 ? "" : "s"}`) : null;
    }
    case "get_dividends": {
      // Batch shape: { TICKER: card | {error} }
      const keys = Object.keys(result);
      if (keys.length && keys.every((k) => k === k.toUpperCase() && isRecord(result[k]))) {
        const withData = keys.filter((k) => !(isRecord(result[k]) && typeof (result[k] as Record<string, unknown>).error === "string"));
        return `${withData.length} of ${keys.length} payers with history`;
      }
      const n = count(result.payouts) ?? count(result.history) ?? count(result.recent);
      return n != null ? `${n} payout${n === 1 ? "" : "s"} on record` : null;
    }
    case "list_holdings": {
      const n = typeof result.count === "number" ? result.count : count(result.holdings);
      const sectors = count(result.sectors);
      return n != null ? `${n} holding${n === 1 ? "" : "s"}${sectors != null ? ` across ${sectors} sector${sectors === 1 ? "" : "s"}` : ""}` : null;
    }
    case "get_portfolio_summary": {
      const n = numberField(result, "holdingsCount");
      const totalValue = numberField(result, "totalValue");
      if (n != null && totalValue != null) return `${n} holding${n === 1 ? "" : "s"}, ${money(totalValue)}`;
      return n != null ? `${n} holding${n === 1 ? "" : "s"}` : null;
    }
    case "get_position_history": {
      const ledger = recordField(result, "ledger");
      const reconciliation = recordField(result, "quantityReconciliation");
      const n = count(ledger?.rows) ?? numberField(ledger ?? {}, "transactionCount");
      const status = reconciliation ? stringField(reconciliation, "status") : null;
      return n != null ? `${n} transaction${n === 1 ? "" : "s"}${status ? `, ${status}` : ""}` : null;
    }
    case "get_thesis": {
      const n = count(result.theses);
      if (n != null) return n === 0 ? "no saved thesis" : `${n} thesis record${n === 1 ? "" : "s"}`;
      return result.thesis || result.why_bought ? "thesis on file" : "no saved thesis";
    }
    case "get_journal": {
      const n = count(result.entries) ?? count(result.items);
      return n != null ? (n === 0 ? "no entries" : `${n} entr${n === 1 ? "y" : "ies"}`) : null;
    }
    case "web_search": {
      const n = count(result.results) ?? count(result.items);
      return n != null ? (n === 0 ? "no relevant results" : `${n} source${n === 1 ? "" : "s"}`) : null;
    }
    case "search_ticker": {
      const n = count(result.matches);
      return n != null ? `${n} match${n === 1 ? "" : "es"}` : null;
    }
    case "get_sector_performance": {
      const sectors = Array.isArray(result.sectors) ? result.sectors : null;
      if (!sectors) return null;
      if (sectors.length === 1 && isRecord(sectors[0])) {
        const sector = stringField(sectors[0], "sector");
        const avgReturn = numberField(sectors[0], "avgReturn");
        return sector ? `${sector}${avgReturn != null ? ` ${pct(avgReturn)}` : ""}` : "1 sector";
      }
      return `${sectors.length} sectors ranked`;
    }
    case "get_market_overview": {
      const date = stringField(result, "date");
      const advancers = numberField(result, "advancers");
      const decliners = numberField(result, "decliners");
      const change = numberField(result, "indexChangePct");
      const breadth = advancers != null && decliners != null ? `${advancers} up / ${decliners} down` : null;
      return [date, change != null ? pct(change) : null, breadth].filter((bit): bit is string => !!bit).join(", ") || null;
    }
    case "get_foreign_flows": {
      const date = stringField(result, "date");
      const stance = stringField(result, "stance");
      const cumulative = numberField(result, "cumulative_net_recent");
      const unit = stringField(result, "unit");
      const flow = cumulative != null ? `${cumulative >= 0 ? "+" : ""}${cumulative.toLocaleString("en-PK", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}` : null;
      return [date, stance, flow].filter((bit): bit is string => !!bit).join(", ") || null;
    }
    case "get_performance": {
      const points = numberField(result, "points") ?? count(result.snapshots);
      const from = stringField(result, "from");
      const to = stringField(result, "to");
      return points != null ? `${points} snapshot${points === 1 ? "" : "s"}${from && to ? ` (${from} to ${to})` : ""}` : null;
    }
    case "list_company_reports": {
      const n = count(result.reports);
      return n != null ? `${n} report${n === 1 ? "" : "s"}` : null;
    }
    case "get_company_report": {
      const ticker = stringField(result, "ticker");
      const version = numberField(result, "version");
      return ticker ? `${ticker}${version != null ? ` v${version}` : ""}` : stringField(result, "title");
    }
    default:
      return null;
  }
}

// ── Context-phase helpers ────────────────────────────────────────────────────

const CARD_NOUNS: Record<string, string> = {
  quote: "quotes",
  position: "positions",
  ratios: "fundamentals",
  technical: "technicals",
  dividend: "dividends",
  news: "news",
  market: "market snapshot",
  sector: "sectors",
  foreign_flow: "foreign flows",
  holdings: "holdings",
};

/** "quotes, fundamentals, technicals and holdings" from gathered card kinds. */
export function describeCards(kinds: string[]): string {
  const seen: string[] = [];
  for (const k of kinds) {
    const noun = CARD_NOUNS[k] ?? k.replace(/_/g, " ");
    if (!seen.includes(noun)) seen.push(noun);
  }
  if (seen.length === 0) return "";
  if (seen.length === 1) return seen[0];
  return `${seen.slice(0, -1).join(", ")} and ${seen[seen.length - 1]}`;
}

export function contextStartLabel(tickers: string[], sector: string | null): string {
  if (tickers.length) return `Scanning your portfolio and ${tickers.slice(0, 3).join(", ")} context`;
  if (sector) return `Scanning your portfolio and the ${sector} sector`;
  return "Scanning your portfolio and PSX context";
}
