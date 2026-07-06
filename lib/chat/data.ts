import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle, TechnicalSignals } from "@/lib/market/technicals";
import { getPortfolio } from "@/lib/portfolio";
import { getUserNewsFeed } from "@/lib/news/global-store";

/**
 * Compact, FREE data getters for the chat assistant — everything reads from
 * already-populated Supabase tables (no live API, no LLM). Each getter returns
 * a small typed object that doubles as (a) a "card" the UI renders directly and
 * (b) a line in the digested brief handed to Claude. Keeping these tiny is the
 * whole cost story: Claude ingests numbers, never raw documents.
 */

export interface QuoteCard {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  asOf: string | null;
}

export interface PositionCard {
  ticker: string;
  quantity: number;
  avgCost: number;
  totalCost: number;
  price: number | null;
  marketValue: number | null;
  unrealizedPL: number | null;
  unrealizedPLPct: number | null;
  dayChangePct: number | null;
}

export interface PositionHistoryCard {
  ticker: string;
  quote: {
    price: number | null;
    asOf: string | null;
    sector: string | null;
    companyName: string | null;
  };
  holding: {
    quantity: number;
    avgCost: number;
    totalCost: number;
    source: string | null;
    lastUpdated: string | null;
  } | null;
  portfolio: {
    equityValue: number;
    cashBalance: number;
    netWorth: number;
    currentEquityWeightPct: number | null;
    currentNetWorthWeightPct: number | null;
    sector: string | null;
    sectorEquityWeightPct: number | null;
    sectorNetWorthWeightPct: number | null;
  };
  ledger: {
    transactionCount: number;
    buyCount: number;
    sellCount: number;
    firstBuyDate: string | null;
    latestBuyDate: string | null;
    totalBoughtQuantity: number;
    totalSoldQuantity: number;
    totalBuyCost: number;
    weightedAverageBuyCost: number | null;
    currentQuantity: number | null;
    avgCost: number | null;
    totalCost: number | null;
    realizedPL: number;
    sourceBreakdown: Record<string, number>;
    rows: {
      date: string | null;
      type: string;
      quantity: number | null;
      price: number | null;
      netAmount: number | null;
      fees: number;
      realizedPL: number | null;
      quantityAfter: number;
      avgCostAfter: number;
      totalCostAfter: number;
      source: string | null;
      notes: string | null;
    }[];
  };
  quantityReconciliation: {
    holdingsQuantity: number | null;
    transactionLedgerQuantity: number | null;
    brokerInventoryQuantity: number | null;
    brokerAsOf: string | null;
    brokerSource: string | null;
    manualPurchaseQuantity: number;
    postCheckpointTransactionDelta: number | null;
    expectedQuantity: number | null;
    holdingVsLedgerDifference: number | null;
    holdingVsBrokerExpectedDifference: number | null;
    ledgerVsBrokerExpectedDifference: number | null;
    status: "reconciled" | "difference" | "partial" | "unavailable";
  };
  additionScenarios: {
    label: string;
    amount: number;
    estimatedShares: number | null;
    capitalRequired: number | null;
    newQuantity: number | null;
    newAvgCost: number | null;
    newPositionValue: number | null;
    currentWeightPct: number | null;
    newWeightPct: number | null;
    weightChangePct: number | null;
    newSectorWeightPct: number | null;
    cashAfter: number | null;
    externalCapitalRequired: number | null;
  }[];
  notes: string[];
}

export interface RatioCard {
  ticker: string;
  rows: { name: string; value: number | null; period: string | null }[];
  sourcePeriod: string | null;
  /** Latest annual and latest interim income-statement periods on file, so the
   * brief can flag when newer interim results exist beyond the annual series. */
  latestAnnualPeriod: string | null;
  latestInterimPeriod: string | null;
  /** Quote used to re-reconcile price-linked ratios at read time. */
  priceUsed: number | null;
  priceAsOf: string | null;
}

export interface TechnicalCard {
  ticker: string;
  price: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  rsi: number | null;
  ma50: number | null;
  ma200: number | null;
  spark: number[] | null;
  signals: TechnicalSignals | null; // EMA21/55, EFI, divergences, Fib/ABCD, seasonality, trade plan
}

export interface DividendCard {
  ticker: string;
  ttmDps: number | null;
  recent: { raw: string; date: string | null }[];
}

export interface NewsCard {
  ticker: string | null;
  items: { title: string; type: string; date: string; url: string | null; summary?: string | null; sentiment?: string | null; source?: string | null }[];
}

export interface MarketCard {
  date: string;
  indexName: string | null;
  indexValue: number | null;
  indexChangePct: number | null;
  advancers: number;
  decliners: number;
  topSector: string | null;
  bottomSector: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const numeric = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

function lastBuyAmount(rows: PositionHistoryCard["ledger"]["rows"]): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if ((r.type === "BUY" || r.type === "RIGHT") && r.netAmount != null && r.netAmount > 0) {
      return r.netAmount;
    }
  }
  return null;
}

function chooseAdditionAmounts({
  proposedAmount,
  recentBuyAmount,
  cashBalance,
  netWorth,
  currentPositionValue,
}: {
  proposedAmount?: number | null;
  recentBuyAmount: number | null;
  cashBalance: number;
  netWorth: number;
  currentPositionValue: number;
}): { label: string; amount: number }[] {
  const candidates: { label: string; amount: number }[] = [];
  const push = (label: string, amount: number | null | undefined) => {
    if (amount == null || !Number.isFinite(amount) || amount <= 0) return;
    const rounded = round2(amount);
    if (candidates.some((c) => Math.abs(c.amount - rounded) <= Math.max(100, rounded * 0.02))) return;
    candidates.push({ label, amount: rounded });
  };

  push("Proposed amount", proposedAmount ?? null);
  if (proposedAmount == null) {
    push("Last buy size", recentBuyAmount);
    push("1% of net worth", netWorth > 0 ? netWorth * 0.01 : null);
    push("25% of current position", currentPositionValue > 0 ? currentPositionValue * 0.25 : null);
    push("Available cash", cashBalance > 0 ? cashBalance : null);
  }

  return candidates.slice(0, 3);
}

export async function getQuoteCard(db: SupabaseClient, ticker: string): Promise<QuoteCard | null> {
  const t = ticker.toUpperCase();
  const [{ data: q }, { data: meta }] = await Promise.all([
    db.from("market_quotes").select("price, prev_close, day_change, day_change_pct, volume, market_cap, as_of").eq("ticker", t).maybeSingle(),
    db.from("stock_universe").select("company_name, sector").eq("ticker", t).maybeSingle(),
  ]);
  if (!q && !meta) return null;

  return {
    ticker: t,
    companyName: meta?.company_name ?? null,
    sector: meta?.sector ?? null,
    price: num(q?.price),
    prevClose: num(q?.prev_close),
    change: num(q?.day_change),
    changePct: num(q?.day_change_pct),
    volume: num(q?.volume),
    marketCap: num(q?.market_cap),
    asOf: q?.as_of ?? null,
  };
}

/**
 * The most recent PSX session date we hold data for (max as_of across all
 * quotes). Used to judge whether a single stock's last close is genuinely stale
 * or simply the latest session — which automatically respects weekends and
 * public holidays (Ashura, Eid, etc.), since the market has no session, and so
 * no newer as_of, on those days.
 */
export async function getLatestSessionDate(db: SupabaseClient): Promise<string | null> {
  const { data } = await db
    .from("market_quotes")
    .select("as_of")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.as_of as string) ?? null;
}

/**
 * Daily close+volume candles for a ticker from the cached technicals bundle,
 * oldest first. Powers on-demand indicator math (any-period EMA/SMA/RSI). The
 * caller falls back to a live PSX fetch when the cache is empty.
 */
export async function getDailyCandles(db: SupabaseClient, ticker: string): Promise<Candle[]> {
  const { data } = await db
    .from("company_technicals")
    .select("data")
    .eq("ticker", ticker.toUpperCase())
    .maybeSingle();
  const hist = (data?.data as { history?: Candle[] } | null)?.history;
  return Array.isArray(hist) ? hist : [];
}

export async function getPositionCard(db: SupabaseClient, userId: string, ticker: string): Promise<PositionCard | null> {
  const t = ticker.toUpperCase();
  const { data: h } = await db
    .from("holdings")
    .select("quantity, avg_cost, total_cost")
    .eq("user_id", userId)
    .eq("ticker", t)
    .eq("hidden", false)
    .gt("quantity", 0)
    .maybeSingle();
  if (!h) return null;
  const { data: q } = await db.from("market_quotes").select("price, day_change_pct").eq("ticker", t).maybeSingle();
  const price = num(q?.price);
  const quantity = Number(h.quantity);
  const avgCost = Number(h.avg_cost);
  const totalCost = Number(h.total_cost) || quantity * avgCost;
  const marketValue = price != null ? price * quantity : null;
  const unrealizedPL = marketValue != null ? marketValue - totalCost : null;

  return {
    ticker: t,
    quantity,
    avgCost,
    totalCost,
    price,
    marketValue,
    unrealizedPL,
    unrealizedPLPct: unrealizedPL != null && totalCost > 0 ? (unrealizedPL / totalCost) * 100 : null,
    dayChangePct: num(q?.day_change_pct),
  };
}

export async function getPositionHistoryCard(
  db: SupabaseClient,
  userId: string,
  ticker: string,
  proposedAmount?: number | null
): Promise<PositionHistoryCard> {
  const t = ticker.toUpperCase();
  const [
    { data: holding },
    { data: txns },
    quote,
    portfolio,
    { data: checkpoint },
  ] = await Promise.all([
    db
      .from("holdings")
      .select("ticker, quantity, avg_cost, total_cost, source, last_updated")
      .eq("user_id", userId)
      .eq("ticker", t)
      .eq("hidden", false)
      .maybeSingle(),
    db
      .from("transactions")
      .select("trade_date, type, quantity, price, gross_amount, commission, tax, net_amount, realized_pl, source, notes, created_at")
      .eq("user_id", userId)
      .eq("ticker", t)
      .order("trade_date", { ascending: true }),
    getQuoteCard(db, t),
    getPortfolio(db, userId),
    db
      .from("reconciliation_checkpoints")
      .select("as_of, source, data")
      .eq("user_id", userId)
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = (txns ?? []).sort((a, b) =>
    String(a.trade_date ?? a.created_at ?? "9999").localeCompare(String(b.trade_date ?? b.created_at ?? "9999"))
  );
  let ledgerQty = 0;
  let ledgerCost = 0;
  let ledgerAvg = 0;
  let realizedPL = 0;
  let buyCount = 0;
  let sellCount = 0;
  let totalBoughtQuantity = 0;
  let totalSoldQuantity = 0;
  let totalBuyCost = 0;
  const buyDates: string[] = [];
  const sourceBreakdown: Record<string, number> = {};

  const historyRows: PositionHistoryCard["ledger"]["rows"] = rows.map((r) => {
    const type = String(r.type ?? "UNKNOWN").toUpperCase();
    const signedQty = numeric(r.quantity);
    const qty = Math.abs(signedQty ?? 0);
    const price = numeric(r.price);
    const netAmount = numeric(r.net_amount);
    const commission = numeric(r.commission) ?? 0;
    const tax = numeric(r.tax) ?? 0;
    const fees = round2(commission + tax);
    const source = typeof r.source === "string" ? r.source : null;
    if (source) sourceBreakdown[source] = (sourceBreakdown[source] ?? 0) + 1;
    let rowRealized: number | null = null;

    switch (type) {
      case "BUY":
      case "RIGHT": {
        const costIn = netAmount != null && netAmount > 0
          ? netAmount
          : qty * (price ?? 0) + commission + tax;
        ledgerQty += qty;
        ledgerCost += costIn;
        ledgerAvg = ledgerQty > 0 ? ledgerCost / ledgerQty : 0;
        buyCount++;
        totalBoughtQuantity += qty;
        totalBuyCost += costIn;
        if (r.trade_date) buyDates.push(String(r.trade_date));
        break;
      }
      case "SELL": {
        const sellQty = Math.min(qty, ledgerQty);
        const proceeds = netAmount != null && netAmount > 0
          ? netAmount
          : qty * (price ?? 0) - commission - tax;
        const costOut = ledgerAvg * sellQty;
        rowRealized = numeric(r.realized_pl) ?? (proceeds - costOut);
        realizedPL += rowRealized;
        ledgerQty -= sellQty;
        ledgerCost -= costOut;
        if (ledgerQty <= 0) {
          ledgerQty = 0;
          ledgerCost = 0;
          ledgerAvg = 0;
        } else {
          ledgerAvg = ledgerCost / ledgerQty;
        }
        sellCount++;
        totalSoldQuantity += qty;
        break;
      }
      case "BONUS": {
        ledgerQty += qty;
        ledgerAvg = ledgerQty > 0 ? ledgerCost / ledgerQty : 0;
        break;
      }
      case "SPLIT": {
        const factor = qty || 1;
        if (factor > 0 && ledgerQty > 0) {
          ledgerQty *= factor;
          ledgerAvg = ledgerCost / ledgerQty;
        }
        break;
      }
      case "ADJUST": {
        const delta = signedQty ?? 0;
        if (delta > 0) {
          const costIn = netAmount != null && netAmount > 0 ? netAmount : delta * (price ?? 0);
          ledgerQty += delta;
          ledgerCost += costIn;
        } else if (delta < 0) {
          const removeQty = Math.min(Math.abs(delta), ledgerQty);
          ledgerCost -= ledgerAvg * removeQty;
          ledgerQty -= removeQty;
        } else if ((price ?? 0) > 0 && ledgerQty > 0) {
          ledgerCost = ledgerQty * (price ?? 0);
        }
        if (ledgerQty <= 0) {
          ledgerQty = 0;
          ledgerCost = 0;
          ledgerAvg = 0;
        } else {
          ledgerAvg = ledgerCost / ledgerQty;
        }
        break;
      }
      default:
        break;
    }

    return {
      date: r.trade_date ? String(r.trade_date) : null,
      type,
      quantity: signedQty,
      price,
      netAmount,
      fees,
      realizedPL: rowRealized != null ? round2(rowRealized) : null,
      quantityAfter: round2(ledgerQty),
      avgCostAfter: round2(ledgerAvg),
      totalCostAfter: round2(ledgerCost),
      source,
      notes: typeof r.notes === "string" ? r.notes.slice(0, 160) : null,
    };
  });

  const holdingQty = numeric(holding?.quantity);
  const holdingCost = numeric(holding?.total_cost);
  const holdingAvg = numeric(holding?.avg_cost);
  const price = quote?.price ?? null;
  const sector = quote?.sector ?? portfolio.holdings.find((h) => h.ticker === t)?.sector ?? null;
  const portfolioHolding = portfolio.holdings.find((h) => h.ticker === t) ?? null;
  const sectorWeight = sector ? portfolio.sectorWeights.find((s) => s.sector === sector) : null;
  const sectorEquityValue = sectorWeight?.value ?? 0;
  const equityValue = round2(portfolio.totalValue);
  const cashBalance = round2(portfolio.cashBalance);
  const netWorth = round2(equityValue + cashBalance);
  const currentPositionValue =
    portfolioHolding?.market_value ??
    (price != null && holdingQty != null ? price * holdingQty : holdingCost ?? 0);

  const checkpointData = checkpoint?.data as
    | {
        items?: { ticker?: string; quantity?: unknown }[];
        manualPurchases?: { ticker?: string; quantity?: unknown }[];
      }
    | null
    | undefined;
  const brokerItem = checkpointData?.items?.find((x) => String(x.ticker ?? "").toUpperCase() === t);
  const checkpointHasInventory = !!checkpoint && Array.isArray(checkpointData?.items);
  const brokerInventoryQuantity = checkpointHasInventory ? numeric(brokerItem?.quantity) ?? 0 : null;
  const brokerAsOf = checkpoint?.as_of ? String(checkpoint.as_of) : null;
  const transactionLedgerQuantity = rows.length ? round2(ledgerQty) : null;
  const ledgerQtyAtBrokerDate =
    brokerAsOf && historyRows.length
      ? [...historyRows].reverse().find((r) => r.date != null && r.date <= brokerAsOf)?.quantityAfter ?? 0
      : null;
  const postCheckpointTransactionDelta =
    brokerAsOf && transactionLedgerQuantity != null && ledgerQtyAtBrokerDate != null
      ? round2(transactionLedgerQuantity - ledgerQtyAtBrokerDate)
      : null;
  const manualPurchaseQuantity = round2(
    (checkpointData?.manualPurchases ?? [])
      .filter((x) => String(x.ticker ?? "").toUpperCase() === t)
      .reduce((sum, x) => sum + (numeric(x.quantity) ?? 0), 0)
  );
  const expectedQuantity = brokerInventoryQuantity != null
    ? round2(brokerInventoryQuantity + manualPurchaseQuantity + (postCheckpointTransactionDelta ?? 0))
    : null;
  const holdingVsLedgerDifference =
    holdingQty != null && transactionLedgerQuantity != null
      ? round2(holdingQty - transactionLedgerQuantity)
      : null;
  const holdingVsBrokerExpectedDifference =
    holdingQty != null && expectedQuantity != null
      ? round2(holdingQty - expectedQuantity)
      : null;
  const ledgerVsBrokerExpectedDifference =
    transactionLedgerQuantity != null && expectedQuantity != null
      ? round2(transactionLedgerQuantity - expectedQuantity)
      : null;
  const diffs = [holdingVsLedgerDifference, holdingVsBrokerExpectedDifference, ledgerVsBrokerExpectedDifference]
    .filter((v): v is number => v != null);
  const reconStatus: PositionHistoryCard["quantityReconciliation"]["status"] =
    diffs.length === 0
      ? "unavailable"
      : diffs.some((d) => Math.abs(d) >= 0.0001)
        ? "difference"
        : holdingVsLedgerDifference == null || holdingVsBrokerExpectedDifference == null
          ? "partial"
          : "reconciled";

  const scenarioAmounts = chooseAdditionAmounts({
    proposedAmount,
    recentBuyAmount: lastBuyAmount(historyRows),
    cashBalance,
    netWorth,
    currentPositionValue,
  });
  const additionScenarios = scenarioAmounts.map(({ label, amount }) => {
    if (price == null || price <= 0 || holdingQty == null) {
      return {
        label,
        amount: round2(amount),
        estimatedShares: null,
        capitalRequired: null,
        newQuantity: null,
        newAvgCost: null,
        newPositionValue: null,
        currentWeightPct: netWorth > 0 ? round2((currentPositionValue / netWorth) * 100) : null,
        newWeightPct: null,
        weightChangePct: null,
        newSectorWeightPct: null,
        cashAfter: null,
        externalCapitalRequired: null,
      };
    }
    const estimatedShares = Math.floor(amount / price);
    const capitalRequired = round2(estimatedShares * price);
    const baseCost = holdingCost ?? holdingQty * (holdingAvg ?? 0);
    const newQuantity = round2(holdingQty + estimatedShares);
    const newAvgCost = newQuantity > 0 ? round2((baseCost + capitalRequired) / newQuantity) : null;
    const newPositionValue = round2(newQuantity * price);
    const externalCapitalRequired = round2(Math.max(0, capitalRequired - Math.max(0, cashBalance)));
    const newNetWorth = netWorth + externalCapitalRequired;
    const currentWeightPct = netWorth > 0 ? round2((currentPositionValue / netWorth) * 100) : null;
    const newWeightPct = newNetWorth > 0 ? round2((newPositionValue / newNetWorth) * 100) : null;
    return {
      label,
      amount: round2(amount),
      estimatedShares,
      capitalRequired,
      newQuantity,
      newAvgCost,
      newPositionValue,
      currentWeightPct,
      newWeightPct,
      weightChangePct: currentWeightPct != null && newWeightPct != null ? round2(newWeightPct - currentWeightPct) : null,
      newSectorWeightPct: newNetWorth > 0 ? round2(((sectorEquityValue + capitalRequired) / newNetWorth) * 100) : null,
      cashAfter: round2(Math.max(0, cashBalance) - Math.min(Math.max(0, cashBalance), capitalRequired)),
      externalCapitalRequired,
    };
  });

  const notes: string[] = [];
  if (rows.length === 0) notes.push("No transaction ledger rows are stored for this ticker; holdings may come from a snapshot or manual entry.");
  if (!checkpoint) notes.push("No broker reconciliation checkpoint is stored, so broker-statement quantity cannot be independently checked.");
  if (price == null) notes.push("No current market quote is available, so add-size share counts and weights are incomplete.");
  const sortedBuyDates = buyDates.sort((a, b) => a.localeCompare(b));

  return {
    ticker: t,
    quote: {
      price,
      asOf: quote?.asOf ?? null,
      sector,
      companyName: quote?.companyName ?? null,
    },
    holding: holdingQty != null ? {
      quantity: holdingQty,
      avgCost: holdingAvg ?? 0,
      totalCost: holdingCost ?? holdingQty * (holdingAvg ?? 0),
      source: typeof holding?.source === "string" ? holding.source : null,
      lastUpdated: typeof holding?.last_updated === "string" ? holding.last_updated : null,
    } : null,
    portfolio: {
      equityValue,
      cashBalance,
      netWorth,
      currentEquityWeightPct: equityValue > 0 && currentPositionValue != null ? round2((currentPositionValue / equityValue) * 100) : null,
      currentNetWorthWeightPct: netWorth > 0 && currentPositionValue != null ? round2((currentPositionValue / netWorth) * 100) : null,
      sector,
      sectorEquityWeightPct: sectorWeight?.weight != null ? round2(sectorWeight.weight) : null,
      sectorNetWorthWeightPct: netWorth > 0 ? round2((sectorEquityValue / netWorth) * 100) : null,
    },
    ledger: {
      transactionCount: rows.length,
      buyCount,
      sellCount,
      firstBuyDate: sortedBuyDates[0] ?? null,
      latestBuyDate: sortedBuyDates[sortedBuyDates.length - 1] ?? null,
      totalBoughtQuantity: round2(totalBoughtQuantity),
      totalSoldQuantity: round2(totalSoldQuantity),
      totalBuyCost: round2(totalBuyCost),
      weightedAverageBuyCost: totalBoughtQuantity > 0 ? round2(totalBuyCost / totalBoughtQuantity) : null,
      currentQuantity: transactionLedgerQuantity,
      avgCost: transactionLedgerQuantity != null ? round2(ledgerAvg) : null,
      totalCost: transactionLedgerQuantity != null ? round2(ledgerCost) : null,
      realizedPL: round2(realizedPL),
      sourceBreakdown,
      rows: historyRows,
    },
    quantityReconciliation: {
      holdingsQuantity: holdingQty,
      transactionLedgerQuantity,
      brokerInventoryQuantity,
      brokerAsOf,
      brokerSource: checkpoint?.source ? String(checkpoint.source) : null,
      manualPurchaseQuantity,
      postCheckpointTransactionDelta,
      expectedQuantity,
      holdingVsLedgerDifference,
      holdingVsBrokerExpectedDifference,
      ledgerVsBrokerExpectedDifference,
      status: reconStatus,
    },
    additionScenarios,
    notes,
  };
}

const RATIO_ORDER = [
  "P/E", "Earnings yield", "EPS (TTM)", "Interim EPS growth", "P/B", "P/S", "EV/Sales", "EV/EBIT", "FCF yield",
  "Dividend yield (TTM)", "Payout ratio", "Dividend cover", "Book value / share",
  "Sales / share", "Cash / share", "Gross margin", "Operating margin", "Net margin",
  "ROE", "ROA", "ROIC", "Asset turnover", "Debt-to-equity", "Net debt-to-equity",
  "Debt / assets", "Liabilities / assets", "Current ratio", "Quick ratio", "Cash ratio",
  "Interest coverage", "Receivables / revenue", "Receivables / share", "Receivables % of market cap",
  "Days sales outstanding", "OCF / PAT", "Cash conversion", "Accrual ratio", "Revenue growth",
  "Profit growth", "EPS growth", "Revenue CAGR", "EPS CAGR", "Gross margin change",
  "Net margin change", "FCF margin",
];

export async function getRatioCard(db: SupabaseClient, ticker: string): Promise<RatioCard | null> {
  const t = ticker.toUpperCase();
  const [{ data }, { data: quote }, { data: periods }] = await Promise.all([
    db.from("company_ratios").select("ratio_name, ratio_value, source_period, inputs").eq("ticker", t),
    db.from("market_quotes").select("price, as_of").eq("ticker", t).maybeSingle(),
    db
      .from("company_financials")
      .select("fiscal_year, fiscal_period, period_type")
      .eq("ticker", t)
      .eq("statement_type", "income_statement")
      .eq("review_status", "published")
      .order("fiscal_year", { ascending: false })
      .limit(12),
  ]);
  if (!data || data.length === 0) return null;
  const byName = new Map(data.map((r) => [r.ratio_name as string, r]));

  // Reconcile price-linked ratios against the live quote at read time. Stored
  // ratios freeze the price they were computed with; the PPL incident served a
  // P/E built on a two-day-old close. Recompute from the stored EPS/DPS inputs
  // and today's quote so price, P/E, and earnings yield always agree.
  const livePrice = numeric(quote?.price);
  const inputNum = (name: string, key: string): number | null => {
    const r = byName.get(name);
    const inputs = (r?.inputs ?? null) as Record<string, unknown> | null;
    return inputs ? numeric(inputs[key]) : null;
  };
  const repriced = new Map<string, number>();
  if (livePrice != null && livePrice > 0) {
    const peEps = inputNum("P/E", "eps");
    if (peEps != null && peEps !== 0) repriced.set("P/E", livePrice / peEps);
    const eyEps = inputNum("Earnings yield", "eps");
    if (eyEps != null) repriced.set("Earnings yield", (eyEps / livePrice) * 100);
    const dps = inputNum("Dividend yield (TTM)", "ttm_dps");
    if (dps != null) repriced.set("Dividend yield (TTM)", (dps / livePrice) * 100);
  }
  const rows = RATIO_ORDER.filter((n) => byName.has(n)).map((n) => {
    const r = byName.get(n)!;
    return { name: n, value: repriced.get(n) ?? num(r.ratio_value), period: (r.source_period as string) ?? null };
  });
  const firstWithPeriod = data.find((r) => r.source_period);

  // Latest annual vs latest interim income statements on file, so the brief can
  // say plainly when newer interim results exist beyond the annual series.
  const isAnnualPeriod = (p: string | null) => (p ?? "").toUpperCase() === "FY";
  const label = (r: { fiscal_year: number | null; fiscal_period: string | null }) =>
    `${r.fiscal_year ?? "?"} ${r.fiscal_period ?? ""}`.trim();
  const annualRow = (periods ?? []).find((r) => isAnnualPeriod(r.fiscal_period as string));
  // Newest interim: latest fiscal year, then latest period end (9M and Q3 both
  // end at nine months; prefer the cumulative 9M as the fuller picture).
  const coverage = (p: string | null) =>
    ({ "9M": 3.5, Q3: 3, H1: 2, Q2: 2, Q1: 1 })[(p ?? "").toUpperCase()] ?? 0;
  const interimRow = (periods ?? [])
    .filter((r) => !isAnnualPeriod(r.fiscal_period as string) && r.fiscal_year != null)
    .sort(
      (a, b) =>
        (b.fiscal_year as number) - (a.fiscal_year as number) ||
        coverage(b.fiscal_period as string) - coverage(a.fiscal_period as string)
    )[0];
  const newerInterim =
    interimRow && (!annualRow || (interimRow.fiscal_year as number) > ((annualRow.fiscal_year as number) ?? 0));

  return {
    ticker: t,
    rows,
    sourcePeriod: (firstWithPeriod?.source_period as string) ?? null,
    latestAnnualPeriod: annualRow ? label(annualRow) : null,
    latestInterimPeriod: newerInterim && interimRow ? label(interimRow) : null,
    priceUsed: livePrice ?? inputNum("P/E", "price"),
    priceAsOf: (quote?.as_of as string) ?? null,
  };
}

export async function getTechnicalCard(db: SupabaseClient, ticker: string): Promise<TechnicalCard | null> {
  const t = ticker.toUpperCase();
  const { data } = await db
    .from("company_technicals")
    .select("latest_price, fifty_two_week_high, fifty_two_week_low, rsi, moving_average_50, moving_average_200, spark, data")
    .eq("ticker", t)
    .maybeSingle();
  if (!data) return null;
  const signals = (data.data as { signals?: TechnicalSignals } | null)?.signals ?? null;
  return {
    ticker: t,
    price: num(data.latest_price),
    fiftyTwoWeekHigh: num(data.fifty_two_week_high),
    fiftyTwoWeekLow: num(data.fifty_two_week_low),
    rsi: num(data.rsi),
    ma50: num(data.moving_average_50),
    ma200: num(data.moving_average_200),
    spark: Array.isArray(data.spark) ? (data.spark as number[]) : null,
    signals,
  };
}

export async function getDividendCard(db: SupabaseClient, ticker: string): Promise<DividendCard | null> {
  const t = ticker.toUpperCase();
  const { data } = await db
    .from("company_payouts")
    .select("dividend_per_share, announcement_date, raw, kind")
    .eq("ticker", t)
    .eq("kind", "cash")
    .order("announcement_date", { ascending: false })
    .limit(8);
  if (!data || data.length === 0) return null;
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const ttmDps =
    data.filter((d) => d.dividend_per_share && (d.announcement_date ?? "") >= cutoff).reduce((s, d) => s + Number(d.dividend_per_share), 0) || null;
  return {
    ticker: t,
    ttmDps,
    recent: data.slice(0, 5).map((d) => ({ raw: (d.raw as string) ?? "", date: (d.announcement_date as string) ?? null })),
  };
}

export async function getNewsCard(
  db: SupabaseClient,
  userId: string,
  ticker: string | null,
  limit = 6
): Promise<NewsCard | null> {
  // Reads the same global + per-user News Center feed the News page uses:
  // market/macro/policy stories, holding-specific news, and PSX filings. The
  // helper falls back to the legacy user table when the global migration is not
  // present, so Copilot stays usable across deploy order.
  const t = ticker?.toUpperCase() ?? null;
  const data = (await getUserNewsFeed(db, userId, Math.max(80, limit * 8)))
    .filter((e) => !e.ignored && !e.low_confidence)
    .filter((e) => !t || e.ticker === t || (e.impact_tickers ?? []).includes(t))
    .sort((a, b) => articleTime(b) - articleTime(a))
    .slice(0, limit);
  if (data.length === 0) return null;
  return {
    ticker: t,
    items: data.map((e) => ({
      title: e.title,
      type: e.category ?? "news",
      date: String(e.published_at ?? e.created_at ?? "").slice(0, 10),
      url: e.url ?? null,
      summary: e.ai_summary ?? (typeof e.snippet === "string" ? e.snippet.slice(0, 240) : null),
      sentiment: e.sentiment ?? null,
      source: e.source ?? null,
    })),
  };
}

function articleTime(article: { published_at: string | null; created_at: string }): number {
  const t = new Date(article.published_at ?? article.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function getMarketCard(db: SupabaseClient): Promise<MarketCard | null> {
  const { data } = await db
    .from("market_snapshots")
    .select("snapshot_date, index_name, index_value, index_change_percent, total_advancers, total_decliners, top_sector, bottom_sector")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    date: data.snapshot_date as string,
    indexName: (data.index_name as string) ?? null,
    indexValue: num(data.index_value),
    indexChangePct: num(data.index_change_percent),
    advancers: data.total_advancers as number,
    decliners: data.total_decliners as number,
    topSector: (data.top_sector as string) ?? null,
    bottomSector: (data.bottom_sector as string) ?? null,
  };
}

export interface SectorCard {
  date: string;
  filter: string | null; // matched sector name when filtered to one
  sectors: {
    sector: string;
    avgReturn: number | null;
    advancers: number;
    decliners: number;
    stockCount: number;
    topGainer: string | null;
    topGainerPct: number | null;
    topLoser: string | null;
    topLoserPct: number | null;
    totalVolume: number;
  }[];
}

/**
 * Per-sector performance from the latest snapshot. Pass a query (e.g. "cement",
 * "banks") to fuzzy-match one sector; omit it for the full ranked list.
 */
export async function getSectorCard(db: SupabaseClient, sectorQuery?: string | null): Promise<SectorCard | null> {
  const { data: snap } = await db
    .from("market_snapshots")
    .select("id, snapshot_date")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap) return null;

  let q = db
    .from("sector_snapshots")
    .select("sector, average_return, advancers, decliners, stock_count, top_gainer, top_gainer_pct, top_loser, top_loser_pct, total_volume")
    .eq("snapshot_id", snap.id);
  if (sectorQuery) q = q.ilike("sector", `%${sectorQuery}%`);
  const { data } = await q;
  if (!data || data.length === 0) return null;

  const sectors = data
    .map((s) => ({
      sector: s.sector as string,
      avgReturn: num(s.average_return),
      advancers: (s.advancers as number) ?? 0,
      decliners: (s.decliners as number) ?? 0,
      stockCount: (s.stock_count as number) ?? 0,
      topGainer: (s.top_gainer as string) ?? null,
      topGainerPct: num(s.top_gainer_pct),
      topLoser: (s.top_loser as string) ?? null,
      topLoserPct: num(s.top_loser_pct),
      totalVolume: num(s.total_volume) ?? 0,
    }))
    .sort((a, b) => (b.avgReturn ?? 0) - (a.avgReturn ?? 0));

  return { date: snap.snapshot_date as string, filter: sectorQuery ?? null, sectors };
}

export interface HoldingsSummary {
  count: number;
  pricedCount: number;
  totalValue: number | null;
  totalCost: number;
  unrealizedPL: number | null;
  holdings: {
    ticker: string;
    sector: string | null;
    quantity: number;
    avgCost: number;
    marketValue: number | null;
    weightPct: number | null;
    changePct: number | null;
  }[];
  sectors: { sector: string; value: number; weightPct: number; count: number }[];
}

export async function getHoldingsSummary(db: SupabaseClient, userId: string): Promise<HoldingsSummary | null> {
  const { data: hs } = await db
    .from("holdings")
    .select("ticker, quantity, sector, avg_cost, total_cost")
    .eq("user_id", userId)
    .eq("hidden", false)
    .gt("quantity", 0);
  if (!hs || hs.length === 0) return null;

  const tickers = hs.map((h) => (h.ticker as string).toUpperCase());
  const [{ data: qs }, { data: uni }] = await Promise.all([
    db.from("market_quotes").select("ticker, price, day_change_pct").in("ticker", tickers),
    db.from("stock_universe").select("ticker, sector").in("ticker", tickers),
  ]);
  const priceMap = new Map((qs ?? []).map((q) => [(q.ticker as string).toUpperCase(), num(q.price)]));
  const chgMap = new Map((qs ?? []).map((q) => [(q.ticker as string).toUpperCase(), num(q.day_change_pct)]));
  const uniSector = new Map((uni ?? []).map((u) => [(u.ticker as string).toUpperCase(), (u.sector as string) ?? null]));

  let totalValue = 0;
  let totalCost = 0;
  let pricedCost = 0;
  let pricedCount = 0;

  const holdings = hs.map((h) => {
    const ticker = (h.ticker as string).toUpperCase();
    const quantity = Number(h.quantity);
    const avgCost = Number(h.avg_cost) || 0;
    const cost = Number(h.total_cost) || quantity * avgCost;
    totalCost += cost;
    const price = priceMap.get(ticker) ?? null;
    const marketValue = price != null ? price * quantity : null;
    if (marketValue != null) {
      totalValue += marketValue;
      pricedCost += cost;
      pricedCount++;
    }
    // Holdings.sector (from import) wins; fall back to the universe classification.
    const sector = ((h.sector as string) || uniSector.get(ticker) || null) as string | null;
    return { ticker, sector, quantity, avgCost, marketValue, changePct: chgMap.get(ticker) ?? null, cost };
  });

  const tv = totalValue > 0 ? totalValue : null;
  const withWeights = holdings.map((h) => ({
    ticker: h.ticker,
    sector: h.sector,
    quantity: h.quantity,
    avgCost: h.avgCost,
    marketValue: h.marketValue,
    weightPct: h.marketValue != null && tv ? (h.marketValue / tv) * 100 : null,
    changePct: h.changePct,
  }));

  const secMap = new Map<string, { value: number; count: number }>();
  for (const h of holdings) {
    const key = h.sector ?? "Unclassified";
    const e = secMap.get(key) ?? { value: 0, count: 0 };
    if (h.marketValue != null) e.value += h.marketValue;
    e.count++;
    secMap.set(key, e);
  }
  const sectors = [...secMap.entries()]
    .map(([sector, v]) => ({ sector, value: v.value, weightPct: tv ? (v.value / tv) * 100 : 0, count: v.count }))
    .sort((a, b) => b.value - a.value || b.count - a.count);

  return {
    count: tickers.length,
    pricedCount,
    totalValue: tv,
    totalCost,
    unrealizedPL: tv != null ? totalValue - pricedCost : null,
    holdings: withWeights,
    sectors,
  };
}

export interface ThesisRow {
  why_bought: string | null;
  expectation: string | null;
  time_horizon: string | null;
  key_risks: string | null;
  add_conditions: string | null;
  sell_conditions: string | null;
  confidence: number | null;
  status: string | null;
}
export interface JournalRow {
  entry_date: string | null;
  entry_type: string | null;
  title: string | null;
  body: string | null;
}
export interface DecisionNotes {
  thesis: ThesisRow | null;
  journal: JournalRow[];
}

/**
 * The user's own thesis and recent journal for a ticker — what they decided and
 * why. Injected into decision questions so the answer grounds in the user's
 * stated reasoning instead of generic commentary.
 */
export async function getDecisionNotes(db: SupabaseClient, userId: string, ticker: string): Promise<DecisionNotes> {
  const t = ticker.toUpperCase();
  const [thesisRes, journalRes] = await Promise.all([
    db
      .from("theses")
      .select("why_bought, expectation, time_horizon, key_risks, add_conditions, sell_conditions, confidence, status")
      .eq("user_id", userId)
      .eq("ticker", t)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("journal_entries")
      .select("entry_date, entry_type, title, body")
      .eq("user_id", userId)
      .eq("ticker", t)
      .order("entry_date", { ascending: false })
      .limit(3),
  ]);
  return {
    thesis: (thesisRes.data as ThesisRow | null) ?? null,
    journal: (journalRes.data as JournalRow[] | null) ?? [],
  };
}
