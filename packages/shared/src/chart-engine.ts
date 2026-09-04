/**
 * Chart data shapes shared by the web app and the mobile app.
 *
 * The web-side ChartEngineAdapter interface that consumed these was deleted in
 * September 2026 along with the klinecharts technicals workstation, its only
 * implementation. These shapes currently have no importer.
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
