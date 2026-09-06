/**
 * The contract for GET /api/chart-data.
 *
 * The candles plus the two things that make a price chart yours rather than
 * generic: where your cost basis sits, and where you actually traded.
 */

export interface ChartCandle {
  date: string;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface ChartTrade {
  date: string;
  type: string;
  quantity: number | null;
  price: number | null;
}

export interface ChartDividend {
  date: string;
  amount: number;
}

export interface ChartDataResponse {
  ticker: string;
  period: string;
  candles: ChartCandle[];
  /** Null when the ticker is not held. */
  avgCost: number | null;
  dividends: ChartDividend[];
  transactions: ChartTrade[];
  /**
   * True when a bonus or split event inside the period was detected and the
   * candles before it were back-adjusted into current share terms. The last
   * candle is always the price that actually traded.
   */
  adjusted: boolean;
  /** How many such events fall inside the returned candles. */
  breaks: number;
}
