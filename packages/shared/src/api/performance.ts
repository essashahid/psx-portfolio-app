/**
 * The contract for GET /api/portfolio/performance.
 *
 * A focused subset of the engine's LedgerAnalytics. That type carries the full
 * ledger rebuild, thousands of rows of it, and none of the phone screens read
 * more than the headline figures, so shipping the whole blob over a mobile
 * connection would be waste with a maintenance cost attached.
 *
 * xirrStatus is carried through deliberately rather than sending a bare null:
 * "we could not compute this, and here is why" is a different statement from
 * "your return is zero", and the screen says which one it means.
 */

export interface PerformanceReturns {
  totalDeposited: number;
  netWorth: number;
  marketValue: number;
  cashBalance: number;
  totalGain: number;
  totalReturnPct: number;
  xirrPct: number | null;
  xirrStatus: "calculated" | "unavailable";
  xirrFailureReason: string | null;
  holdingPeriodYears: number;
  realizedPl: number;
  unrealizedPl: number;
  startDate: string | null;
  endDate: string | null;
}

export interface PerformanceFriction {
  total: number;
  tradeFeesTotal: number;
  cgt: number;
  accountFees: number;
  /** Friction as a share of everything paid in, 0 to 100. */
  pctOfDeposits: number;
  pctOfGains: number | null;
}

export interface PerformanceConcentration {
  topHolding: { ticker: string; weightPct: number } | null;
  /** Herfindahl index of position weights. Higher means more concentrated. */
  hhi: number;
  sectorWeights: { sector: string; weightPct: number }[];
  positionsBelow1pct: number;
}

/**
 * Where the numbers came from and how complete that source is. The screen
 * shows this rather than presenting a reconstruction from an incomplete
 * statement as though it were settled fact.
 */
export interface PerformanceSource {
  type: "akd_statement" | "local_akd_pdf" | "database_fallback";
  label: string;
  status: "complete" | "incomplete" | "reconciled";
  detail: string;
}

/** One month on the benchmark path. Every figure is in rupees. */
export interface BenchmarkPoint {
  date: string;
  /** Cash you put in by this date. */
  contributed: number;
  portfolio: number;
  /** What the same contributions would be worth in the index. */
  kse100: number;
  /** What they would need to be worth to have kept their purchasing power. */
  inflation: number;
}

export interface PerformanceResponse {
  /** Null when there is no ledger to analyse yet, rather than a zeroed object. */
  returns: PerformanceReturns | null;
  friction: PerformanceFriction | null;
  concentration: PerformanceConcentration | null;
  /**
   * Net worth over time, oldest first. Points the engine could not value are
   * dropped rather than sent as null, so a chart can read this directly.
   */
  timeline: { date: string; netWorth: number }[];
  /**
   * Your book against the KSE-100 and against inflation, on one path.
   *
   * This is the app's central claim — that you can see whether holding these
   * companies beat simply owning the index — so it travels to the phone even
   * though the wider audit tables do not.
   */
  benchmark: {
    asOf: string;
    /** Portfolio minus the KSE-100 equivalent. Positive means you are ahead. */
    excessVsKse100: number;
    excessVsInflation: number;
    maxDrawdownPct: number | null;
    series: BenchmarkPoint[];
  } | null;
  source: PerformanceSource | null;
}
