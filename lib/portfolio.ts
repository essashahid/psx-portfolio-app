import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EnrichedHolding,
  HiddenHolding,
  Holding,
  PortfolioSummary,
  Target,
  Thesis,
  TxnType,
} from "@/lib/types";

type PriceRow = { ticker: string; price: number; price_date: string; source: string };

/**
 * Loads everything needed to value the portfolio and enriches each holding with
 * latest price, market value, P/L, weight, targets and thesis status.
 * Works with zero prices configured (market fields stay null).
 */
export async function getPortfolio(
  supabase: SupabaseClient,
  userId: string
): Promise<PortfolioSummary> {
  const holdingsRes = await supabase
    .from("holdings")
    .select("*")
    .eq("user_id", userId)
    .gt("quantity", 0)
    .order("ticker");
  // Hidden positions stay in the ledger but drop out of every aggregate below;
  // they are surfaced separately so the holdings page can list and unhide them.
  const allHoldings = (holdingsRes.data ?? []) as Holding[];
  const holdings = allHoldings.filter((h) => !h.hidden);
  const hiddenHoldings: HiddenHolding[] = allHoldings
    .filter((h) => h.hidden)
    .map((h) => ({
      ticker: h.ticker,
      company_name: h.company_name,
      sector: h.sector,
      quantity: Number(h.quantity),
      avg_cost: Number(h.avg_cost),
      total_cost: Number(h.total_cost),
    }));
  const hiddenTickers = new Set(hiddenHoldings.map((h) => h.ticker));
  const tickers = [...new Set(holdings.map((h) => h.ticker))];

  const [pricesRes, targetsRes, thesesRes, divRes, realizedRes, cashRes] =
    await Promise.all([
      // Single round-trip for the latest price per ticker (see migration 0026).
      tickers.length
        ? supabase.rpc("latest_prices", { p_user_id: userId, p_tickers: tickers })
        : Promise.resolve({ data: [] as PriceRow[] }),
      supabase.from("targets").select("*").eq("user_id", userId),
      supabase.from("theses").select("*").eq("user_id", userId),
      supabase.from("dividends").select("ticker, amount, net_amount, status").eq("user_id", userId),
      supabase.from("transactions").select("ticker, type, net_amount, realized_pl").eq("user_id", userId),
      supabase.from("cash_movements").select("type, amount").eq("user_id", userId),
    ]);

  // latest_prices returns exactly one row per ticker (newest first via DISTINCT ON)
  const latestPrice = new Map<string, { price: number; price_date: string; source: string }>();
  for (const p of (pricesRes.data ?? []) as PriceRow[]) {
    latestPrice.set(p.ticker, { price: Number(p.price), price_date: p.price_date, source: p.source });
  }

  const targetByTicker = new Map<string, Target>();
  for (const t of (targetsRes.data ?? []) as Target[]) targetByTicker.set(t.ticker, t);

  const thesisByTicker = new Map<string, Thesis>();
  for (const t of (thesesRes.data ?? []) as Thesis[]) thesisByTicker.set(t.ticker, t);

  const dividendByTicker = new Map<string, number>();
  let dividendIncome = 0;
  let expectedDividendIncome = 0;
  let pendingDividendIncome = 0;
  let pendingDividends = 0;
  for (const d of divRes.data ?? []) {
    if (d.ticker && hiddenTickers.has(d.ticker)) continue;
    const amt = Number(d.net_amount ?? d.amount ?? 0);
    const status = d.status ?? "received";
    if (status === "received") {
      dividendIncome += amt;
      if (d.ticker) dividendByTicker.set(d.ticker, (dividendByTicker.get(d.ticker) ?? 0) + amt);
    } else if (status === "announced" || status === "expected") {
      expectedDividendIncome += amt;
      pendingDividendIncome += amt;
      pendingDividends++;
    } else if (status === "missing") {
      pendingDividends++;
    }
  }

  // Realized P/L excludes hidden tickers (it is an analysis figure); the cash
  // ledger below keeps every row because cash movements are real either way.
  const realizedPl = (realizedRes.data ?? [])
    .filter((r) => !r.ticker || !hiddenTickers.has(r.ticker))
    .reduce((s, r) => s + Number(r.realized_pl ?? 0), 0);

  // Broker cash on hand, derived from the full ledger so it always reconciles:
  // deposits and sale proceeds add, buys, withdrawals, fees and CGT subtract.
  let cashBalance = 0;
  for (const c of cashRes.data ?? []) {
    const amt = Number(c.amount ?? 0);
    if (c.type === "CASH_IN" || c.type === "DIVIDEND") cashBalance += Math.abs(amt);
    else if (c.type === "CASH_OUT" || c.type === "FEE" || c.type === "TAX") cashBalance -= Math.abs(amt);
    else cashBalance += amt;
  }
  for (const t of realizedRes.data ?? []) {
    const net = Math.abs(Number(t.net_amount ?? 0));
    if (t.type === "SELL") cashBalance += net;
    else if (t.type === "BUY" || t.type === "RIGHT") cashBalance -= net;
  }

  // First pass: market values
  let totalValue = 0;
  let totalCost = 0;
  const prelim = holdings.map((h) => {
    const quantity = Number(h.quantity);
    const avgCost = Number(h.avg_cost);
    const cost = Number(h.total_cost) || quantity * avgCost;
    const lp = latestPrice.get(h.ticker) ?? null;
    const marketValue = lp ? quantity * lp.price : null;
    totalCost += cost;
    totalValue += marketValue ?? cost; // unpriced holdings fall back to cost for weight math
    return { h, quantity, avgCost, cost, lp, marketValue };
  });

  const enriched: EnrichedHolding[] = prelim.map(({ h, quantity, avgCost, cost, lp, marketValue }) => {
    const target = targetByTicker.get(h.ticker);
    const thesis = thesisByTicker.get(h.ticker);
    const effectiveValue = marketValue ?? cost;
    const unrealizedPl = marketValue !== null ? marketValue - cost : null;
    const distance =
      lp && target?.target_price
        ? ((Number(target.target_price) - lp.price) / lp.price) * 100
        : null;
    return {
      ...h,
      quantity,
      avg_cost: avgCost,
      total_cost: cost,
      latest_price: lp?.price ?? null,
      price_date: lp?.price_date ?? null,
      price_source: lp?.source ?? null,
      market_value: marketValue,
      unrealized_pl: unrealizedPl,
      unrealized_pl_pct: unrealizedPl !== null && cost > 0 ? (unrealizedPl / cost) * 100 : null,
      weight: totalValue > 0 ? (effectiveValue / totalValue) * 100 : null,
      target_price: target?.target_price !== undefined && target?.target_price !== null ? Number(target.target_price) : null,
      target_allocation: target?.target_allocation !== undefined && target?.target_allocation !== null ? Number(target.target_allocation) : null,
      review_level: target?.review_level !== undefined && target?.review_level !== null ? Number(target.review_level) : null,
      distance_to_target_pct: distance,
      dividend_income: dividendByTicker.get(h.ticker) ?? 0,
      thesis_status: thesis?.status ?? null,
      thesis_confidence: thesis?.confidence ?? null,
      review_date: thesis?.review_date ?? null,
      has_thesis: !!thesis?.why_bought,
    };
  });

  const unrealizedPl = enriched.reduce((s, h) => s + (h.unrealized_pl ?? 0), 0);
  const pricedCost = enriched.filter((h) => h.market_value !== null).reduce((s, h) => s + h.total_cost, 0);

  // sector weights
  const sectorMap = new Map<string, number>();
  for (const h of enriched) {
    const sector = h.sector || "Uncategorized";
    sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + (h.market_value ?? h.total_cost));
  }
  const sectorWeights = [...sectorMap.entries()]
    .map(([sector, value]) => ({
      sector,
      value,
      weight: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  const largestHolding =
    enriched.length > 0
      ? [...enriched].sort((a, b) => (b.market_value ?? b.total_cost) - (a.market_value ?? a.total_cost))[0]
      : null;

  return {
    holdings: enriched,
    totalValue,
    totalCost,
    unrealizedPl,
    unrealizedPlPct: pricedCost > 0 ? (unrealizedPl / pricedCost) * 100 : null,
    realizedPl,
    dividendIncome,
    expectedDividendIncome,
    pendingDividendIncome,
    pendingDividends,
    cashBalance,
    holdingsCount: enriched.length,
    largestHolding,
    sectorWeights,
    largestSector: sectorWeights[0]
      ? { sector: sectorWeights[0].sector, weight: sectorWeights[0].weight }
      : null,
    pricedHoldings: enriched.filter((h) => h.latest_price !== null).length,
    hiddenHoldings,
  };
}

interface TxnLike {
  ticker: string;
  trade_date: string | null;
  type: TxnType;
  quantity: number | null;
  price: number | null;
  gross_amount: number | null;
  commission: number | null;
  tax: number | null;
  net_amount: number | null;
}

export interface RebuildResult {
  positions: Map<
    string,
    { quantity: number; avgCost: number; totalCost: number; realizedPl: number }
  >;
  realizedByTxn: number[]; // realized P/L aligned with input order after sorting — see rebuildHoldings
}

/**
 * Weighted-average cost rebuild from a transaction list.
 * BUY: cost in = net_amount if present else qty*price + commission + tax.
 * SELL: proceeds = net_amount if present else qty*price - commission - tax;
 *       realized P/L = proceeds - avgCost*qty.
 * BONUS adds shares at zero cost; RIGHT adds at paid cost; SPLIT multiplies share count.
 */
export function rebuildHoldings(transactions: TxnLike[]): RebuildResult {
  const sorted = [...transactions].sort((a, b) =>
    (a.trade_date ?? "9999").localeCompare(b.trade_date ?? "9999")
  );
  const positions = new Map<
    string,
    { quantity: number; avgCost: number; totalCost: number; realizedPl: number }
  >();
  const realizedByTxn: number[] = [];

  for (const t of sorted) {
    const pos =
      positions.get(t.ticker) ?? { quantity: 0, avgCost: 0, totalCost: 0, realizedPl: 0 };
    const qty = Math.abs(Number(t.quantity ?? 0));
    const price = Number(t.price ?? 0);
    let realized: number | null = null;

    switch (t.type) {
      case "BUY":
      case "RIGHT": {
        const costIn =
          t.net_amount !== null && t.net_amount !== undefined && Number(t.net_amount) > 0
            ? Number(t.net_amount)
            : qty * price + Number(t.commission ?? 0) + Number(t.tax ?? 0);
        pos.totalCost += costIn;
        pos.quantity += qty;
        pos.avgCost = pos.quantity > 0 ? pos.totalCost / pos.quantity : 0;
        break;
      }
      case "BONUS": {
        pos.quantity += qty;
        pos.avgCost = pos.quantity > 0 ? pos.totalCost / pos.quantity : 0;
        break;
      }
      case "ADJUST": {
        // Manual reconciliation entry from a holdings edit. Quantity is signed:
        // positive adds shares at the given price/cost, negative removes at
        // weighted-average cost. No realized P/L (it is a correction, not a sale).
        const delta = Number(t.quantity ?? 0);
        if (delta > 0) {
          const costIn =
            t.net_amount !== null && t.net_amount !== undefined && Number(t.net_amount) > 0
              ? Number(t.net_amount)
              : delta * price;
          pos.totalCost += costIn;
          pos.quantity += delta;
        } else if (delta < 0) {
          const removeQty = Math.min(Math.abs(delta), pos.quantity);
          pos.totalCost -= pos.avgCost * removeQty;
          pos.quantity -= removeQty;
        } else if (price > 0 && pos.quantity > 0) {
          pos.totalCost = pos.quantity * price;
        }
        if (pos.quantity <= 0) {
          pos.quantity = 0;
          pos.totalCost = 0;
          pos.avgCost = 0;
        } else {
          pos.avgCost = pos.totalCost / pos.quantity;
        }
        break;
      }
      case "SELL": {
        const sellQty = Math.min(qty, pos.quantity);
        const proceeds =
          t.net_amount !== null && t.net_amount !== undefined && Number(t.net_amount) > 0
            ? Number(t.net_amount)
            : qty * price - Number(t.commission ?? 0) - Number(t.tax ?? 0);
        const costOut = pos.avgCost * sellQty;
        realized = proceeds - costOut;
        pos.realizedPl += realized;
        pos.quantity -= sellQty;
        pos.totalCost -= costOut;
        if (pos.quantity <= 0) {
          pos.quantity = 0;
          pos.totalCost = 0;
          pos.avgCost = 0;
        }
        break;
      }
      case "SPLIT": {
        // quantity column carries the split factor (e.g. 2 for 1:2)
        const factor = qty || 1;
        if (factor > 0 && pos.quantity > 0) {
          pos.quantity = pos.quantity * factor;
          pos.avgCost = pos.totalCost / pos.quantity;
        }
        break;
      }
      default:
        break; // DIVIDEND / CASH / FEE / TAX / UNKNOWN don't move the position
    }
    positions.set(t.ticker, pos);
    realizedByTxn.push(realized ?? 0);
  }

  return { positions, realizedByTxn };
}

/** Re-derives holdings rows from all stored transactions for a user and upserts them. */
export async function recomputeHoldingsFromTransactions(
  supabase: SupabaseClient,
  userId: string
) {
  const { data: txns, error } = await supabase
    .from("transactions")
    .select("id, ticker, trade_date, type, quantity, price, gross_amount, commission, tax, net_amount")
    .eq("user_id", userId)
    .order("trade_date", { ascending: true });
  if (error) throw error;

  const ordered = txns ?? [];
  const { positions, realizedByTxn } = rebuildHoldings(
    ordered.map((t) => ({
      ...t,
      type: t.type as TxnType,
      quantity: t.quantity !== null ? Number(t.quantity) : null,
      price: t.price !== null ? Number(t.price) : null,
      gross_amount: t.gross_amount !== null ? Number(t.gross_amount) : null,
      commission: t.commission !== null ? Number(t.commission) : null,
      tax: t.tax !== null ? Number(t.tax) : null,
      net_amount: t.net_amount !== null ? Number(t.net_amount) : null,
    }))
  );

  // Persist realized P/L on SELL rows in parallel.
  // Input is already date-ordered and rebuildHoldings uses a stable sort,
  // so realizedByTxn aligns with `ordered`.
  await Promise.all(
    ordered
      .map((t, i) => ({ t, realized: realizedByTxn[i] }))
      .filter(({ t }) => t.type === "SELL")
      .map(({ t, realized }) =>
        supabase
          .from("transactions")
          .update({ realized_pl: realized })
          .eq("id", t.id)
          .eq("user_id", userId)
      )
  );

  // enrich names/sectors from stock_master
  const tickers = [...positions.keys()];
  const { data: master } = tickers.length
    ? await supabase.from("stock_master").select("ticker, company_name, sector").in("ticker", tickers)
    : { data: [] };
  const masterMap = new Map((master ?? []).map((m) => [m.ticker, m]));

  await Promise.all(
    [...positions.entries()].map(([ticker, pos]) => {
      const m = masterMap.get(ticker);
      if (pos.quantity > 0) {
        return supabase.from("holdings").upsert(
          {
            user_id: userId,
            ticker,
            company_name: m?.company_name ?? null,
            sector: m?.sector ?? null,
            quantity: pos.quantity,
            avg_cost: pos.avgCost,
            total_cost: pos.totalCost,
            source: "transactions",
            last_updated: new Date().toISOString(),
          },
          { onConflict: "user_id,ticker" }
        );
      } else {
        return supabase.from("holdings").delete().eq("user_id", userId).eq("ticker", ticker);
      }
    })
  );
}

/** Persists today's portfolio snapshot (used for the value-over-time chart). */
export async function takeSnapshot(supabase: SupabaseClient, userId: string) {
  const summary = await getPortfolio(supabase, userId);
  if (summary.holdingsCount === 0) return null;
  const { error } = await supabase.from("portfolio_snapshots").upsert(
    {
      user_id: userId,
      snapshot_date: new Date().toISOString().slice(0, 10),
      total_value: summary.totalValue,
      total_cost: summary.totalCost,
      unrealized_pl: summary.unrealizedPl,
      data: {
        holdings: summary.holdings.map((h) => ({
          ticker: h.ticker,
          quantity: h.quantity,
          value: h.market_value ?? h.total_cost,
        })),
      },
    },
    { onConflict: "user_id,snapshot_date" }
  );
  if (error) throw error;
  return summary;
}
