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
} from "@/lib/engine/ledger-analytics";

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
  const SELL_COST_RATE = 0.0018;
  const CGT_RATE = 0.15;

  const [txnsRes, holdingsRes, pricesRes, cashRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("ticker, trade_date, type, quantity, price, commission, tax, net_amount, realized_pl")
      .eq("user_id", userId)
      .in("type", ["BUY", "SELL"])
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
      .eq("type", "CASH_IN")
      .order("movement_date", { ascending: true }),
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
  }));

  const holdings = (holdingsRes.data ?? []).map((h) => ({
    ticker: h.ticker as string,
    sector: (h.sector as string | null) ?? "Other",
    quantity: Number(h.quantity),
    avg_cost: Number(h.avg_cost),
    total_cost: Number(h.total_cost),
  }));

  const cashIn = cashRes.data ?? [];

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
  const buys = txns.filter((t) => t.type === "BUY");
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

  const cashBalance =
    cashIn.length > 0 ? round2(totalDeposited + totalSells - totalBuys) : 0;
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

  return {
    source: {
      type: "database_fallback",
      label: "Database fallback",
      status: "incomplete",
      detail:
        "Full AKD statement was not available, so this uses stored transactions, holdings and cash movements. Reconciliation counts may be incomplete.",
    },
    returns,
    costBasis,
    friction,
    byYear,
    deployment,
    concentration,
    sales: [],
    normalizedEvents: [],
    positionBuild: costBasis.map((row) => ({
      ticker: row.ticker,
      firstAcquisitionDate: null,
      latestAcquisitionDate: null,
      purchaseCount: 0,
      totalQuantityAcquired: row.quantity,
      quantitySold: 0,
      corporateActionQuantity: 0,
      currentQuantity: row.quantity,
      lowestPurchasePrice: null,
      highestPurchasePrice: null,
      weightedAverageCost: row.avgCost,
      currentPrice: row.currentPrice,
      averageHoldingAgeDays: null,
      amountInvested: row.totalInvested,
      currentValue: row.marketValue,
      unrealizedPl: row.unrealizedPl,
    })),
    quantityReconciliation: [],
    checkpoints: {
      externalBrokerDepositsImported: cashIn.length,
      brokerBuyLinesImported: buys.length,
      brokerBuyOrdersImported: buys.length,
      brokerSellLinesImported: sells.length,
      brokerSellOrdersImported: sells.length,
      manualPurchasesApplied: 0,
      ipoAcquisitionsApplied: 0,
      stockSplitsApplied: 0,
      mergerConversionsApplied: 0,
      currentHoldingsReconciled: 0,
      unexplainedQuantityDifferences: 0,
      expectedTotalQuantity: holdings.reduce((s, h) => s + h.quantity, 0),
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
    timeline: [],
    benchmarkStatus: {
      kse100: {
        available: false,
        reason: "No KSE-100 total-return index history table is present in this project.",
        methodology:
          "Each external contribution must be matched to the same-date KSE-100 total-return index level and carried to the ending date.",
      },
      inflation: {
        available: false,
        reason: "No Pakistan National CPI or Urban CPI time series is stored in this project.",
        methodology:
          "Each contribution must be inflated from its contribution-date CPI value to the current CPI value, then summed.",
      },
      drawdown: {
        available: false,
        reason:
          "Drawdown analysis requires a complete historical portfolio-value series.",
      },
    },
  };
}

/**
 * Primary entry point for the /performance page.
 * Tries the AKD PDF from Supabase Storage first (most accurate: includes
 * per-trade SST/CDC split, CGT charges, and exact deposit dates for XIRR).
 * Falls back to DB-derived analytics when the PDF is not stored or fails to
 * parse — all the data that matters is already in transactions + holdings.
 */
export async function getPerformanceAnalytics(
  supabase: SupabaseClient,
  userId: string
): Promise<LedgerAnalytics | null> {
  const pdf = await getPdfAnalytics(supabase, userId);
  if (pdf) return pdf;
  const localPdf = await getLocalPdfAnalytics();
  if (localPdf) return localPdf;
  return getDbAnalytics(supabase, userId);
}
