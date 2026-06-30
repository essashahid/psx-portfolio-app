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
  points: any[]; // Engine-specific point format mapped externally
  style: Record<string, any>;
  locked: boolean;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChartEngineAdapter {
  initializeChart(container: HTMLElement, options?: any): void;
  destroyChart(): void;
  setSymbol(symbol: string): void;
  setChartType(type: "candlestick" | "ohlc" | "line" | "area"): void;
  setResolution(resolution: string): void;
  setDateRange(range: string): void;
  setOHLCVData(data: CanonicalOHLCV): void;
  updateLatestBar(bar: CanonicalOHLCV["bars"][number]): void;
  addIndicator(name: string, options?: any): string; // returns indicator ID
  updateIndicator(id: string, options: any): void;
  removeIndicator(id: string): void;
  addDrawing(drawing: ChartDrawing): void;
  updateDrawing(id: string, updates: Partial<ChartDrawing>): void;
  removeDrawing(id: string): void;
  lockDrawing(id: string, locked: boolean): void;
  hideDrawing(id: string, hidden: boolean): void;
  addComparisonSeries(symbol: string, data: any[]): string; // returns series ID
  removeComparisonSeries(id: string): void;
  addEventMarker(event: any): void;
  removeEventMarker(id: string): void;
  setEventVisibility(type: string, visible: boolean): void;
  saveLayoutState(): string; // returns serialized state
  loadLayoutState(state: string): void;
  resetLayout(): void;
  enterFullscreen(): void;
  exitFullscreen(): void;
  exportSnapshot(): string | Promise<string>; // returns data URL
  subscribeToChartEvents(events: any): void;
  getVisibleRange(): { from: number; to: number };
  getActiveIndicators(): any[];
  getActiveDrawings(): ChartDrawing[];
}
