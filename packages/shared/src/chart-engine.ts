/**
 * Chart data shapes shared by the web app and the mobile app.
 *
 * The engine adapter interface that consumes these lives in
 * types/chart-engine-adapter.ts: it is typed against HTMLElement and drives
 * klinecharts, so it is web only.
 */

export interface CanonicalOHLCV {
  symbol: string;
  exchange: string;
  resolution: string;
  timezone: string;
  bars: Array<{
    time: number; // Unix timestamp
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjustedClose?: number;
    adjustmentFactor?: number;
    source?: string;
    status: "verified" | "unverified" | "missing";
  }>;
  latestMarketDate: string;
  refreshedAt: string;
  adjustmentStatus: string;
  dataQuality: string;
}

export interface ChartDrawing {
  id: string;
  type: string;
  origin: "user" | "system";
  symbol: string;
  resolution: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  points: any[]; // Engine-specific point format mapped externally
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style: Record<string, any>;
  locked: boolean;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}
