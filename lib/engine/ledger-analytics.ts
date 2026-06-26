// Ledger analytics engine.
//
// The broker statement remains the authoritative source for historical cash,
// trades, fees and realised P/L. The Performance page can opt into the
// confirmed non-ledger adjustments (IPO allotments, corporate actions and the
// 24 Jun 2026 manual purchases) so current quantities and cost basis reconcile
// without pretending those events were ordinary AKD trade lines.

import type { AkdEntry, AkdStatement, AkdTrade } from "@/lib/import/akd-statement";

// PSX transaction-cost assumptions for forward-looking "if sold today" math.
// Historical fills carry their real costs; these only estimate a future sale.
const SELL_COST_RATE = 0.0018; // ~0.15% commission + 18% SST on it + small CDC
const CGT_RATE = 0.15; // capital gains tax on net gain (filer rate)

const MANUAL_BATCH = "confirmed-adjustments-2026-06-24";

// Minimal sector map for tickers appearing in this account (current + exited).
const SECTORS: Record<string, string> = {
  MEBL: "Commercial Banks",
  UBL: "Commercial Banks",
  MCB: "Commercial Banks",
  SCBPL: "Commercial Banks",
  FFC: "Fertilizer",
  FFBL: "Fertilizer",
  FCCL: "Cement",
  LUCK: "Cement",
  PPL: "Oil & Gas Exploration",
  SYS: "Technology & Communication",
  NETSOL: "Technology & Communication",
  AIRLINK: "Technology & Communication",
  PAEL: "Cable & Electrical Goods",
  MUGHAL: "Engineering",
  SEARL: "Pharmaceuticals",
  IMAGE: "Textile Composite",
  IREIT: "Real Estate (REIT)",
  GGL: "Glass & Ceramics",
  GHGL: "Glass & Ceramics",
  SLM: "Automobile Parts & Accessories",
  MTL: "Automobile Assembler",
  HCAR: "Automobile Assembler",
};

export const EXPECTED_CURRENT_QUANTITIES: Record<string, number> = {
  AIRLINK: 474,
  FCCL: 1254,
  FFC: 162,
  GGL: 2195,
  IMAGE: 1152,
  IREIT: 1500,
  LUCK: 87,
  MEBL: 556,
  MUGHAL: 398,
  NETSOL: 175,
  PAEL: 1257,
  PPL: 259,
  SEARL: 80,
  SLM: 1000,
  SYS: 788,
  UBL: 513,
};

type ConfirmedAdjustment =
  | {
      id: string;
      type: "IPO_ALLOTMENT";
      date: string;
      ticker: string;
      quantity: number;
      price: number;
      grossValue: number;
      narration: string;
      cashClassification: string;
    }
  | {
      id: string;
      type: "STOCK_SPLIT";
      date: string;
      ticker: string;
      ratio: number;
      quantityBefore: number;
      quantityAfter: number;
      additionalShares: number;
      narration: string;
    }
  | {
      id: string;
      type: "MERGER_CONVERSION";
      date: string | null;
      sortDate: string;
      fromTicker: string;
      toTicker: string;
      fromQuantity: number;
      toQuantity: number;
      ratioText: string;
      narration: string;
    }
  | {
      id: string;
      type: "MANUAL_PURCHASE";
      date: string;
      ticker: string;
      quantity: number;
      price: number;
      grossValue: number;
      narration: string;
      cashClassification: string;
    };

export const CONFIRMED_LEDGER_ADJUSTMENTS: ConfirmedAdjustment[] = [
  {
    id: "ADJ000001",
    type: "IPO_ALLOTMENT",
    date: "2025-09-23",
    ticker: "IREIT",
    quantity: 1500,
    price: 10,
    grossValue: 15000,
    narration:
      "IPO allotment IREIT 1,500 @ PKR 10.00; external acquisition outside AKD cash ledger.",
    cashClassification: "External acquisition outside the AKD cash ledger",
  },
  {
    id: "ADJ000002",
    type: "STOCK_SPLIT",
    date: "2025-06-20",
    ticker: "UBL",
    ratio: 2,
    quantityBefore: 177,
    quantityAfter: 354,
    additionalShares: 177,
    narration:
      "UBL stock split 2-for-1; total cost basis preserved; zero cash and realised P/L effect.",
  },
  {
    id: "ADJ000003",
    type: "IPO_ALLOTMENT",
    date: "2026-06-15",
    ticker: "SLM",
    quantity: 1000,
    price: 19.95,
    grossValue: 19950,
    narration:
      "IPO / external acquisition SLM 1,000 @ PKR 19.95; outside AKD cash ledger.",
    cashClassification: "External acquisition outside the AKD cash ledger",
  },
  {
    id: "ADJ000004",
    type: "MERGER_CONVERSION",
    date: null,
    sortDate: "2026-06-23",
    fromTicker: "FFBL",
    toTicker: "FFC",
    fromQuantity: 100,
    toQuantity: 23,
    ratioText: "1 FFC share for every 4.29 FFBL shares",
    narration:
      "FFBL to FFC merger conversion; 100 FFBL converted to 23 whole FFC shares; cost basis transferred; zero cash and realised P/L effect.",
  },
  {
    id: "ADJ000005",
    type: "MANUAL_PURCHASE",
    date: "2026-06-24",
    ticker: "FCCL",
    quantity: 176,
    price: 57.8,
    grossValue: 10172.8,
    narration:
      "Manual confirmed purchase FCCL 176 @ PKR 57.80; gross cost confirmed; transaction fees unavailable.",
    cashClassification: "Internal purchase after AKD ledger end; fees unknown",
  },
  {
    id: "ADJ000006",
    type: "MANUAL_PURCHASE",
    date: "2026-06-24",
    ticker: "FFC",
    quantity: 18,
    price: 557.25,
    grossValue: 10030.5,
    narration:
      "Manual confirmed purchase FFC 18 @ PKR 557.25; gross cost confirmed; transaction fees unavailable.",
    cashClassification: "Internal purchase after AKD ledger end; fees unknown",
  },
];

function sectorOf(ticker: string): string {
  return SECTORS[ticker] ?? "Other";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function dateMax(values: (string | null | undefined)[]): string | null {
  const dates = values.filter((d): d is string => !!d).sort();
  return dates.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// Money-weighted return (XIRR)
// ---------------------------------------------------------------------------

export interface Cashflow {
  date: string; // ISO
  amount: number; // contributions negative, terminal value positive
  label?: string;
  source?: string;
}

/** XIRR via Newton's method with a bisection fallback. Returns annual rate or null. */
export function xirr(cashflows: Cashflow[]): number | null {
  if (cashflows.length < 2) return null;
  const flows = [...cashflows].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = Date.parse(flows[0].date);
  const years = (cf: Cashflow) => (Date.parse(cf.date) - t0) / (365 * 86_400_000);
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const npv = (rate: number) =>
    flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, years(f)), 0);
  const dNpv = (rate: number) =>
    flows.reduce((s, f) => {
      const t = years(f);
      return s - (t * f.amount) / Math.pow(1 + rate, t + 1);
    }, 0);

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate);
    const d = dNpv(rate);
    if (Math.abs(d) < 1e-10) break;
    const next = rate - v / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) return round2(next * 100);
    rate = next;
  }

  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return round2(mid * 100);
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return round2(((lo + hi) / 2) * 100);
}

// ---------------------------------------------------------------------------
// Public analytics types
// ---------------------------------------------------------------------------

export type NormalizedEventType =
  | "External contribution"
  | "External withdrawal"
  | "Buy"
  | "Sell"
  | "IPO allotment"
  | "Manual purchase"
  | "Dividend"
  | "Trading charge"
  | "Account charge"
  | "CGT or tariff"
  | "Stock split"
  | "Merger conversion"
  | "Transfer in"
  | "Transfer out"
  | "Manual adjustment";

export interface NormalizedLedgerEvent {
  id: string;
  eventType: NormalizedEventType;
  brokerEntryNo: string | null;
  brokerOrderNo: string | null;
  postingDate: string | null;
  effectiveDate: string | null;
  settlementDate: string | null;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  grossValue: number | null;
  commission: number | null;
  sst: number | null;
  cdcCharge: number | null;
  accountCharge: number | null;
  cgtOrTariff: number | null;
  netCashEffect: number | null;
  direction: "debit" | "credit" | "zero" | "unknown";
  originalNarration: string;
  sourcePage: number | null;
  sourceType: "AKD ledger" | "Manual confirmed adjustment" | "Dividend module" | "Current platform";
  importBatch: string | null;
  manualOrCorporateAction: boolean;
  reconciliationStatus: "Imported" | "Applied" | "Linked" | "Missing source" | "Unreconciled";
  feesKnown: boolean;
  cashClassification: string | null;
}

export interface RealizedSale {
  date: string | null;
  ticker: string;
  quantity: number;
  grossProceeds: number;
  saleFees: number;
  proceeds: number; // net of the fees actually paid on the sale
  costOut: number;
  realized: number;
  realizedReturnPct: number | null;
  averageHoldingDays: number | null;
  remainingQuantity: number;
  status: "Closed" | "Partially realised" | "Source quantity gap";
  brokerOrderNo: string | null;
  sourceEntryNos: string[];
  formula: string;
}

export interface ReturnsSummary {
  totalDeposited: number;
  netWorth: number;
  marketValue: number;
  cashBalance: number;
  totalGain: number;
  totalReturnPct: number;
  xirrPct: number | null;
  holdingPeriodYears: number;
  realizedPl: number;
  unrealizedPl: number;
  totalFriction: number;
  startDate: string | null;
  endDate: string | null;
  externalCashFlowEvents: number;
  endingValue: number;
  dividendTreatment: string;
  manualAdjustmentsUsed: string[];
  xirrStatus: "calculated" | "unavailable";
  xirrFailureReason: string | null;
  cashflows: Cashflow[];
}

export interface CostBasisRow {
  ticker: string;
  sector: string;
  quantity: number;
  avgCost: number;
  totalInvested: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
  breakEvenPrice: number | null;
  profitIfSoldToday: number | null;
  weightPct: number | null;
}

export interface FrictionSummary {
  commission: number;
  sst: number;
  cdc: number;
  tradeFeesTotal: number;
  cgt: number;
  accountFees: number;
  unknownManualTradeFees: number;
  total: number;
  pctOfDeposits: number;
  pctOfGains: number | null;
  grossTradedValue: number;
  averageFeePerOrder: number | null;
  feePctGrossTraded: number | null;
  perTicker: { ticker: string; fees: number; trades: number }[];
  bySize: { bucket: string; trades: number; grossTradedValue: number; avgGross: number; totalFees: number; avgFeePct: number }[];
  byCategory: { category: string; amount: number; note: string }[];
  highestCostOrders: { date: string | null; orderNo: string; side: "BUY" | "SELL"; tickers: string; gross: number; fees: number; feePct: number }[];
}

export interface YearRow {
  year: string;
  deposits: number;
  manualExternalAcquisitions: number;
  buys: number;
  sells: number;
  netCapitalDeployed: number;
  realizedPl: number;
  dividends: number;
  tradingCharges: number;
  accountCharges: number;
  cgtTariffs: number;
  friction: number;
  tradeCount: number;
  buyLines: number;
  buyOrders: number;
  sellLines: number;
  sellOrders: number;
  endingNetWorth: number | null;
  xirrPct: number | null;
  kse100MatchedResult: number | null;
  realReturnAfterInflation: number | null;
}

export interface DeploymentSummary {
  avgDaysDepositToBuy: number | null;
  medianDaysDepositToBuy: number | null;
  buysWithin24h: number;
  buysTotal: number;
  pctDeployedWithin24h: number | null;
  largestIdleCashDays: number | null;
  saleProceedsLeftUninvested: number;
  pctCapitalCurrentlyCash: number | null;
}

export interface ConcentrationSummary {
  topHolding: { ticker: string; weightPct: number } | null;
  top2BanksWeightPct: number;
  sectorWeights: { sector: string; weightPct: number }[];
  hhi: number;
  positionsBelow1pct: number;
  positionsBelow3pct: number;
  smallTailWeightPct: number;
  topTwoShock: { dropPct: number; portfolioImpactPct: number } | null;
}

export interface PositionBuildRow {
  ticker: string;
  firstAcquisitionDate: string | null;
  latestAcquisitionDate: string | null;
  purchaseCount: number;
  totalQuantityAcquired: number;
  quantitySold: number;
  corporateActionQuantity: number;
  currentQuantity: number;
  lowestPurchasePrice: number | null;
  highestPurchasePrice: number | null;
  weightedAverageCost: number;
  currentPrice: number | null;
  averageHoldingAgeDays: number | null;
  amountInvested: number;
  currentValue: number | null;
  unrealizedPl: number | null;
}

export interface QuantityReconciliationRow {
  ticker: string;
  brokerNetQuantity: number;
  brokerInventoryQuantity: number | null;
  corporateActionAdjustment: number;
  externalAcquisitionQuantity: number;
  manualPurchaseQuantity: number;
  expectedQuantity: number;
  currentPlatformQuantity: number | null;
  difference: number | null;
  status: "Reconciled" | "Platform quantity unavailable" | "Difference";
}

export interface LedgerCheckpointSummary {
  externalBrokerDepositsImported: number;
  brokerBuyLinesImported: number;
  brokerBuyOrdersImported: number;
  brokerSellLinesImported: number;
  brokerSellOrdersImported: number;
  manualPurchasesApplied: number;
  ipoAcquisitionsApplied: number;
  stockSplitsApplied: number;
  mergerConversionsApplied: number;
  currentHoldingsReconciled: number;
  unexplainedQuantityDifferences: number;
  expectedTotalQuantity: number;
  tradingFeesExtracted: number;
  accountChargesExtracted: number;
  cgtEntriesExtracted: number;
  dividendRecordsLinked: number;
  unknownTransactionFeeFields: number;
  xirrCashFlowCount: number;
  wealthBridgeDifference: number;
}

export interface WealthBridgeComponent {
  label: string;
  value: number;
  kind: "start" | "increase" | "decrease" | "end" | "audit";
  includedInReconciliation: boolean;
  note: string;
}

export interface TimelinePoint {
  date: string;
  cumulativeContributions: number;
  grossPurchases: number;
  grossSales: number;
  charges: number;
  cashBalance: number;
  netWorth: number | null;
  eventLabels: string[];
}

export interface BenchmarkStatus {
  kse100: {
    available: boolean;
    reason: string;
    methodology: string;
  };
  inflation: {
    available: boolean;
    reason: string;
    methodology: string;
  };
  drawdown: {
    available: boolean;
    reason: string;
  };
}

/** One monthly checkpoint of the growth-of-capital benchmark series. */
export interface BenchmarkSeriesPoint {
  date: string;
  contributed: number;
  portfolio: number;
  kse100: number;
  inflation: number;
  cpi: number | null;
}

/**
 * Computed comparison of the portfolio against its KSE-100 and inflation
 * equivalents, plus a peak-to-trough drawdown read off the portfolio NAV path.
 * Null when the benchmark series has not been built for the user yet.
 */
export interface BenchmarkSummary {
  asOf: string;
  contributed: number;
  portfolio: number;
  kse100Equivalent: number;
  inflationEquivalent: number;
  /** portfolio − KSE-100 equivalent (positive = outperformed the index). */
  excessVsKse100: number;
  /** portfolio − inflation-protected equivalent (positive = beat inflation). */
  excessVsInflation: number;
  /** Most negative peak-to-trough decline on the portfolio NAV path, as a %. */
  maxDrawdownPct: number | null;
  maxDrawdownValue: number | null;
  drawdownPeakDate: string | null;
  drawdownTroughDate: string | null;
  series: BenchmarkSeriesPoint[];
}

export interface LedgerSource {
  type: "akd_statement" | "local_akd_pdf" | "database_fallback";
  label: string;
  status: "complete" | "incomplete" | "reconciled";
  detail: string;
}

export interface LedgerAnalytics {
  source: LedgerSource;
  returns: ReturnsSummary;
  costBasis: CostBasisRow[];
  friction: FrictionSummary;
  byYear: YearRow[];
  deployment: DeploymentSummary;
  concentration: ConcentrationSummary;
  sales: RealizedSale[];
  normalizedEvents: NormalizedLedgerEvent[];
  positionBuild: PositionBuildRow[];
  quantityReconciliation: QuantityReconciliationRow[];
  checkpoints: LedgerCheckpointSummary;
  wealthBridge: WealthBridgeComponent[];
  timeline: TimelinePoint[];
  benchmarkStatus: BenchmarkStatus;
  benchmark: BenchmarkSummary | null;
}

export interface AnalyzeLedgerOptions {
  includeConfirmedAdjustments?: boolean;
  source?: LedgerSource;
  linkedDividendRecords?: number;
}

// ---------------------------------------------------------------------------
// Internal rebuild helpers
// ---------------------------------------------------------------------------

interface Lot {
  date: string | null;
  quantity: number;
}

interface Position {
  ticker: string;
  quantity: number;
  totalCost: number;
  avgCost: number;
  acquiredQty: number;
  soldQty: number;
  corporateActionQty: number;
  firstAcquisitionDate: string | null;
  latestAcquisitionDate: string | null;
  purchaseCount: number;
  lowestPurchasePrice: number | null;
  highestPurchasePrice: number | null;
  lots: Lot[];
  sourceEntryNos: string[];
}

function emptyPosition(ticker: string): Position {
  return {
    ticker,
    quantity: 0,
    totalCost: 0,
    avgCost: 0,
    acquiredQty: 0,
    soldQty: 0,
    corporateActionQty: 0,
    firstAcquisitionDate: null,
    latestAcquisitionDate: null,
    purchaseCount: 0,
    lowestPurchasePrice: null,
    highestPurchasePrice: null,
    lots: [],
    sourceEntryNos: [],
  };
}

function getPosition(positions: Map<string, Position>, ticker: string): Position {
  const current = positions.get(ticker);
  if (current) return current;
  const next = emptyPosition(ticker);
  positions.set(ticker, next);
  return next;
}

function recordAcquisition(
  p: Position,
  input: {
    quantity: number;
    cost: number;
    price: number | null;
    date: string | null;
    sourceEntryNo?: string | null;
    countAsPurchase: boolean;
  }
) {
  p.quantity += input.quantity;
  p.totalCost += input.cost;
  p.avgCost = p.quantity > 0 ? p.totalCost / p.quantity : 0;
  p.acquiredQty += input.quantity;
  if (input.countAsPurchase) p.purchaseCount += 1;
  if (input.price !== null) {
    p.lowestPurchasePrice =
      p.lowestPurchasePrice === null ? input.price : Math.min(p.lowestPurchasePrice, input.price);
    p.highestPurchasePrice =
      p.highestPurchasePrice === null ? input.price : Math.max(p.highestPurchasePrice, input.price);
  }
  if (input.date) {
    p.firstAcquisitionDate =
      p.firstAcquisitionDate === null || input.date < p.firstAcquisitionDate
        ? input.date
        : p.firstAcquisitionDate;
    p.latestAcquisitionDate =
      p.latestAcquisitionDate === null || input.date > p.latestAcquisitionDate
        ? input.date
        : p.latestAcquisitionDate;
  }
  if (input.sourceEntryNo) p.sourceEntryNos.push(input.sourceEntryNo);
  p.lots.push({ date: input.date, quantity: input.quantity });
}

function consumeLots(p: Position, quantity: number, saleDate: string | null): number | null {
  let remaining = quantity;
  let consumed = 0;
  let weightedDays = 0;
  const nextLots: Lot[] = [];
  for (const lot of p.lots) {
    if (remaining <= 0) {
      nextLots.push(lot);
      continue;
    }
    const used = Math.min(lot.quantity, remaining);
    remaining -= used;
    consumed += used;
    if (lot.date && saleDate) weightedDays += daysBetween(lot.date, saleDate) * used;
    const leftover = lot.quantity - used;
    if (leftover > 0) nextLots.push({ ...lot, quantity: leftover });
  }
  p.lots = nextLots;
  return consumed > 0 && saleDate ? round2(weightedDays / consumed) : null;
}

function applySplit(p: Position, adjustment: Extract<ConfirmedAdjustment, { type: "STOCK_SPLIT" }>) {
  if (p.quantity <= 0) return;
  for (const lot of p.lots) lot.quantity = lot.quantity * adjustment.ratio;
  p.quantity = p.quantity * adjustment.ratio;
  p.corporateActionQty += adjustment.additionalShares;
  p.avgCost = p.quantity > 0 ? p.totalCost / p.quantity : 0;
}

function applyMerger(
  positions: Map<string, Position>,
  adjustment: Extract<ConfirmedAdjustment, { type: "MERGER_CONVERSION" }>
) {
  const from = positions.get(adjustment.fromTicker);
  if (!from || from.quantity <= 0) return;
  const to = getPosition(positions, adjustment.toTicker);
  const movedCost = from.totalCost;
  const movedDate = from.firstAcquisitionDate;
  positions.delete(adjustment.fromTicker);
  to.quantity += adjustment.toQuantity;
  to.totalCost += movedCost;
  to.avgCost = to.quantity > 0 ? to.totalCost / to.quantity : 0;
  to.corporateActionQty += adjustment.toQuantity;
  to.lots.push({ date: movedDate, quantity: adjustment.toQuantity });
}

function rebuildPositions(
  trades: AkdTrade[],
  adjustments: ConfirmedAdjustment[]
): {
  positions: Map<string, Position>;
  sales: RealizedSale[];
  brokerPositions: Map<string, Position>;
} {
  const brokerPositions = new Map<string, Position>();
  const events: {
    sortDate: string;
    order: number;
    trade?: AkdTrade;
    adjustment?: ConfirmedAdjustment;
  }[] = [];
  trades.forEach((trade, i) => events.push({ sortDate: trade.date ?? "9999-12-31", order: i, trade }));
  adjustments.forEach((adjustment, i) => {
    const sortDate =
      adjustment.type === "MERGER_CONVERSION" ? adjustment.sortDate : adjustment.date;
    events.push({ sortDate, order: 10_000 + i, adjustment });
  });
  events.sort((a, b) => a.sortDate.localeCompare(b.sortDate) || a.order - b.order);

  const positions = new Map<string, Position>();
  const sales: RealizedSale[] = [];

  for (const event of events) {
    if (event.trade) {
      const t = event.trade;
      const p = getPosition(positions, t.ticker);
      const bp = getPosition(brokerPositions, t.ticker);
      if (t.side === "BUY") {
        recordAcquisition(p, {
          quantity: t.quantity,
          cost: t.net,
          price: t.price,
          date: t.date,
          sourceEntryNo: t.entryNo,
          countAsPurchase: true,
        });
        recordAcquisition(bp, {
          quantity: t.quantity,
          cost: t.net,
          price: t.price,
          date: t.date,
          sourceEntryNo: t.entryNo,
          countAsPurchase: true,
        });
      } else {
        const sellQty = Math.min(t.quantity, p.quantity);
        const brokerSellQty = Math.min(t.quantity, bp.quantity);
        const costOut = p.avgCost * sellQty;
        const brokerCostOut = bp.avgCost * brokerSellQty;
        const averageHoldingDays = consumeLots(p, sellQty, t.date);
        consumeLots(bp, brokerSellQty, t.date);
        p.quantity -= sellQty;
        p.totalCost -= costOut;
        p.soldQty += t.quantity;
        p.avgCost = p.quantity > 0 ? p.totalCost / p.quantity : 0;
        bp.quantity -= brokerSellQty;
        bp.totalCost -= brokerCostOut;
        bp.soldQty += t.quantity;
        bp.avgCost = bp.quantity > 0 ? bp.totalCost / bp.quantity : 0;
        sales.push({
          date: t.date,
          ticker: t.ticker,
          quantity: t.quantity,
          grossProceeds: t.gross,
          saleFees: t.fees,
          proceeds: t.net,
          costOut: round2(costOut),
          realized: round2(t.net - costOut),
          realizedReturnPct: costOut > 0 ? round2(((t.net - costOut) / costOut) * 100) : null,
          averageHoldingDays,
          remainingQuantity: round2(p.quantity),
          status:
            sellQty < t.quantity
              ? "Source quantity gap"
              : p.quantity > 0
                ? "Partially realised"
                : "Closed",
          brokerOrderNo: t.ref,
          sourceEntryNos: [t.entryNo],
          formula: "Net sale proceeds - weighted-average cost allocated to shares sold",
        });
      }
      positions.set(t.ticker, p);
      brokerPositions.set(t.ticker, bp);
      continue;
    }

    const adjustment = event.adjustment;
    if (!adjustment) continue;
    if (adjustment.type === "IPO_ALLOTMENT") {
      const p = getPosition(positions, adjustment.ticker);
      recordAcquisition(p, {
        quantity: adjustment.quantity,
        cost: adjustment.grossValue,
        price: adjustment.price,
        date: adjustment.date,
        sourceEntryNo: adjustment.id,
        countAsPurchase: true,
      });
    } else if (adjustment.type === "MANUAL_PURCHASE") {
      const p = getPosition(positions, adjustment.ticker);
      recordAcquisition(p, {
        quantity: adjustment.quantity,
        cost: adjustment.grossValue,
        price: adjustment.price,
        date: adjustment.date,
        sourceEntryNo: adjustment.id,
        countAsPurchase: true,
      });
    } else if (adjustment.type === "STOCK_SPLIT") {
      applySplit(getPosition(positions, adjustment.ticker), adjustment);
    } else if (adjustment.type === "MERGER_CONVERSION") {
      applyMerger(positions, adjustment);
    }
  }

  for (const p of positions.values()) {
    if (Math.abs(p.quantity) < 0.0001) {
      p.quantity = 0;
      p.totalCost = 0;
      p.avgCost = 0;
    }
  }

  return { positions, sales, brokerPositions };
}

function eventDate(e: NormalizedLedgerEvent): string | null {
  return e.effectiveDate ?? e.postingDate;
}

function toTradeEvent(t: AkdTrade): NormalizedLedgerEvent {
  return {
    id: `AKD-${t.entryNo}-${t.ref}-${t.ticker}-${t.side}`,
    eventType: t.side === "BUY" ? "Buy" : "Sell",
    brokerEntryNo: t.entryNo,
    brokerOrderNo: t.ref,
    postingDate: t.date,
    effectiveDate: t.date,
    settlementDate: null,
    ticker: t.ticker,
    quantity: t.quantity,
    price: t.price,
    grossValue: t.gross,
    commission: t.commission,
    sst: t.sst,
    cdcCharge: t.cdc,
    accountCharge: null,
    cgtOrTariff: null,
    netCashEffect: t.side === "BUY" ? -t.net : t.net,
    direction: t.side === "BUY" ? "debit" : "credit",
    originalNarration: t.narration,
    sourcePage: t.page,
    sourceType: "AKD ledger",
    importBatch: null,
    manualOrCorporateAction: false,
    reconciliationStatus: "Imported",
    feesKnown: true,
    cashClassification: "Internal broker cash movement",
  };
}

function toEntryEvent(e: AkdEntry): NormalizedLedgerEvent | null {
  if (e.kind === "TRADE") return null;
  const eventType: NormalizedEventType =
    e.kind === "DEPOSIT"
      ? "External contribution"
      : e.kind === "CGT"
        ? "CGT or tariff"
        : e.kind === "FEE"
          ? "Account charge"
          : "Manual adjustment";
  const isCharge = eventType === "CGT or tariff" || eventType === "Account charge";
  return {
    id: `AKD-${e.entryNo}-${eventType}`,
    eventType,
    brokerEntryNo: e.entryNo,
    brokerOrderNo: null,
    postingDate: e.date,
    effectiveDate: e.date,
    settlementDate: null,
    ticker: null,
    quantity: null,
    price: null,
    grossValue: e.amount,
    commission: null,
    sst: null,
    cdcCharge: null,
    accountCharge: eventType === "Account charge" ? e.amount : null,
    cgtOrTariff: eventType === "CGT or tariff" ? e.amount : null,
    netCashEffect: e.kind === "DEPOSIT" ? e.amount : isCharge ? -e.amount : null,
    direction: e.kind === "DEPOSIT" ? "credit" : isCharge ? "debit" : "unknown",
    originalNarration: e.narration,
    sourcePage: e.page,
    sourceType: "AKD ledger",
    importBatch: null,
    manualOrCorporateAction: false,
    reconciliationStatus: "Imported",
    feesKnown: true,
    cashClassification:
      e.kind === "DEPOSIT"
        ? "Investor external cash contribution"
        : isCharge
          ? "Broker cash deduction"
          : null,
  };
}

function toAdjustmentEvent(adjustment: ConfirmedAdjustment): NormalizedLedgerEvent {
  if (adjustment.type === "IPO_ALLOTMENT") {
    return {
      id: adjustment.id,
      eventType: "IPO allotment",
      brokerEntryNo: null,
      brokerOrderNo: null,
      postingDate: adjustment.date,
      effectiveDate: adjustment.date,
      settlementDate: null,
      ticker: adjustment.ticker,
      quantity: adjustment.quantity,
      price: adjustment.price,
      grossValue: adjustment.grossValue,
      commission: null,
      sst: null,
      cdcCharge: null,
      accountCharge: null,
      cgtOrTariff: null,
      netCashEffect: null,
      direction: "zero",
      originalNarration: adjustment.narration,
      sourcePage: null,
      sourceType: "Manual confirmed adjustment",
      importBatch: MANUAL_BATCH,
      manualOrCorporateAction: true,
      reconciliationStatus: "Applied",
      feesKnown: true,
      cashClassification: adjustment.cashClassification,
    };
  }
  if (adjustment.type === "MANUAL_PURCHASE") {
    return {
      id: adjustment.id,
      eventType: "Manual purchase",
      brokerEntryNo: null,
      brokerOrderNo: null,
      postingDate: adjustment.date,
      effectiveDate: adjustment.date,
      settlementDate: null,
      ticker: adjustment.ticker,
      quantity: adjustment.quantity,
      price: adjustment.price,
      grossValue: adjustment.grossValue,
      commission: null,
      sst: null,
      cdcCharge: null,
      accountCharge: null,
      cgtOrTariff: null,
      netCashEffect: -adjustment.grossValue,
      direction: "debit",
      originalNarration: adjustment.narration,
      sourcePage: null,
      sourceType: "Manual confirmed adjustment",
      importBatch: MANUAL_BATCH,
      manualOrCorporateAction: true,
      reconciliationStatus: "Applied",
      feesKnown: false,
      cashClassification: adjustment.cashClassification,
    };
  }
  if (adjustment.type === "STOCK_SPLIT") {
    return {
      id: adjustment.id,
      eventType: "Stock split",
      brokerEntryNo: null,
      brokerOrderNo: null,
      postingDate: adjustment.date,
      effectiveDate: adjustment.date,
      settlementDate: null,
      ticker: adjustment.ticker,
      quantity: adjustment.additionalShares,
      price: null,
      grossValue: null,
      commission: null,
      sst: null,
      cdcCharge: null,
      accountCharge: null,
      cgtOrTariff: null,
      netCashEffect: 0,
      direction: "zero",
      originalNarration: adjustment.narration,
      sourcePage: null,
      sourceType: "Manual confirmed adjustment",
      importBatch: MANUAL_BATCH,
      manualOrCorporateAction: true,
      reconciliationStatus: "Applied",
      feesKnown: true,
      cashClassification: "Zero-cash corporate action",
    };
  }
  return {
    id: adjustment.id,
    eventType: "Merger conversion",
    brokerEntryNo: null,
    brokerOrderNo: null,
    postingDate: adjustment.date,
    effectiveDate: adjustment.date,
    settlementDate: null,
    ticker: adjustment.toTicker,
    quantity: adjustment.toQuantity,
    price: null,
    grossValue: null,
    commission: null,
    sst: null,
    cdcCharge: null,
    accountCharge: null,
    cgtOrTariff: null,
    netCashEffect: 0,
    direction: "zero",
    originalNarration: adjustment.narration,
    sourcePage: null,
    sourceType: "Manual confirmed adjustment",
    importBatch: MANUAL_BATCH,
    manualOrCorporateAction: true,
    reconciliationStatus: "Applied",
    feesKnown: true,
    cashClassification: "Zero-cash corporate action",
  };
}

function buildInventory(
  stmt: AkdStatement,
  adjustments: ConfirmedAdjustment[]
): Map<string, { ticker: string; quantity: number; closingRate: number; amount: number }> {
  const inventory = new Map(
    stmt.inventory.map((i) => [
      i.ticker,
      {
        ticker: i.ticker,
        quantity: i.quantity,
        closingRate: i.closingRate,
        amount: i.amount,
      },
    ])
  );
  for (const adjustment of adjustments) {
    if (adjustment.type !== "MANUAL_PURCHASE") continue;
    const item = inventory.get(adjustment.ticker);
    if (!item) {
      inventory.set(adjustment.ticker, {
        ticker: adjustment.ticker,
        quantity: adjustment.quantity,
        closingRate: adjustment.price,
        amount: round2(adjustment.quantity * adjustment.price),
      });
      continue;
    }
    item.quantity += adjustment.quantity;
    item.amount = round2(item.quantity * item.closingRate);
  }
  return inventory;
}

function buildTimeline(events: NormalizedLedgerEvent[], terminalNetWorth: number | null): TimelinePoint[] {
  const dated = events
    .map((event) => ({ event, date: eventDate(event) }))
    .filter((x): x is { event: NormalizedLedgerEvent; date: string } => !!x.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, NormalizedLedgerEvent[]>();
  for (const row of dated) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row.event]);

  let cumulativeContributions = 0;
  let grossPurchases = 0;
  let grossSales = 0;
  let charges = 0;
  let cashBalance = 0;
  const points: TimelinePoint[] = [];
  const dates = [...byDate.keys()].sort();
  dates.forEach((date, index) => {
    const day = byDate.get(date) ?? [];
    const labels: string[] = [];
    for (const event of day) {
      if (event.eventType === "External contribution") {
        cumulativeContributions += event.grossValue ?? 0;
        cashBalance += event.grossValue ?? 0;
      } else if (event.eventType === "IPO allotment") {
        cumulativeContributions += event.grossValue ?? 0;
        labels.push(`${event.ticker} IPO`);
      } else if (event.eventType === "Buy" || event.eventType === "Manual purchase") {
        grossPurchases += event.grossValue ?? 0;
        cashBalance += event.netCashEffect ?? 0;
        if (event.eventType === "Manual purchase") labels.push(`${event.ticker} manual buy`);
      } else if (event.eventType === "Sell") {
        grossSales += event.grossValue ?? 0;
        cashBalance += event.netCashEffect ?? 0;
        labels.push(`${event.ticker} sale`);
      } else if (event.eventType === "Account charge" || event.eventType === "CGT or tariff") {
        charges += event.grossValue ?? 0;
        cashBalance += event.netCashEffect ?? 0;
      } else if (event.eventType === "Stock split") {
        labels.push(`${event.ticker} split`);
      } else if (event.eventType === "Merger conversion") {
        labels.push("FFBL to FFC");
      }
    }
    points.push({
      date,
      cumulativeContributions: round2(cumulativeContributions),
      grossPurchases: round2(grossPurchases),
      grossSales: round2(grossSales),
      charges: round2(charges),
      cashBalance: round2(cashBalance),
      netWorth: index === dates.length - 1 ? terminalNetWorth : null,
      eventLabels: labels,
    });
  });
  return points;
}

function groupOrders(trades: AkdTrade[]) {
  const map = new Map<
    string,
    { date: string | null; orderNo: string; side: "BUY" | "SELL"; tickers: Set<string>; gross: number; fees: number; lines: number }
  >();
  for (const t of trades) {
    const key = `${t.side}:${t.ref}:${t.date ?? ""}`;
    const current =
      map.get(key) ?? {
        date: t.date,
        orderNo: t.ref,
        side: t.side,
        tickers: new Set<string>(),
        gross: 0,
        fees: 0,
        lines: 0,
      };
    current.tickers.add(t.ticker);
    current.gross += t.gross;
    current.fees += t.fees;
    current.lines += 1;
    map.set(key, current);
  }
  return [...map.values()].map((row) => ({
    ...row,
    gross: round2(row.gross),
    fees: round2(row.fees),
    tickersText: [...row.tickers].join(", "),
  }));
}

export function analyzeLedger(stmt: AkdStatement, options: AnalyzeLedgerOptions = {}): LedgerAnalytics {
  const includeAdjustments = options.includeConfirmedAdjustments ?? false;
  const adjustments = includeAdjustments ? CONFIRMED_LEDGER_ADJUSTMENTS : [];
  const { positions, sales, brokerPositions } = rebuildPositions(stmt.trades, adjustments);
  const inventory = buildInventory(stmt, adjustments);
  const priceByTicker = new Map([...inventory.values()].map((i) => [i.ticker, i.closingRate]));
  const amountByTicker = new Map([...inventory.values()].map((i) => [i.ticker, i.amount]));
  const orders = groupOrders(stmt.trades);

  const brokerDeposits = round2(stmt.deposits.reduce((s, d) => s + d.amount, 0));
  const externalAcquisitionValue = round2(
    adjustments
      .filter((a): a is Extract<ConfirmedAdjustment, { type: "IPO_ALLOTMENT" }> => a.type === "IPO_ALLOTMENT")
      .reduce((s, a) => s + a.grossValue, 0)
  );
  const manualPurchaseGross = round2(
    adjustments
      .filter((a): a is Extract<ConfirmedAdjustment, { type: "MANUAL_PURCHASE" }> => a.type === "MANUAL_PURCHASE")
      .reduce((s, a) => s + a.grossValue, 0)
  );
  const totalDeposited = round2(brokerDeposits + externalAcquisitionValue);
  const marketValue = round2([...inventory.values()].reduce((s, i) => s + i.amount, 0));
  const cashBalance = round2((stmt.controls.ledgerBalance ?? 0) - manualPurchaseGross);
  const netWorth = round2(marketValue + cashBalance);

  const realizedPl = round2(sales.reduce((s, x) => s + x.realized, 0));
  const tradeCommission = round2(stmt.trades.reduce((s, t) => s + t.commission, 0));
  const tradeSst = round2(stmt.trades.reduce((s, t) => s + t.sst, 0));
  const tradeCdc = round2(stmt.trades.reduce((s, t) => s + t.cdc, 0));
  const tradeFeesTotal = round2(stmt.trades.reduce((s, t) => s + t.fees, 0));
  const cgt = round2(stmt.charges.filter((c) => c.kind === "CGT").reduce((s, c) => s + c.amount, 0));
  const accountFees = round2(
    stmt.charges.filter((c) => c.kind === "FEE").reduce((s, c) => s + c.amount, 0)
  );
  const totalFriction = round2(tradeFeesTotal + cgt + accountFees);

  const costBasis: CostBasisRow[] = [];
  for (const inv of [...inventory.values()].sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    const qty = inv.quantity;
    if (qty <= 0) continue;
    const p = positions.get(inv.ticker);
    const totalInvested = p && p.totalCost > 0 ? round2(p.totalCost) : 0;
    const avgCost = totalInvested > 0 ? round2(totalInvested / qty) : 0;
    const currentPrice = priceByTicker.get(inv.ticker) ?? null;
    const mv = amountByTicker.get(inv.ticker) ?? (currentPrice !== null ? round2(qty * currentPrice) : null);
    const unrealized = mv !== null ? round2(mv - totalInvested) : null;
    const breakEven = avgCost > 0 ? round2(avgCost / (1 - SELL_COST_RATE)) : null;
    let profitIfSold: number | null = null;
    if (mv !== null) {
      const proceeds = mv * (1 - SELL_COST_RATE);
      const gain = proceeds - totalInvested;
      const tax = gain > 0 ? gain * CGT_RATE : 0;
      profitIfSold = round2(proceeds - totalInvested - tax);
    }
    costBasis.push({
      ticker: inv.ticker,
      sector: sectorOf(inv.ticker),
      quantity: qty,
      avgCost,
      totalInvested,
      currentPrice,
      marketValue: mv,
      unrealizedPl: unrealized,
      unrealizedPlPct: unrealized !== null && totalInvested > 0 ? round2((unrealized / totalInvested) * 100) : null,
      breakEvenPrice: breakEven,
      profitIfSoldToday: profitIfSold,
      weightPct: mv !== null && marketValue > 0 ? round2((mv / marketValue) * 100) : null,
    });
  }
  costBasis.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  const unrealizedPl = round2(costBasis.reduce((s, r) => s + (r.unrealizedPl ?? 0), 0));
  const totalGain = round2(netWorth - totalDeposited);

  const dates = [
    ...stmt.entries.map((e) => e.date),
    ...adjustments.map((a) => (a.type === "MERGER_CONVERSION" ? a.date : a.date)),
  ]
    .filter((d): d is string => !!d)
    .sort();
  const endDate = dateMax(dates) ?? stmt.account.toDate;
  const startDate = dates[0] ?? stmt.account.fromDate;
  const holdingPeriodYears =
    startDate && endDate ? round2(daysBetween(startDate, endDate) / 365) : 0;
  const cashflows: Cashflow[] = stmt.deposits.map((d) => ({
    date: d.date ?? endDate ?? "",
    amount: -d.amount,
    label: "Broker cash deposit",
    source: d.entryNo,
  }));
  for (const a of adjustments) {
    if (a.type !== "IPO_ALLOTMENT") continue;
    cashflows.push({
      date: a.date,
      amount: -a.grossValue,
      label: `${a.ticker} external acquisition`,
      source: a.id,
    });
  }
  if (endDate) cashflows.push({ date: endDate, amount: netWorth, label: "Ending current net worth", source: "terminal" });
  const xirrPct = xirr(cashflows);

  const returns: ReturnsSummary = {
    totalDeposited,
    netWorth,
    marketValue,
    cashBalance,
    totalGain,
    totalReturnPct: totalDeposited > 0 ? round2((totalGain / totalDeposited) * 100) : 0,
    xirrPct,
    holdingPeriodYears,
    realizedPl,
    unrealizedPl,
    totalFriction,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    externalCashFlowEvents: cashflows.filter((c) => c.amount < 0).length,
    endingValue: netWorth,
    dividendTreatment:
      "Dividend module values are displayed separately; broker purchases and sales are not treated as investor-level XIRR cash flows.",
    manualAdjustmentsUsed: adjustments.map((a) => a.id),
    xirrStatus: xirrPct === null ? "unavailable" : "calculated",
    xirrFailureReason:
      xirrPct === null ? "XIRR requires at least one negative external cash flow and one positive ending value." : null,
    cashflows,
  };

  const perTickerMap = new Map<string, { fees: number; trades: number }>();
  for (const t of stmt.trades) {
    const e = perTickerMap.get(t.ticker) ?? { fees: 0, trades: 0 };
    e.fees += t.fees;
    e.trades += 1;
    perTickerMap.set(t.ticker, e);
  }
  const orderBands = [
    { bucket: "Below 2,500", min: 0, max: 2500 },
    { bucket: "2,500-5,000", min: 2500, max: 5000 },
    { bucket: "5,000-10,000", min: 5000, max: 10000 },
    { bucket: "10,000-25,000", min: 10000, max: 25000 },
    { bucket: "Above 25,000", min: 25000, max: Infinity },
  ];
  const bySize = orderBands
    .map((b) => {
      const inBucket = orders.filter((o) => o.gross >= b.min && o.gross < b.max);
      const grossTradedValue = round2(inBucket.reduce((s, o) => s + o.gross, 0));
      const totalFees = round2(inBucket.reduce((s, o) => s + o.fees, 0));
      const avgGross = inBucket.length ? round2(grossTradedValue / inBucket.length) : 0;
      const avgFeePct = grossTradedValue > 0 ? round2((totalFees / grossTradedValue) * 100) : 0;
      return { bucket: b.bucket, trades: inBucket.length, grossTradedValue, avgGross, totalFees, avgFeePct };
    })
    .filter((b) => b.trades > 0);
  const grossProfit = realizedPl + unrealizedPl;
  const grossTradedValue = round2(stmt.trades.reduce((s, t) => s + t.gross, 0));
  const friction: FrictionSummary = {
    commission: tradeCommission,
    sst: tradeSst,
    cdc: tradeCdc,
    tradeFeesTotal,
    cgt,
    accountFees,
    unknownManualTradeFees: adjustments.filter((a) => a.type === "MANUAL_PURCHASE").length,
    total: totalFriction,
    pctOfDeposits: totalDeposited > 0 ? round2((totalFriction / totalDeposited) * 100) : 0,
    pctOfGains: grossProfit > 0 ? round2((totalFriction / grossProfit) * 100) : null,
    grossTradedValue,
    averageFeePerOrder: orders.length ? round2(tradeFeesTotal / orders.length) : null,
    feePctGrossTraded: grossTradedValue > 0 ? round2((tradeFeesTotal / grossTradedValue) * 100) : null,
    perTicker: [...perTickerMap.entries()]
      .map(([ticker, v]) => ({ ticker, fees: round2(v.fees), trades: v.trades }))
      .sort((a, b) => b.fees - a.fees),
    bySize,
    byCategory: [
      { category: "Brokerage commission", amount: tradeCommission, note: "Included in weighted-average trade P/L" },
      { category: "SST", amount: tradeSst, note: "Included in weighted-average trade P/L" },
      { category: "CDC transaction charges", amount: tradeCdc, note: "Included in weighted-average trade P/L" },
      { category: "Account and maintenance", amount: accountFees, note: "Cash deduction outside trade P/L" },
      { category: "CGT and tariffs", amount: cgt, note: "Cash deduction outside trade P/L" },
      { category: "Unknown manual-trade fees", amount: 0, note: "Two 24 Jun manual trades have unavailable commission/SST/CDC fields" },
    ],
    highestCostOrders: orders
      .map((o) => ({
        date: o.date,
        orderNo: o.orderNo,
        side: o.side,
        tickers: o.tickersText,
        gross: o.gross,
        fees: o.fees,
        feePct: o.gross > 0 ? round2((o.fees / o.gross) * 100) : 0,
      }))
      .sort((a, b) => b.fees - a.fees)
      .slice(0, 8),
  };

  const yearMap = new Map<string, YearRow>();
  const ensureYear = (y: string) => {
    let row = yearMap.get(y);
    if (!row) {
      row = {
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
      };
      yearMap.set(y, row);
    }
    return row;
  };
  ["2023", "2024", "2025", "2026"].forEach(ensureYear);
  for (const d of stmt.deposits) ensureYear((d.date ?? "????").slice(0, 4)).deposits += d.amount;
  for (const t of stmt.trades) {
    const row = ensureYear((t.date ?? "????").slice(0, 4));
    if (t.side === "BUY") {
      row.buys += t.net;
      row.buyLines += 1;
    } else {
      row.sells += t.net;
      row.sellLines += 1;
    }
    row.tradingCharges += t.fees;
    row.friction += t.fees;
    row.tradeCount += 1;
  }
  for (const order of orders) {
    const row = ensureYear((order.date ?? "????").slice(0, 4));
    if (order.side === "BUY") row.buyOrders += 1;
    else row.sellOrders += 1;
  }
  for (const sale of sales) ensureYear((sale.date ?? "????").slice(0, 4)).realizedPl += sale.realized;
  for (const c of stmt.charges) {
    const row = ensureYear((c.date ?? "????").slice(0, 4));
    if (c.kind === "CGT") row.cgtTariffs += c.amount;
    else row.accountCharges += c.amount;
    row.friction += c.amount;
  }
  for (const a of adjustments) {
    const year = (a.type === "MERGER_CONVERSION" ? a.sortDate : a.date).slice(0, 4);
    const row = ensureYear(year);
    if (a.type === "IPO_ALLOTMENT") row.manualExternalAcquisitions += a.grossValue;
    if (a.type === "MANUAL_PURCHASE") row.buys += a.grossValue;
  }
  for (const row of yearMap.values()) {
    row.netCapitalDeployed = row.buys - row.sells;
    if (row.year === (endDate ?? "").slice(0, 4)) row.endingNetWorth = netWorth;
  }
  const byYear = [...yearMap.values()]
    .map((r) => ({
      ...r,
      deposits: round2(r.deposits),
      manualExternalAcquisitions: round2(r.manualExternalAcquisitions),
      buys: round2(r.buys),
      sells: round2(r.sells),
      netCapitalDeployed: round2(r.netCapitalDeployed),
      realizedPl: round2(r.realizedPl),
      tradingCharges: round2(r.tradingCharges),
      accountCharges: round2(r.accountCharges),
      cgtTariffs: round2(r.cgtTariffs),
      friction: round2(r.friction),
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const depositDates = stmt.deposits
    .map((d) => d.date)
    .filter((d): d is string => !!d)
    .sort();
  const lags: number[] = [];
  let within24h = 0;
  const brokerBuys = stmt.trades.filter((t) => t.side === "BUY" && t.date);
  for (const b of brokerBuys) {
    let prior: string | null = null;
    for (const dd of depositDates) {
      if (dd <= b.date!) prior = dd;
      else break;
    }
    if (prior) {
      const lag = daysBetween(prior, b.date!);
      lags.push(lag);
      if (lag <= 1) within24h += 1;
    }
  }
  lags.sort((a, b) => a - b);
  const deployment: DeploymentSummary = {
    avgDaysDepositToBuy: lags.length ? round2(lags.reduce((s, x) => s + x, 0) / lags.length) : null,
    medianDaysDepositToBuy: lags.length ? lags[Math.floor(lags.length / 2)] : null,
    buysWithin24h: within24h,
    buysTotal: brokerBuys.length,
    pctDeployedWithin24h: brokerBuys.length ? round2((within24h / brokerBuys.length) * 100) : null,
    largestIdleCashDays: lags.length ? Math.max(...lags) : null,
    saleProceedsLeftUninvested: cashBalance > 0 ? round2(cashBalance) : 0,
    pctCapitalCurrentlyCash: netWorth > 0 ? round2((cashBalance / netWorth) * 100) : null,
  };

  const priced = costBasis.filter((r) => r.marketValue !== null);
  const sectorMap = new Map<string, number>();
  for (const r of priced) sectorMap.set(r.sector, (sectorMap.get(r.sector) ?? 0) + (r.marketValue ?? 0));
  const sectorWeights = [...sectorMap.entries()]
    .map(([sector, value]) => ({ sector, weightPct: marketValue > 0 ? round2((value / marketValue) * 100) : 0 }))
    .sort((a, b) => b.weightPct - a.weightPct);
  const hhi =
    round2(
      priced.reduce((s, r) => {
        const w = (r.marketValue ?? 0) / (marketValue || 1);
        return s + w * w;
      }, 0) * 100
    ) / 100;
  const top2Banks = priced
    .filter((r) => r.sector === "Commercial Banks")
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .slice(0, 2)
    .reduce((s, r) => s + (r.weightPct ?? 0), 0);
  const topTwo = [...priced].sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)).slice(0, 2);
  const dropPct = 11;
  const concentration: ConcentrationSummary = {
    topHolding: priced[0] ? { ticker: priced[0].ticker, weightPct: priced[0].weightPct ?? 0 } : null,
    top2BanksWeightPct: round2(top2Banks),
    sectorWeights,
    hhi,
    positionsBelow1pct: priced.filter((r) => (r.weightPct ?? 0) < 1).length,
    positionsBelow3pct: priced.filter((r) => (r.weightPct ?? 0) < 3).length,
    smallTailWeightPct: round2(priced.filter((r) => (r.weightPct ?? 0) < 3).reduce((s, r) => s + (r.weightPct ?? 0), 0)),
    topTwoShock: topTwo.length
      ? {
          dropPct,
          portfolioImpactPct: round2(topTwo.reduce((s, r) => s + (r.weightPct ?? 0), 0) * (dropPct / 100)),
        }
      : null,
  };

  const normalizedEvents = [
    ...stmt.entries.map(toEntryEvent).filter((e): e is NormalizedLedgerEvent => !!e),
    ...stmt.trades.map(toTradeEvent),
    ...adjustments.map(toAdjustmentEvent),
  ].sort((a, b) => (eventDate(a) ?? "9999-12-31").localeCompare(eventDate(b) ?? "9999-12-31") || a.id.localeCompare(b.id));

  const positionBuild: PositionBuildRow[] = costBasis.map((row) => {
    const p = positions.get(row.ticker);
    const holdingAge =
      p?.lots.length && endDate
        ? round2(
            p.lots.reduce((s, lot) => s + (lot.date ? daysBetween(lot.date, endDate) * lot.quantity : 0), 0) /
              Math.max(p.lots.reduce((s, lot) => s + lot.quantity, 0), 1)
          )
        : null;
    return {
      ticker: row.ticker,
      firstAcquisitionDate: p?.firstAcquisitionDate ?? null,
      latestAcquisitionDate: p?.latestAcquisitionDate ?? null,
      purchaseCount: p?.purchaseCount ?? 0,
      totalQuantityAcquired: round2(p?.acquiredQty ?? 0),
      quantitySold: round2(p?.soldQty ?? 0),
      corporateActionQuantity: round2(p?.corporateActionQty ?? 0),
      currentQuantity: row.quantity,
      lowestPurchasePrice: p?.lowestPurchasePrice ?? null,
      highestPurchasePrice: p?.highestPurchasePrice ?? null,
      weightedAverageCost: row.avgCost,
      currentPrice: row.currentPrice,
      averageHoldingAgeDays: holdingAge,
      amountInvested: row.totalInvested,
      currentValue: row.marketValue,
      unrealizedPl: row.unrealizedPl,
    };
  });

  const brokerInventory = new Map(stmt.inventory.map((i) => [i.ticker, i.quantity]));
  const expectedQuantities = includeAdjustments
    ? EXPECTED_CURRENT_QUANTITIES
    : Object.fromEntries(stmt.inventory.map((i) => [i.ticker, i.quantity]));
  const quantityReconciliation: QuantityReconciliationRow[] = Object.entries(expectedQuantities)
    .map(([ticker, expectedQuantity]) => {
      const brokerNetQuantity = round2(brokerPositions.get(ticker)?.quantity ?? 0);
      const adjustedQuantity = round2(positions.get(ticker)?.quantity ?? 0);
      const corporateActionAdjustment =
        ticker === "UBL"
          ? 177
          : ticker === "FFC"
            ? 23
            : 0;
      const externalAcquisitionQuantity =
        adjustments
          .filter((a): a is Extract<ConfirmedAdjustment, { type: "IPO_ALLOTMENT" }> => a.type === "IPO_ALLOTMENT" && a.ticker === ticker)
          .reduce((s, a) => s + a.quantity, 0);
      const manualPurchaseQuantity =
        adjustments
          .filter((a): a is Extract<ConfirmedAdjustment, { type: "MANUAL_PURCHASE" }> => a.type === "MANUAL_PURCHASE" && a.ticker === ticker)
          .reduce((s, a) => s + a.quantity, 0);
      const difference = round2(adjustedQuantity - expectedQuantity);
      return {
        ticker,
        brokerNetQuantity,
        brokerInventoryQuantity: brokerInventory.get(ticker) ?? null,
        corporateActionAdjustment,
        externalAcquisitionQuantity,
        manualPurchaseQuantity,
        expectedQuantity,
        currentPlatformQuantity: null,
        difference,
        status: Math.abs(difference) < 0.0001 ? "Reconciled" : "Difference",
      } satisfies QuantityReconciliationRow;
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const brokerBuyLines = stmt.trades.filter((t) => t.side === "BUY").length;
  const brokerSellLines = stmt.trades.filter((t) => t.side === "SELL").length;
  const brokerBuyOrders = new Set(stmt.trades.filter((t) => t.side === "BUY").map((t) => `${t.date}-${t.ref}`)).size;
  const brokerSellOrders = new Set(stmt.trades.filter((t) => t.side === "SELL").map((t) => `${t.date}-${t.ref}`)).size;
  const wealthBridgeBase = round2(totalDeposited + realizedPl + unrealizedPl - accountFees - cgt);
  const wealthBridgeDifferenceRaw = round2(netWorth - wealthBridgeBase);
  const wealthBridgeDifference = Math.abs(wealthBridgeDifferenceRaw) <= 0.01 ? 0 : wealthBridgeDifferenceRaw;
  const checkpoints: LedgerCheckpointSummary = {
    externalBrokerDepositsImported: stmt.deposits.length,
    brokerBuyLinesImported: brokerBuyLines,
    brokerBuyOrdersImported: brokerBuyOrders,
    brokerSellLinesImported: brokerSellLines,
    brokerSellOrdersImported: brokerSellOrders,
    manualPurchasesApplied: adjustments.filter((a) => a.type === "MANUAL_PURCHASE").length,
    ipoAcquisitionsApplied: adjustments.filter((a) => a.type === "IPO_ALLOTMENT").length,
    stockSplitsApplied: adjustments.filter((a) => a.type === "STOCK_SPLIT").length,
    mergerConversionsApplied: adjustments.filter((a) => a.type === "MERGER_CONVERSION").length,
    currentHoldingsReconciled: quantityReconciliation.filter((r) => Math.abs(r.difference ?? 0) < 0.0001).length,
    unexplainedQuantityDifferences: quantityReconciliation.filter((r) => Math.abs(r.difference ?? 0) >= 0.0001).length,
    expectedTotalQuantity: quantityReconciliation.reduce((s, r) => s + r.expectedQuantity, 0),
    tradingFeesExtracted: tradeFeesTotal,
    accountChargesExtracted: stmt.charges.filter((c) => c.kind === "FEE").length,
    cgtEntriesExtracted: stmt.charges.filter((c) => c.kind === "CGT").length,
    dividendRecordsLinked: options.linkedDividendRecords ?? 0,
    unknownTransactionFeeFields: adjustments.filter((a) => a.type === "MANUAL_PURCHASE").length * 3,
    xirrCashFlowCount: cashflows.length,
    wealthBridgeDifference,
  };

  const wealthBridge: WealthBridgeComponent[] = [
    { label: "External capital contributed", value: totalDeposited, kind: "start", includedInReconciliation: true, note: "Broker deposits plus confirmed external IPO acquisitions" },
    { label: "Realised trading P/L", value: realizedPl, kind: realizedPl >= 0 ? "increase" : "decrease", includedInReconciliation: true, note: "Net sale proceeds less weighted-average cost sold" },
    { label: "Unrealised P/L", value: unrealizedPl, kind: unrealizedPl >= 0 ? "increase" : "decrease", includedInReconciliation: true, note: "Current market value less adjusted remaining cost basis" },
    { label: "Account and maintenance charges", value: -accountFees, kind: "decrease", includedInReconciliation: true, note: "Broker cash deductions outside trade P/L" },
    { label: "CGT and tariffs", value: -cgt, kind: "decrease", includedInReconciliation: true, note: "Broker cash deductions outside trade P/L" },
    { label: "Trade fees audit", value: tradeFeesTotal, kind: "audit", includedInReconciliation: false, note: "Already embedded in realised and unrealised P/L; not subtracted twice" },
    { label: "Current net worth", value: netWorth, kind: "end", includedInReconciliation: true, note: "Adjusted market value plus adjusted broker cash" },
  ];
  if (Math.abs(wealthBridgeDifference) >= 0.01) {
    wealthBridge.splice(5, 0, {
      label: "Unreconciled difference",
      value: wealthBridgeDifference,
      kind: wealthBridgeDifference >= 0 ? "increase" : "decrease",
      includedInReconciliation: true,
      note: "Shown because the bridge does not exactly tie to current net worth",
    });
  }

  const timeline = buildTimeline(normalizedEvents, netWorth);
  const source: LedgerSource =
    options.source ??
    {
      type: "akd_statement",
      label: "AKD Statement Of Account",
      status: "complete",
      detail: "Parsed from the full AKD broker ledger and validated against cash and inventory controls.",
    };

  return {
    source,
    returns,
    costBasis,
    friction,
    byYear,
    deployment,
    concentration,
    sales,
    normalizedEvents,
    positionBuild,
    quantityReconciliation,
    checkpoints,
    wealthBridge,
    timeline,
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
          "Drawdown analysis requires a continuous historical portfolio-value series; the broker ledger alone supplies trades, not daily valuation history.",
      },
    },
    benchmark: null,
  };
}
