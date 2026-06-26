import type { SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseAkdStatement } from "@/lib/import/akd-statement";
import {
  analyzeLedger,
  xirr,
  type LedgerAnalytics,
  type CostBasisRow,
  type ReturnsSummary,
  type FrictionSummary,
  type YearRow,
  type DeploymentSummary,
  type ConcentrationSummary,
  type QuantityReconciliationRow,
  type TimelinePoint,
  type BenchmarkSeriesPoint,
  type BenchmarkSummary,
  type PositionBuildRow,
  type RealizedSale,
} from "@/lib/engine/ledger-analytics";
import { summarizeBenchmarkSeries } from "@/lib/engine/benchmark-growth";

// Build the dated capital/net-worth timeline directly from stored transactions
// and cash movements. Mirrors the shape produced by the PDF path's buildTimeline
// so the chart on /performance renders identically regardless of data source.
// Only dated events are placed; the terminal net worth is attached to the last point.
type DbTimelineTxn = {
  trade_date: string | null;
  type: string;
  quantity: number;
  price: number;
  net_amount: number;
  ticker: string;
};
type DbTimelineCash = {
  movement_date: string | null;
  type: string;
  amount: number;
};
function buildDbTimeline(
  txns: DbTimelineTxn[],
  cashRows: DbTimelineCash[],
  terminalNetWorth: number,
  round2: (n: number) => number
): TimelinePoint[] {
  type Dated =
    | { date: string; kind: "txn"; txn: DbTimelineTxn }
    | { date: string; kind: "cash"; cash: DbTimelineCash };
  const dated: Dated[] = [];
  for (const txn of txns) {
    if (txn.trade_date) dated.push({ date: txn.trade_date, kind: "txn", txn });
  }
  for (const cash of cashRows) {
    if (cash.movement_date) dated.push({ date: cash.movement_date, kind: "cash", cash });
  }
  dated.sort((a, b) => a.date.localeCompare(b.date));

  const byDate = new Map<string, Dated[]>();
  for (const row of dated) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  const dates = [...byDate.keys()].sort();

  let cumulativeContributions = 0;
  let grossPurchases = 0;
  let grossSales = 0;
  let charges = 0;
  let cashBalance = 0;
  const points: TimelinePoint[] = [];

  dates.forEach((date, index) => {
    const day = byDate.get(date) ?? [];
    const labels: string[] = [];
    for (const row of day) {
      if (row.kind === "txn") {
        const t = row.txn;
        const gross = t.quantity * t.price;
        if (t.type === "SELL") {
          grossSales += gross;
          cashBalance += t.net_amount;
          labels.push(`${t.ticker} sale`);
        } else {
          // BUY, RIGHT and any other acquisition type
          grossPurchases += gross;
          cashBalance -= t.net_amount;
        }
      } else {
        const c = row.cash;
        const amt = Math.abs(Number(c.amount ?? 0));
        if (c.type === "CASH_IN") {
          cumulativeContributions += amt;
          cashBalance += amt;
        } else if (c.type === "DIVIDEND") {
          cashBalance += amt;
        } else if (c.type === "CASH_OUT") {
          cashBalance -= amt;
        } else if (c.type === "FEE" || c.type === "TAX") {
          charges += amt;
          cashBalance -= amt;
        } else {
          cashBalance += Number(c.amount ?? 0);
        }
      }
    }
    points.push({
      date,
      cumulativeContributions: round2(cumulativeContributions),
      grossPurchases: round2(grossPurchases),
      grossSales: round2(grossSales),
      charges: round2(charges),
      cashBalance: round2(cashBalance),
      netWorth: index === dates.length - 1 ? round2(terminalNetWorth) : null,
      eventLabels: labels,
    });
  });
  return points;
}

// Reconstruct per-ticker acquisition history from stored transactions so the
// position build-up table shows real first/latest dates, purchase counts,
// price ranges, sold quantity and quantity-weighted holding age instead of the
// placeholder zeros the DB path used to emit.
type DbPositionHolding = {
  ticker: string;
  quantity: number;
  avgCost: number;
  totalInvested: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
};
type DbPositionTxn = {
  ticker: string;
  trade_date: string | null;
  type: string;
  quantity: number;
  price: number;
};
function buildDbPositionBuild(
  holdings: DbPositionHolding[],
  txns: DbPositionTxn[],
  round2: (n: number) => number,
  today: string
): PositionBuildRow[] {
  const byTicker = new Map<string, DbPositionTxn[]>();
  for (const t of txns) byTicker.set(t.ticker, [...(byTicker.get(t.ticker) ?? []), t]);
  const DAY_MS = 86_400_000;
  const todayMs = Date.parse(today);

  return holdings.map((h) => {
    const rows = byTicker.get(h.ticker) ?? [];
    const buys = rows.filter((t) => t.type === "BUY" || t.type === "RIGHT");
    const sells = rows.filter((t) => t.type === "SELL");
    const buyDates = buys
      .map((t) => t.trade_date)
      .filter((d): d is string => !!d)
      .sort((a, b) => a.localeCompare(b));
    const buyPrices = buys.map((t) => t.price).filter((p) => p > 0);
    const totalQuantityAcquired = round2(buys.reduce((s, t) => s + t.quantity, 0));
    const quantitySold = round2(sells.reduce((s, t) => s + t.quantity, 0));
    // Whatever the current book quantity has beyond buys minus sells must have
    // come from splits, mergers, bonus issues or IPO allotments.
    const corporateActionQuantity = round2(h.quantity - (totalQuantityAcquired - quantitySold));

    // Quantity-weighted average age of the buy lots, in days to today.
    let ageWeighted = 0;
    let ageQty = 0;
    for (const b of buys) {
      if (!b.trade_date || b.quantity <= 0) continue;
      const ageDays = (todayMs - Date.parse(b.trade_date)) / DAY_MS;
      if (!Number.isFinite(ageDays)) continue;
      ageWeighted += ageDays * b.quantity;
      ageQty += b.quantity;
    }
    const averageHoldingAgeDays = ageQty > 0 ? Math.round(ageWeighted / ageQty) : null;

    return {
      ticker: h.ticker,
      firstAcquisitionDate: buyDates[0] ?? null,
      latestAcquisitionDate: buyDates[buyDates.length - 1] ?? null,
      purchaseCount: buys.length,
      totalQuantityAcquired,
      quantitySold,
      corporateActionQuantity,
      currentQuantity: h.quantity,
      lowestPurchasePrice: buyPrices.length ? round2(Math.min(...buyPrices)) : null,
      highestPurchasePrice: buyPrices.length ? round2(Math.max(...buyPrices)) : null,
      weightedAverageCost: h.avgCost,
      currentPrice: h.currentPrice,
      averageHoldingAgeDays,
      amountInvested: h.totalInvested,
      currentValue: h.marketValue,
      unrealizedPl: h.unrealizedPl,
    } satisfies PositionBuildRow;
  });
}

// Turn each stored sell transaction into a realised-sale line. Cost allocated is
// backed out of the stored realised P/L (proceeds − realised), and the holding
// status comes from whether any shares of that ticker remain on the books. The
// average holding age is derived from the ticker's earliest buy before the sale.
type DbSaleTxn = {
  ticker: string;
  trade_date: string | null;
  type: string;
  quantity: number;
  price: number;
  commission: number;
  tax: number;
  net_amount: number;
  realized_pl: number | null;
};
function buildDbSales(
  txns: DbSaleTxn[],
  currentQtyByTicker: Map<string, number>,
  round2: (n: number) => number
): RealizedSale[] {
  const DAY_MS = 86_400_000;
  // Earliest dated buy per ticker, for a holding-age estimate.
  const firstBuyDate = new Map<string, string>();
  for (const t of txns) {
    if (t.type !== "BUY" && t.type !== "RIGHT") continue;
    if (!t.trade_date) continue;
    const current = firstBuyDate.get(t.ticker);
    if (!current || t.trade_date < current) firstBuyDate.set(t.ticker, t.trade_date);
  }

  return txns
    .filter((t) => t.type === "SELL")
    .sort((a, b) => (a.trade_date ?? "").localeCompare(b.trade_date ?? ""))
    .map((t) => {
      const grossProceeds = round2(t.quantity * t.price);
      const saleFees = round2(t.commission + t.tax);
      const proceeds = round2(t.net_amount);
      const realized = round2(t.realized_pl ?? 0);
      const costOut = round2(proceeds - realized);
      const remainingQuantity = round2(currentQtyByTicker.get(t.ticker) ?? 0);
      const firstBuy = firstBuyDate.get(t.ticker);
      const averageHoldingDays =
        firstBuy && t.trade_date
          ? Math.max(0, Math.round((Date.parse(t.trade_date) - Date.parse(firstBuy)) / DAY_MS))
          : null;
      return {
        date: t.trade_date,
        ticker: t.ticker,
        quantity: round2(t.quantity),
        grossProceeds,
        saleFees,
        proceeds,
        costOut,
        realized,
        realizedReturnPct: costOut > 0 ? round2((realized / costOut) * 100) : null,
        averageHoldingDays,
        remainingQuantity,
        status: remainingQuantity > 0.0001 ? "Partially realised" : "Closed",
        brokerOrderNo: null,
        sourceEntryNos: [`${t.ticker} ${t.trade_date ?? "undated"}`],
        formula: `Net proceeds ${proceeds.toLocaleString("en-PK")} less weighted-average cost ${costOut.toLocaleString("en-PK")} = realised ${realized.toLocaleString("en-PK")}`,
      } satisfies RealizedSale;
    });
}

async function analyzePdfBuffer(
  buffer: Buffer,
  source: LedgerAnalytics["source"]
): Promise<LedgerAnalytics | null> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();

  const stmt = parseAkdStatement(result.text ?? "");
  if (!stmt) return null;
  return analyzeLedger(stmt, {
    includeConfirmedAdjustments: true,
    source,
  });
}

// Try to download the most recent committed AKD PDF from Storage and parse it.
async function getPdfAnalytics(
  supabase: SupabaseClient,
  userId: string
): Promise<LedgerAnalytics | null> {
  const { data: stmts } = await supabase
    .from("uploaded_statements")
    .select("storage_path")
    .eq("user_id", userId)
    .eq("status", "committed")
    .eq("file_type", "pdf")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!stmts?.length) return null;

  for (const row of stmts) {
    if (!row.storage_path) continue;
    try {
      const { data: blob, error } = await supabase.storage
        .from("statements")
        .download(row.storage_path as string);
      if (error || !blob) continue;

      const buffer = Buffer.from(await blob.arrayBuffer());
      const analytics = await analyzePdfBuffer(buffer, {
        type: "akd_statement",
        label: "Committed AKD PDF",
        status: "complete",
        detail: "Parsed from Supabase Storage and validated against the AKD statement controls.",
      });
      if (analytics) return analytics;
    } catch {
      continue;
    }
  }
  return null;
}

async function getLocalPdfAnalytics(): Promise<LedgerAnalytics | null> {
  const candidates = [
    process.env.AKD_LEDGER_PDF_PATH,
    path.join(process.cwd(), "COAF5632.PDF"),
  ].filter((p): p is string => !!p);

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const analytics = await analyzePdfBuffer(readFileSync(candidate), {
        type: "local_akd_pdf",
        label: path.basename(candidate),
        status: "complete",
        detail:
          "Parsed from the local canonical AKD PDF in this workspace because no committed Supabase copy was available.",
      });
      if (analytics) return analytics;
    } catch {
      continue;
    }
  }
  return null;
}

// Compute analytics purely from the database (transactions, holdings, prices,
// cash_movements). Used when the AKD PDF is not in storage. The holdings table
// already has the weighted-average cost from the last rebuild, so we don't
// need to replay all trades here.
async function getDbAnalytics(
  supabase: SupabaseClient,
  userId: string
): Promise<LedgerAnalytics | null> {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const formatCount = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 0 });
  const SELL_COST_RATE = 0.0018;
  const CGT_RATE = 0.15;

  const [txnsRes, holdingsRes, pricesRes, cashRes, checkpointRes, benchmarkRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("ticker, trade_date, type, quantity, price, commission, tax, net_amount, realized_pl, notes")
      .eq("user_id", userId)
      .order("trade_date", { ascending: true }),
    supabase
      .from("holdings")
      .select("ticker, sector, quantity, avg_cost, total_cost")
      .eq("user_id", userId)
      .gt("quantity", 0),
    supabase
      .from("prices")
      .select("ticker, price, price_date")
      .eq("user_id", userId)
      .order("price_date", { ascending: false })
      .limit(500),
    supabase
      .from("cash_movements")
      .select("movement_date, type, amount")
      .eq("user_id", userId)
      .order("movement_date", { ascending: true }),
    supabase
      .from("reconciliation_checkpoints")
      .select("as_of, source, data")
      .eq("user_id", userId)
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("benchmark_series")
      .select("point_date, contributed, portfolio, kse100, inflation, cpi")
      .eq("user_id", userId)
      .order("point_date", { ascending: true }),
  ]);

  const txns = (txnsRes.data ?? []).map((t) => ({
    ticker: t.ticker as string,
    trade_date: t.trade_date as string | null,
    type: t.type as string,
    quantity: Number(t.quantity),
    price: Number(t.price),
    commission: Number(t.commission ?? 0),
    tax: Number(t.tax ?? 0),
    net_amount: Number(t.net_amount ?? 0),
    realized_pl: t.realized_pl !== null ? Number(t.realized_pl) : null,
    notes: (t.notes as string | null) ?? null,
  }));

  const holdings = (holdingsRes.data ?? []).map((h) => ({
    ticker: h.ticker as string,
    sector: (h.sector as string | null) ?? "Other",
    quantity: Number(h.quantity),
    avg_cost: Number(h.avg_cost),
    total_cost: Number(h.total_cost),
  }));

  const cashRows = cashRes.data ?? [];
  const cashIn = cashRows.filter((c) => c.type === "CASH_IN");

  if (txns.length === 0 && holdings.length === 0) return null;

  // Latest price per ticker (rows already ordered newest first)
  const latestPrice = new Map<string, number>();
  for (const p of pricesRes.data ?? []) {
    if (!latestPrice.has(p.ticker as string)) {
      latestPrice.set(p.ticker as string, Number(p.price));
    }
  }

  // ── Cost basis from holdings WAC ──────────────────────────────────────────
  const totalMarketValue = holdings.reduce((s, h) => {
    const p = latestPrice.get(h.ticker);
    return s + (p !== undefined ? h.quantity * p : h.total_cost);
  }, 0);

  const costBasis: CostBasisRow[] = holdings
    .map((h) => {
      const currentPrice = latestPrice.get(h.ticker) ?? null;
      const marketValue = currentPrice !== null ? round2(h.quantity * currentPrice) : null;
      const unrealizedPl =
        marketValue !== null ? round2(marketValue - h.total_cost) : null;
      const breakEvenPrice =
        h.avg_cost > 0 ? round2(h.avg_cost / (1 - SELL_COST_RATE)) : null;
      let profitIfSoldToday: number | null = null;
      if (marketValue !== null) {
        const proceeds = marketValue * (1 - SELL_COST_RATE);
        const gain = proceeds - h.total_cost;
        profitIfSoldToday = round2(
          proceeds - h.total_cost - (gain > 0 ? gain * CGT_RATE : 0)
        );
      }
      const weightPct =
        totalMarketValue > 0 && marketValue !== null
          ? round2((marketValue / totalMarketValue) * 100)
          : null;
      return {
        ticker: h.ticker,
        sector: h.sector,
        quantity: h.quantity,
        avgCost: h.avg_cost,
        totalInvested: h.total_cost,
        currentPrice,
        marketValue,
        unrealizedPl,
        unrealizedPlPct:
          unrealizedPl !== null && h.total_cost > 0
            ? round2((unrealizedPl / h.total_cost) * 100)
            : null,
        breakEvenPrice,
        profitIfSoldToday,
        weightPct,
      };
    })
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  // ── Aggregates ────────────────────────────────────────────────────────────
  const buys = txns.filter((t) => t.type === "BUY" || t.type === "RIGHT");
  const sells = txns.filter((t) => t.type === "SELL");
  const totalBuys = round2(buys.reduce((s, t) => s + t.net_amount, 0));
  const totalSells = round2(sells.reduce((s, t) => s + t.net_amount, 0));
  const realizedPl = round2(
    sells
      .filter((t) => t.realized_pl !== null)
      .reduce((s, t) => s + (t.realized_pl ?? 0), 0)
  );
  const unrealizedPl = round2(costBasis.reduce((s, r) => s + (r.unrealizedPl ?? 0), 0));
  const marketValue = round2(totalMarketValue);
  const commission = round2(txns.reduce((s, t) => s + t.commission, 0));
  const taxTotal = round2(txns.reduce((s, t) => s + t.tax, 0));
  const totalFriction = round2(commission + taxTotal);

  // Proxy for totalDeposited when cash_movements is empty.
  // The holdings table already has the WAC-based total cost for every open position
  // (rebuilt from transactions at import time), so it's a much more accurate floor
  // than totalBuys–totalSells when the transactions table only has a handful of
  // manual corrections but the full history lives in holdings.
  const holdingsTotalCost = round2(holdings.reduce((s, h) => s + h.total_cost, 0));
  const totalDeposited =
    cashIn.length > 0
      ? round2(cashIn.reduce((s, c) => s + Number(c.amount), 0))
      : round2(Math.max(totalBuys - totalSells, holdingsTotalCost));

  const cashMovementEffect = cashRows.reduce((s, c) => {
    const amt = Math.abs(Number(c.amount ?? 0));
    if (c.type === "CASH_IN" || c.type === "DIVIDEND") return s + amt;
    if (c.type === "CASH_OUT" || c.type === "FEE" || c.type === "TAX") return s - amt;
    return s + Number(c.amount ?? 0);
  }, 0);
  const cashBalance = round2(cashMovementEffect + totalSells - totalBuys);
  const netWorth = round2(marketValue + cashBalance);
  const totalGain = round2(netWorth - totalDeposited);

  // ── Dates ─────────────────────────────────────────────────────────────────
  const firstTxnDate = txns[0]?.trade_date ?? null;
  const lastTxnDate = txns[txns.length - 1]?.trade_date ?? null;
  const holdingPeriodYears =
    firstTxnDate && lastTxnDate
      ? round2(
          (Date.parse(lastTxnDate) - Date.parse(firstTxnDate)) / (365 * 86_400_000)
        )
      : 0;

  let xirrPct: number | null = null;
  if (cashIn.length >= 1 && lastTxnDate) {
    const flows = [
      ...cashIn.map((c) => ({
        date: (c.movement_date as string | null) ?? lastTxnDate,
        amount: -Number(c.amount),
      })),
      { date: lastTxnDate, amount: netWorth },
    ];
    xirrPct = xirr(flows);
  }

  const returns: ReturnsSummary = {
    totalDeposited,
    netWorth,
    marketValue,
    cashBalance,
    totalGain,
    totalReturnPct:
      totalDeposited > 0 ? round2((totalGain / totalDeposited) * 100) : 0,
    xirrPct,
    holdingPeriodYears,
    realizedPl,
    unrealizedPl,
    totalFriction,
    startDate: firstTxnDate,
    endDate: lastTxnDate,
    externalCashFlowEvents: cashIn.length,
    endingValue: netWorth,
    dividendTreatment:
      "Database fallback uses stored cash movements only; import the full AKD statement for authoritative dividend and cash-flow treatment.",
    manualAdjustmentsUsed: [],
    xirrStatus: xirrPct === null ? "unavailable" : "calculated",
    xirrFailureReason:
      xirrPct === null
        ? "Database fallback lacks enough dated external cash flows or a full ending value."
        : null,
    cashflows:
      cashIn.length >= 1 && lastTxnDate
        ? [
            ...cashIn.map((c) => ({
              date: (c.movement_date as string | null) ?? lastTxnDate,
              amount: -Number(c.amount),
              label: "Stored cash movement",
              source: "cash_movements",
            })),
            { date: lastTxnDate, amount: netWorth, label: "Ending value", source: "database" },
          ]
        : [],
  };

  // ── Friction ──────────────────────────────────────────────────────────────
  const perTickerMap = new Map<string, { fees: number; trades: number }>();
  for (const t of txns) {
    const fees = t.commission + t.tax;
    const e = perTickerMap.get(t.ticker) ?? { fees: 0, trades: 0 };
    e.fees += fees;
    e.trades += 1;
    perTickerMap.set(t.ticker, e);
  }
  const grossProfit = realizedPl + unrealizedPl;
  const bySizeBuckets = [
    { bucket: "< 5,000", min: 0, max: 5000 },
    { bucket: "5,000–20,000", min: 5000, max: 20000 },
    { bucket: "20,000–50,000", min: 20000, max: 50000 },
    { bucket: "> 50,000", min: 50000, max: Infinity },
  ];
  const bySize = bySizeBuckets
    .map((b) => {
      const bucket = txns.filter((t) => {
        const gross = t.quantity * t.price;
        return gross >= b.min && gross < b.max;
      });
      if (!bucket.length) return null;
      const grossTradedValue = round2(
        bucket.reduce((s, t) => s + t.quantity * t.price, 0)
      );
      const totalFees = round2(
        bucket.reduce((s, t) => s + t.commission + t.tax, 0)
      );
      const avgGross = round2(
        bucket.reduce((s, t) => s + t.quantity * t.price, 0) / bucket.length
      );
      const avgFeePct = round2(
        (bucket.reduce((s, t) => {
          const g = t.quantity * t.price;
          return s + (g > 0 ? (t.commission + t.tax) / g : 0);
        }, 0) /
          bucket.length) *
          100
      );
      return { bucket: b.bucket, trades: bucket.length, grossTradedValue, avgGross, totalFees, avgFeePct };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);
  const grossTradedValue = round2(txns.reduce((s, t) => s + t.quantity * t.price, 0));

  const friction: FrictionSummary = {
    commission,
    sst: round2(taxTotal * 0.85),
    cdc: round2(taxTotal * 0.15),
    tradeFeesTotal: totalFriction,
    cgt: 0,
    accountFees: 0,
    unknownManualTradeFees: 0,
    total: totalFriction,
    pctOfDeposits:
      totalDeposited > 0 ? round2((totalFriction / totalDeposited) * 100) : 0,
    pctOfGains: grossProfit > 0 ? round2((totalFriction / grossProfit) * 100) : null,
    grossTradedValue,
    averageFeePerOrder: txns.length ? round2(totalFriction / txns.length) : null,
    feePctGrossTraded: grossTradedValue > 0 ? round2((totalFriction / grossTradedValue) * 100) : null,
    perTicker: [...perTickerMap.entries()]
      .map(([ticker, v]) => ({ ticker, fees: round2(v.fees), trades: v.trades }))
      .sort((a, b) => b.fees - a.fees),
    bySize,
    byCategory: [
      { category: "Commission", amount: commission, note: "Database transaction field" },
      { category: "Tax/fees", amount: taxTotal, note: "Database transaction tax field" },
    ],
    highestCostOrders: txns
      .map((t) => {
        const gross = t.quantity * t.price;
        const fees = t.commission + t.tax;
        return {
          date: t.trade_date,
          orderNo: `${t.ticker}-${t.trade_date ?? "undated"}`,
          side: t.type === "SELL" ? "SELL" as const : "BUY" as const,
          tickers: t.ticker,
          gross,
          fees,
          feePct: gross > 0 ? round2((fees / gross) * 100) : 0,
        };
      })
      .sort((a, b) => b.fees - a.fees)
      .slice(0, 8),
  };

  // ── By year ───────────────────────────────────────────────────────────────
  const yearMap = new Map<string, YearRow>();
  const ensureYear = (y: string) => {
    if (!yearMap.has(y)) {
      yearMap.set(y, {
        year: y,
        deposits: 0,
        manualExternalAcquisitions: 0,
        buys: 0,
        sells: 0,
        netCapitalDeployed: 0,
        realizedPl: 0,
        dividends: 0,
        tradingCharges: 0,
        accountCharges: 0,
        cgtTariffs: 0,
        friction: 0,
        tradeCount: 0,
        buyLines: 0,
        buyOrders: 0,
        sellLines: 0,
        sellOrders: 0,
        endingNetWorth: null,
        xirrPct: null,
        kse100MatchedResult: null,
        realReturnAfterInflation: null,
      });
    }
    return yearMap.get(y)!;
  };
  for (const c of cashIn) {
    ensureYear(((c.movement_date as string | null) ?? "????").slice(0, 4)).deposits +=
      Number(c.amount);
  }
  for (const t of txns) {
    const y = (t.trade_date ?? "????").slice(0, 4);
    const row = ensureYear(y);
    if (t.type === "BUY") {
      row.buys += t.net_amount;
      row.buyLines += 1;
      row.buyOrders += 1;
    }
    else {
      row.sells += t.net_amount;
      row.realizedPl += t.realized_pl ?? 0;
      row.sellLines += 1;
      row.sellOrders += 1;
    }
    row.friction += t.commission + t.tax;
    row.tradingCharges += t.commission + t.tax;
    row.tradeCount += 1;
  }
  const byYear: YearRow[] = [...yearMap.values()]
    .map((r) => ({
      ...r,
      deposits: round2(r.deposits),
      manualExternalAcquisitions: round2(r.manualExternalAcquisitions),
      buys: round2(r.buys),
      sells: round2(r.sells),
      netCapitalDeployed: round2(r.buys - r.sells),
      realizedPl: round2(r.realizedPl),
      tradingCharges: round2(r.tradingCharges),
      accountCharges: round2(r.accountCharges),
      cgtTariffs: round2(r.cgtTariffs),
      friction: round2(r.friction),
      endingNetWorth: r.year === (lastTxnDate ?? "").slice(0, 4) ? netWorth : null,
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  // ── Capital deployment ────────────────────────────────────────────────────
  const buysTotal = buys.length;
  let deployment: DeploymentSummary = {
    avgDaysDepositToBuy: null,
    medianDaysDepositToBuy: null,
    buysWithin24h: 0,
    buysTotal,
    pctDeployedWithin24h: null,
    largestIdleCashDays: null,
    saleProceedsLeftUninvested: cashBalance > 0 ? cashBalance : 0,
    pctCapitalCurrentlyCash: netWorth > 0 ? round2((cashBalance / netWorth) * 100) : null,
  };
  if (cashIn.length > 0) {
    const depositDates = cashIn
      .map((c) => c.movement_date as string | null)
      .filter((d): d is string => !!d)
      .sort();
    const lags: number[] = [];
    let within24h = 0;
    for (const t of buys.filter((t) => t.trade_date)) {
      let prior: string | null = null;
      for (const dd of depositDates) {
        if (dd <= t.trade_date!) prior = dd;
        else break;
      }
      if (prior) {
        const lag = Math.round(
          (Date.parse(t.trade_date!) - Date.parse(prior)) / 86_400_000
        );
        lags.push(lag);
        if (lag <= 1) within24h++;
      }
    }
    lags.sort((a, b) => a - b);
    deployment = {
      avgDaysDepositToBuy: lags.length
        ? round2(lags.reduce((s, x) => s + x, 0) / lags.length)
        : null,
      medianDaysDepositToBuy: lags.length ? lags[Math.floor(lags.length / 2)] : null,
      buysWithin24h: within24h,
      buysTotal,
      pctDeployedWithin24h: buysTotal ? round2((within24h / buysTotal) * 100) : null,
      largestIdleCashDays: lags.length ? Math.max(...lags) : null,
      saleProceedsLeftUninvested: cashBalance > 0 ? cashBalance : 0,
      pctCapitalCurrentlyCash: netWorth > 0 ? round2((cashBalance / netWorth) * 100) : null,
    };
  }

  // ── Concentration ─────────────────────────────────────────────────────────
  const priced = costBasis.filter((r) => r.marketValue !== null);
  const sectorMap = new Map<string, number>();
  for (const r of priced) {
    sectorMap.set(r.sector, (sectorMap.get(r.sector) ?? 0) + (r.marketValue ?? 0));
  }
  const sectorWeights = [...sectorMap.entries()]
    .map(([sector, value]) => ({
      sector,
      weightPct: marketValue > 0 ? round2((value / marketValue) * 100) : 0,
    }))
    .sort((a, b) => b.weightPct - a.weightPct);
  const hhi =
    round2(
      priced.reduce((s, r) => {
        const w = (r.marketValue ?? 0) / (totalMarketValue || 1);
        return s + w * w;
      }, 0) * 100
    ) / 100;
  const top2Banks = round2(
    priced
      .filter((r) => r.sector === "Commercial Banks")
      .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
      .slice(0, 2)
      .reduce((s, r) => s + (r.weightPct ?? 0), 0)
  );
  const topTwo = [...priced]
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .slice(0, 2);
  const dropPct = 11;
  const concentration: ConcentrationSummary = {
    topHolding: priced[0]
      ? { ticker: priced[0].ticker, weightPct: priced[0].weightPct ?? 0 }
      : null,
    top2BanksWeightPct: top2Banks,
    sectorWeights,
    hhi,
    positionsBelow1pct: priced.filter((r) => (r.weightPct ?? 0) < 1).length,
    positionsBelow3pct: priced.filter((r) => (r.weightPct ?? 0) < 3).length,
    smallTailWeightPct: round2(
      priced
        .filter((r) => (r.weightPct ?? 0) < 3)
        .reduce((s, r) => s + (r.weightPct ?? 0), 0)
    ),
    topTwoShock: topTwo.length
      ? {
          dropPct,
          portfolioImpactPct: round2(
            topTwo.reduce((s, r) => s + (r.weightPct ?? 0), 0) * (dropPct / 100)
          ),
        }
      : null,
  };

  const wealthBridgeDifference = round2(
    netWorth - (totalDeposited + realizedPl + unrealizedPl)
  );

  const checkpoint = checkpointRes.data as { as_of: string; source: string; data: unknown } | null;
  const checkpointData = checkpoint?.data as
    | {
        items?: { ticker: string; quantity: number }[];
        totalShares?: number;
        ledgerBalance?: number;
        manualPurchases?: { ticker: string; quantity: number }[];
      }
    | null;
  const manualPurchases = checkpointData?.manualPurchases ?? [];
  const expectedMap = new Map<string, { brokerInventoryQuantity: number | null; expectedQuantity: number }>();
  for (const item of checkpointData?.items ?? []) {
    expectedMap.set(item.ticker, {
      brokerInventoryQuantity: Number(item.quantity),
      expectedQuantity: Number(item.quantity),
    });
  }
  for (const m of manualPurchases) {
    const existing = expectedMap.get(m.ticker) ?? { brokerInventoryQuantity: null, expectedQuantity: 0 };
    existing.expectedQuantity += Number(m.quantity);
    expectedMap.set(m.ticker, existing);
  }
  if (expectedMap.size === 0) {
    for (const h of holdings) {
      expectedMap.set(h.ticker, { brokerInventoryQuantity: null, expectedQuantity: h.quantity });
    }
  }
  const holdingQty = new Map(holdings.map((h) => [h.ticker, h.quantity]));
  const quantityReconciliation: QuantityReconciliationRow[] = [...expectedMap.entries()]
    .map(([ticker, expected]) => {
      const current = holdingQty.get(ticker) ?? null;
      const difference = current === null ? null : round2(current - expected.expectedQuantity);
      return {
        ticker,
        brokerNetQuantity: expected.brokerInventoryQuantity ?? expected.expectedQuantity,
        brokerInventoryQuantity: expected.brokerInventoryQuantity,
        corporateActionAdjustment: ticker === "UBL" ? 177 : ticker === "FFC" ? 23 : 0,
        externalAcquisitionQuantity: ticker === "IREIT" ? 1500 : ticker === "SLM" ? 1000 : 0,
        manualPurchaseQuantity: manualPurchases
          .filter((m) => m.ticker === ticker)
          .reduce((s, m) => s + Number(m.quantity), 0),
        expectedQuantity: expected.expectedQuantity,
        currentPlatformQuantity: current,
        difference,
        status:
          current === null
            ? "Platform quantity unavailable"
            : Math.abs(difference ?? 0) < 0.0001
              ? "Reconciled"
              : "Difference",
      } satisfies QuantityReconciliationRow;
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  const unresolvedQuantityDiffs = quantityReconciliation.filter((r) => r.status === "Difference").length;
  const reconciled = !!checkpoint && unresolvedQuantityDiffs === 0 && quantityReconciliation.length > 0;

  // ── Benchmark series (KSE-100, inflation, drawdown) ───────────────────────
  // Pre-computed monthly NAV path written by rebuildBenchmarkSeries on every
  // ledger edit. When present it unlocks the index, purchasing-power and
  // drawdown comparisons; otherwise they stay marked unavailable.
  const benchmarkRows: BenchmarkSeriesPoint[] = (benchmarkRes.data ?? []).map((row) => ({
    date: row.point_date as string,
    contributed: Number(row.contributed ?? 0),
    portfolio: Number(row.portfolio ?? 0),
    kse100: Number(row.kse100 ?? 0),
    inflation: Number(row.inflation ?? 0),
    cpi: row.cpi !== null && row.cpi !== undefined ? Number(row.cpi) : null,
  }));
  const benchmark: BenchmarkSummary | null = summarizeBenchmarkSeries(benchmarkRows);

  // Fill the by-year KSE-100, real-return and (past-year) ending net-worth
  // columns from the benchmark NAV path: the last monthly point in each year is
  // that year's end. The current year keeps the live net worth set above.
  if (benchmark) {
    const benchmarkByYear = new Map<string, BenchmarkSeriesPoint>();
    for (const point of benchmark.series) benchmarkByYear.set(point.date.slice(0, 4), point);
    for (const row of byYear) {
      const point = benchmarkByYear.get(row.year);
      if (!point) continue;
      if (row.endingNetWorth === null) row.endingNetWorth = round2(point.portfolio);
      row.kse100MatchedResult = round2(point.kse100);
      row.realReturnAfterInflation =
        point.inflation > 0 ? round2((point.portfolio / point.inflation - 1) * 100) : null;
    }
  }

  const benchmarkPending =
    "No benchmark series is stored yet. Use Rebuild to fetch KSE-100 and PSX price history, then this comparison populates automatically.";
  const benchmarkStatus = {
    kse100: benchmark
      ? {
          available: true,
          reason: `Each external contribution is matched to the same-date KSE-100 total-return level and carried to ${benchmark.asOf}.`,
          methodology:
            "Money-weighted: every rupee buys the KSE-100 (total return) on its contribution date and is held forward, so the index path uses your real cash-flow schedule.",
        }
      : {
          available: false,
          reason: benchmarkPending,
          methodology:
            "Each external contribution must be matched to the same-date KSE-100 total-return index level and carried to the ending date.",
        },
    inflation: benchmark
      ? {
          available: true,
          reason: `Each contribution is inflated from its contribution-date PBS National CPI value to the latest CPI as of ${benchmark.asOf}.`,
          methodology:
            "Money-weighted: every rupee merely keeps pace with PBS National CPI (General, 2015-16 = 100) from its contribution date forward.",
        }
      : {
          available: false,
          reason: benchmarkPending,
          methodology:
            "Each contribution must be inflated from its contribution-date CPI value to the current CPI value, then summed.",
        },
    drawdown: benchmark && benchmark.maxDrawdownPct !== null
      ? {
          available: true,
          reason: `Worst peak-to-trough decline ${benchmark.maxDrawdownPct}% (${benchmark.drawdownPeakDate} → ${benchmark.drawdownTroughDate}) across the monthly portfolio NAV path.`,
        }
      : {
          available: false,
          reason: benchmarkPending,
        },
  };

  return {
    source: {
      type: "database_fallback",
      label: reconciled ? "Reconciled DB ledger" : "DB ledger",
      status: reconciled ? "reconciled" : "complete",
      detail: reconciled
        ? `Reconciled to AKD statement · ${quantityReconciliation.length} holdings · ${formatCount(quantityReconciliation.reduce((s, r) => s + r.expectedQuantity, 0))} shares · cash ${round2(cashBalance).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "Derived from stored transactions and cash movements. Add a reconciliation checkpoint to validate against the broker statement.",
    },
    returns,
    costBasis,
    friction,
    byYear,
    deployment,
    concentration,
    sales: buildDbSales(txns, new Map(holdings.map((h) => [h.ticker, h.quantity])), round2),
    normalizedEvents: [],
    positionBuild: buildDbPositionBuild(
      costBasis.map((row) => ({
        ticker: row.ticker,
        quantity: row.quantity,
        avgCost: row.avgCost,
        totalInvested: row.totalInvested,
        currentPrice: row.currentPrice,
        marketValue: row.marketValue,
        unrealizedPl: row.unrealizedPl,
      })),
      txns,
      round2,
      new Date().toISOString().slice(0, 10)
    ),
    quantityReconciliation,
    checkpoints: {
      externalBrokerDepositsImported: cashIn.length,
      brokerBuyLinesImported: buys.length,
      brokerBuyOrdersImported: new Set(buys.map((t) => `${t.trade_date}-${t.ticker}-${t.price}`)).size,
      brokerSellLinesImported: sells.length,
      brokerSellOrdersImported: new Set(sells.map((t) => `${t.trade_date}-${t.ticker}-${t.price}`)).size,
      manualPurchasesApplied: manualPurchases.length,
      ipoAcquisitionsApplied: txns.filter((t) => t.ticker === "IREIT" || t.ticker === "SLM").length,
      stockSplitsApplied: txns.filter((t) => t.type === "SPLIT").length,
      mergerConversionsApplied: txns.filter((t) => t.notes?.toLowerCase().includes("merger")).length,
      currentHoldingsReconciled: quantityReconciliation.filter((r) => r.status === "Reconciled").length,
      unexplainedQuantityDifferences: unresolvedQuantityDiffs,
      expectedTotalQuantity: quantityReconciliation.reduce((s, r) => s + r.expectedQuantity, 0),
      tradingFeesExtracted: totalFriction,
      accountChargesExtracted: 0,
      cgtEntriesExtracted: 0,
      dividendRecordsLinked: 0,
      unknownTransactionFeeFields: 0,
      xirrCashFlowCount: returns.cashflows.length,
      wealthBridgeDifference,
    },
    wealthBridge: [
      { label: "External capital contributed", value: totalDeposited, kind: "start", includedInReconciliation: true, note: "Stored cash movements or DB fallback estimate" },
      { label: "Realised trading P/L", value: realizedPl, kind: realizedPl >= 0 ? "increase" : "decrease", includedInReconciliation: true, note: "Stored realised P/L" },
      { label: "Unrealised P/L", value: unrealizedPl, kind: unrealizedPl >= 0 ? "increase" : "decrease", includedInReconciliation: true, note: "Current holdings less cost basis" },
      { label: "Current net worth", value: netWorth, kind: "end", includedInReconciliation: true, note: "DB market value plus DB cash" },
    ],
    timeline: buildDbTimeline(txns, cashRows, netWorth, round2),
    benchmarkStatus,
    benchmark,
  };
}

/**
 * Primary entry point for the /performance page.
 * DB-first: transactions + cash_movements are the editable source of truth.
 * PDF parsing is kept only as an emergency fallback for users who have not
 * backfilled/imported the ledger yet.
 */
export async function getPerformanceAnalytics(
  supabase: SupabaseClient,
  userId: string
): Promise<LedgerAnalytics | null> {
  const db = await getDbAnalytics(supabase, userId);
  if (db) return db;
  const pdf = await getPdfAnalytics(supabase, userId);
  if (pdf) return pdf;
  const localPdf = await getLocalPdfAnalytics();
  if (localPdf) return localPdf;
  return null;
}
