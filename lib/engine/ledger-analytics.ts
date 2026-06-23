// Ledger analytics engine.
//
// Everything here is derived purely from a parsed AKD Statement Of Account:
// dated trades (cost basis), dated deposits (cashflows for money-weighted
// return), and the closing Inventory Position (current prices + net worth).
// No market-data API or external history is required, and every headline can
// be cross-checked against the statement's own control totals.
//
// Scope note: this engine answers the quantitative questions the ledger fully
// determines on its own. Decision replay, counterfactuals vs an index,
// behavioural-bias detection and the natural-language historian additionally
// need historical price series / news / a benchmark and are intentionally not
// here.

import type { AkdStatement, AkdTrade } from "@/lib/import/akd-statement";

// PSX transaction-cost assumptions for forward-looking "if sold today" math.
// Historical fills carry their real costs; these only estimate a future sale.
const SELL_COST_RATE = 0.0018; // ~0.15% commission + 18% SST on it + small CDC
const CGT_RATE = 0.15; // capital gains tax on net gain (filer rate)

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

function sectorOf(ticker: string): string {
  return SECTORS[ticker] ?? "Other";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Money-weighted return (XIRR)
// ---------------------------------------------------------------------------

interface Cashflow {
  date: string; // ISO
  amount: number; // contributions negative, terminal value positive
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

  // Newton's method
  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(rate);
    const d = dNpv(rate);
    if (Math.abs(d) < 1e-10) break;
    const next = rate - v / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) return round2(next * 100); // annual %
    rate = next;
  }

  // Bisection fallback over a wide bracket
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return round2(mid * 100); // annual %
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return round2(((lo + hi) / 2) * 100); // annual %
}

// ---------------------------------------------------------------------------
// Position rebuild with per-sale realized P/L (weighted-average cost)
// ---------------------------------------------------------------------------

interface Position {
  ticker: string;
  quantity: number;
  totalCost: number; // remaining cost basis of open shares
  avgCost: number;
}

export interface RealizedSale {
  date: string | null;
  ticker: string;
  quantity: number;
  proceeds: number; // net of the fees actually paid on the sale
  costOut: number;
  realized: number;
}

function rebuild(trades: AkdTrade[]): {
  positions: Map<string, Position>;
  sales: RealizedSale[];
} {
  const sorted = [...trades].sort((a, b) =>
    (a.date ?? "9999").localeCompare(b.date ?? "9999")
  );
  const positions = new Map<string, Position>();
  const sales: RealizedSale[] = [];
  for (const t of sorted) {
    const p =
      positions.get(t.ticker) ?? { ticker: t.ticker, quantity: 0, totalCost: 0, avgCost: 0 };
    if (t.side === "BUY") {
      p.quantity += t.quantity;
      p.totalCost += t.net; // ledger net includes commission + SST + CDC
      p.avgCost = p.quantity > 0 ? p.totalCost / p.quantity : 0;
    } else {
      const sellQty = Math.min(t.quantity, p.quantity);
      const costOut = p.avgCost * sellQty;
      sales.push({
        date: t.date,
        ticker: t.ticker,
        quantity: t.quantity,
        proceeds: t.net,
        costOut: round2(costOut),
        realized: round2(t.net - costOut),
      });
      p.quantity -= sellQty;
      p.totalCost -= costOut;
      if (p.quantity <= 0) {
        p.quantity = 0;
        p.totalCost = 0;
        p.avgCost = 0;
      }
    }
    positions.set(t.ticker, p);
  }
  return { positions, sales };
}

// ---------------------------------------------------------------------------
// Returns: money-weighted, total, realized vs unrealized, net of friction
// ---------------------------------------------------------------------------

export interface ReturnsSummary {
  totalDeposited: number;
  netWorth: number;
  marketValue: number;
  cashBalance: number;
  totalGain: number;
  totalReturnPct: number; // gain / deposited
  xirrPct: number | null; // money-weighted annual return
  holdingPeriodYears: number;
  realizedPl: number;
  unrealizedPl: number;
  totalFriction: number; // all commissions, taxes, CDC, CGT, account fees
}

// ---------------------------------------------------------------------------
// Cost basis per current holding
// ---------------------------------------------------------------------------

export interface CostBasisRow {
  ticker: string;
  sector: string;
  quantity: number;
  avgCost: number;
  totalInvested: number; // remaining cost basis
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
  breakEvenPrice: number | null; // price that recovers cost after sell costs
  profitIfSoldToday: number | null; // after estimated CGT + sell fees
  weightPct: number | null;
}

// ---------------------------------------------------------------------------
// Friction autopsy
// ---------------------------------------------------------------------------

export interface FrictionSummary {
  commission: number;
  sst: number;
  cdc: number;
  tradeFeesTotal: number; // commission + sst + cdc on trades
  cgt: number;
  accountFees: number;
  total: number;
  pctOfDeposits: number;
  pctOfGains: number | null;
  perTicker: { ticker: string; fees: number; trades: number }[];
  bySize: { bucket: string; trades: number; avgGross: number; avgFeePct: number }[];
}

// ---------------------------------------------------------------------------
// Performance by year
// ---------------------------------------------------------------------------

export interface YearRow {
  year: string;
  deposits: number;
  buys: number;
  sells: number;
  realizedPl: number;
  friction: number;
  tradeCount: number;
}

// ---------------------------------------------------------------------------
// Capital deployment
// ---------------------------------------------------------------------------

export interface DeploymentSummary {
  avgDaysDepositToBuy: number | null;
  medianDaysDepositToBuy: number | null;
  buysWithin24h: number;
  buysTotal: number;
  pctDeployedWithin24h: number | null;
}

// ---------------------------------------------------------------------------
// Concentration / "one decision away"
// ---------------------------------------------------------------------------

export interface ConcentrationSummary {
  topHolding: { ticker: string; weightPct: number } | null;
  top2BanksWeightPct: number;
  sectorWeights: { sector: string; weightPct: number }[];
  hhi: number; // Herfindahl index, 0..1
  positionsBelow1pct: number;
  positionsBelow3pct: number;
  smallTailWeightPct: number; // combined weight of sub-3% positions
  topTwoShock: { dropPct: number; portfolioImpactPct: number } | null;
}

export interface LedgerAnalytics {
  returns: ReturnsSummary;
  costBasis: CostBasisRow[];
  friction: FrictionSummary;
  byYear: YearRow[];
  deployment: DeploymentSummary;
  concentration: ConcentrationSummary;
  sales: RealizedSale[];
}

export function analyzeLedger(stmt: AkdStatement): LedgerAnalytics {
  const { positions, sales } = rebuild(stmt.trades);
  const priceByTicker = new Map(stmt.inventory.map((i) => [i.ticker, i.closingRate]));

  const totalDeposited = round2(stmt.deposits.reduce((s, d) => s + d.amount, 0));
  const marketValue = round2(stmt.inventory.reduce((s, i) => s + i.amount, 0));
  const cashBalance = stmt.controls.ledgerBalance ?? 0;
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

  // ---- Cost basis per current holding ----
  // The Inventory Position is the source of truth for current quantity and
  // market value; the rebuilt position is the source of truth for cash
  // invested. Where they differ it is a corporate action (bonus/merger): the
  // extra shares cost nothing, so they correctly lower the effective avg cost.
  const invAmount = new Map(stmt.inventory.map((i) => [i.ticker, i.amount]));
  const costBasis: CostBasisRow[] = [];
  for (const inv of stmt.inventory) {
    const ticker = inv.ticker;
    const qty = inv.quantity;
    if (qty <= 0) continue;
    const p = positions.get(ticker);
    const totalInvested = p && p.totalCost > 0 ? round2(p.totalCost) : 0;
    const avgCost = totalInvested > 0 ? round2(totalInvested / qty) : 0;
    const currentPrice = priceByTicker.get(ticker) ?? null;
    const mv = invAmount.get(ticker) ?? (currentPrice !== null ? round2(qty * currentPrice) : null);
    // For all-bonus positions (no cash invested) the whole market value is gain.
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
      ticker,
      sector: sectorOf(ticker),
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

  const unrealizedPl = round2(
    costBasis.reduce((s, r) => s + (r.unrealizedPl ?? 0), 0)
  );
  const totalGain = round2(netWorth - totalDeposited);

  // ---- Returns ----
  const dates = stmt.entries.map((e) => e.date).filter((d): d is string => !!d).sort();
  const endDate = stmt.account.toDate ?? dates[dates.length - 1] ?? null;
  const startDate = dates[0] ?? null;
  const holdingPeriodYears =
    startDate && endDate ? round2(daysBetween(startDate, endDate) / 365) : 0;
  const cashflows: Cashflow[] = stmt.deposits.map((d) => ({
    date: d.date ?? endDate ?? "",
    amount: -d.amount,
  }));
  if (endDate) cashflows.push({ date: endDate, amount: netWorth });
  const returns: ReturnsSummary = {
    totalDeposited,
    netWorth,
    marketValue,
    cashBalance: round2(cashBalance),
    totalGain,
    totalReturnPct: totalDeposited > 0 ? round2((totalGain / totalDeposited) * 100) : 0,
    xirrPct: xirr(cashflows),
    holdingPeriodYears,
    realizedPl,
    unrealizedPl,
    totalFriction,
  };

  // ---- Friction autopsy ----
  const perTickerMap = new Map<string, { fees: number; trades: number }>();
  for (const t of stmt.trades) {
    const e = perTickerMap.get(t.ticker) ?? { fees: 0, trades: 0 };
    e.fees += t.fees;
    e.trades += 1;
    perTickerMap.set(t.ticker, e);
  }
  const buckets = [
    { bucket: "< 5,000", min: 0, max: 5000 },
    { bucket: "5,000–20,000", min: 5000, max: 20000 },
    { bucket: "20,000–50,000", min: 20000, max: 50000 },
    { bucket: "> 50,000", min: 50000, max: Infinity },
  ];
  const bySize = buckets
    .map((b) => {
      const inBucket = stmt.trades.filter((t) => t.gross >= b.min && t.gross < b.max);
      const avgGross = inBucket.length
        ? round2(inBucket.reduce((s, t) => s + t.gross, 0) / inBucket.length)
        : 0;
      const avgFeePct = inBucket.length
        ? round2(
            (inBucket.reduce((s, t) => s + (t.gross > 0 ? t.fees / t.gross : 0), 0) /
              inBucket.length) *
              100
          )
        : 0;
      return { bucket: b.bucket, trades: inBucket.length, avgGross, avgFeePct };
    })
    .filter((b) => b.trades > 0);
  const grossProfit = realizedPl + unrealizedPl;
  const friction: FrictionSummary = {
    commission: tradeCommission,
    sst: tradeSst,
    cdc: tradeCdc,
    tradeFeesTotal,
    cgt,
    accountFees,
    total: totalFriction,
    pctOfDeposits: totalDeposited > 0 ? round2((totalFriction / totalDeposited) * 100) : 0,
    pctOfGains: grossProfit > 0 ? round2((totalFriction / grossProfit) * 100) : null,
    perTicker: [...perTickerMap.entries()]
      .map(([ticker, v]) => ({ ticker, fees: round2(v.fees), trades: v.trades }))
      .sort((a, b) => b.fees - a.fees),
    bySize,
  };

  // ---- Performance by year ----
  const yearMap = new Map<string, YearRow>();
  const getYear = (date: string | null) => date?.slice(0, 4) ?? "?";
  const ensureYear = (y: string) => {
    let row = yearMap.get(y);
    if (!row) {
      row = { year: y, deposits: 0, buys: 0, sells: 0, realizedPl: 0, friction: 0, tradeCount: 0 };
      yearMap.set(y, row);
    }
    return row;
  };
  for (const d of stmt.deposits) ensureYear(getYear(d.date)).deposits += d.amount;
  for (const t of stmt.trades) {
    const row = ensureYear(getYear(t.date));
    if (t.side === "BUY") row.buys += t.net;
    else row.sells += t.net;
    row.friction += t.fees;
    row.tradeCount += 1;
  }
  for (const s of sales) ensureYear(getYear(s.date)).realizedPl += s.realized;
  for (const c of stmt.charges) ensureYear(getYear(c.date)).friction += c.amount;
  const byYear = [...yearMap.values()]
    .map((r) => ({
      ...r,
      deposits: round2(r.deposits),
      buys: round2(r.buys),
      sells: round2(r.sells),
      realizedPl: round2(r.realizedPl),
      friction: round2(r.friction),
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  // ---- Capital deployment ----
  const depositDates = stmt.deposits
    .map((d) => d.date)
    .filter((d): d is string => !!d)
    .sort();
  const lags: number[] = [];
  let within24h = 0;
  const buys = stmt.trades.filter((t) => t.side === "BUY" && t.date);
  for (const b of buys) {
    // most recent deposit at or before the buy date
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
    buysTotal: buys.length,
    pctDeployedWithin24h: buys.length ? round2((within24h / buys.length) * 100) : null,
  };

  // ---- Concentration ----
  const priced = costBasis.filter((r) => r.marketValue !== null);
  const sectorMap = new Map<string, number>();
  for (const r of priced) sectorMap.set(r.sector, (sectorMap.get(r.sector) ?? 0) + (r.marketValue ?? 0));
  const sectorWeights = [...sectorMap.entries()]
    .map(([sector, value]) => ({ sector, weightPct: marketValue > 0 ? round2((value / marketValue) * 100) : 0 }))
    .sort((a, b) => b.weightPct - a.weightPct);
  const hhi = round2(
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
  const topTwoShock = topTwo.length
    ? {
        dropPct,
        portfolioImpactPct: round2(
          topTwo.reduce((s, r) => s + (r.weightPct ?? 0), 0) * (dropPct / 100)
        ),
      }
    : null;
  const concentration: ConcentrationSummary = {
    topHolding: priced[0] ? { ticker: priced[0].ticker, weightPct: priced[0].weightPct ?? 0 } : null,
    top2BanksWeightPct: round2(top2Banks),
    sectorWeights,
    hhi,
    positionsBelow1pct: priced.filter((r) => (r.weightPct ?? 0) < 1).length,
    positionsBelow3pct: priced.filter((r) => (r.weightPct ?? 0) < 3).length,
    smallTailWeightPct: round2(
      priced.filter((r) => (r.weightPct ?? 0) < 3).reduce((s, r) => s + (r.weightPct ?? 0), 0)
    ),
    topTwoShock,
  };

  return { returns, costBasis, friction, byYear, deployment, concentration, sales };
}
