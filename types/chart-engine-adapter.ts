import type { CanonicalOHLCV, ChartDrawing } from "@psx/shared/chart-engine";

/**
 * The contract the klinecharts workstation is built against. It takes an
 * HTMLElement and returns data URLs, so it stays web side; the data shapes it
 * moves are in @psx/shared/chart-engine, which the mobile app also reads.
 */
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
