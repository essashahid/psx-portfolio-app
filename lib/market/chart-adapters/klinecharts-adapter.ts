import { init, dispose, Chart, KLineData, OverlayCreate, IndicatorCreate } from "klinecharts";
import type { ChartEngineAdapter, CanonicalOHLCV, ChartDrawing } from "@/types/chart-engine";

export class KLineChartsAdapter implements ChartEngineAdapter {
  private chart: Chart | null = null;
  private currentSymbol: string = "";
  private currentResolution: string = "1D";

  initializeChart(container: HTMLElement, options?: any): void {
    this.chart = init(container, options);
  }

  destroyChart(): void {
    if (this.chart) {
      dispose(this.chart);
      this.chart = null;
    }
  }

  setSymbol(symbol: string): void {
    this.currentSymbol = symbol;
  }

  setChartType(type: "candlestick" | "ohlc" | "line" | "area"): void {
    if (!this.chart) return;
    const styleMap: Record<string, import("klinecharts").CandleType> = {
      candlestick: "candle_solid",
      ohlc: "ohlc",
      line: "real_time",
      area: "real_time"
    };
    this.chart.setStyles({
      candle: {
        type: styleMap[type] || "candle_solid"
      }
    });
  }

  setResolution(resolution: string): void {
    this.currentResolution = resolution;
  }

  setDateRange(range: string): void {
    // KLineCharts handles range via scrolling/zooming.
    // For fixed ranges, you might need to adjust the visible range programmatically.
  }

  setOHLCVData(data: CanonicalOHLCV): void {
    if (!this.chart) return;
    
    // Map to KLineData format
    const klineData: KLineData[] = data.bars.map(bar => ({
      timestamp: bar.time, // Unix ms
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume
    }));
    
    this.chart.applyNewData(klineData);
  }

  updateLatestBar(bar: CanonicalOHLCV["bars"][number]): void {
    if (!this.chart) return;
    this.chart.updateData({
      timestamp: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume
    });
  }

  addIndicator(name: string, options?: any): string {
    if (!this.chart) return "";
    // KLineCharts has built-in indicators like MA, EMA, SMA, VOL, MACD, RSI, etc.
    const paneId = options?.paneId || "candle_pane"; // Use 'candle_pane' for main chart overlay, or create a new pane
    const isMain = options?.isMain ?? false;
    
    const indicatorOptions: IndicatorCreate = {
      name,
      calcParams: options?.calcParams,
      shortName: options?.shortName
    };
    
    return this.chart.createIndicator(indicatorOptions, isMain, options?.paneOptions);
  }

  updateIndicator(id: string, options: any): void {
    if (!this.chart) return;
    this.chart.overrideIndicator({ name: id, ...options });
  }

  removeIndicator(id: string): void {
    if (!this.chart) return;
    this.chart.removeIndicator("", id); // The pane id is needed in KLineCharts. This is a simplification.
  }

  addDrawing(drawing: ChartDrawing): void {
    if (!this.chart) return;
    // Map ChartDrawing to KLineCharts Overlay
    const overlay: OverlayCreate = {
      name: drawing.type, // e.g. 'rayLine', 'segment', 'horizontalLine'
      id: drawing.id,
      points: drawing.points,
      styles: drawing.style,
      lock: drawing.locked,
      visible: drawing.visible
    };
    this.chart.createOverlay(overlay);
  }

  updateDrawing(id: string, updates: Partial<ChartDrawing>): void {
    if (!this.chart) return;
    this.chart.overrideOverlay({
      id,
      ...updates
    } as any);
  }

  removeDrawing(id: string): void {
    if (!this.chart) return;
    this.chart.removeOverlay(id);
  }

  lockDrawing(id: string, locked: boolean): void {
    if (!this.chart) return;
    this.chart.overrideOverlay({ id, lock: locked });
  }

  hideDrawing(id: string, hidden: boolean): void {
    if (!this.chart) return;
    this.chart.overrideOverlay({ id, visible: !hidden });
  }

  addComparisonSeries(symbol: string, data: any[]): string {
    // KLineCharts requires custom logic or additional data tracks for comparison.
    return "";
  }

  removeComparisonSeries(id: string): void {}

  addEventMarker(event: any): void {
    if (!this.chart) return;
    // We can use createOverlay for custom event markers in KLineCharts.
  }

  removeEventMarker(id: string): void {}

  setEventVisibility(type: string, visible: boolean): void {}

  saveLayoutState(): string {
    // Needs complex serialization of drawings, indicators, styles
    return JSON.stringify({});
  }

  loadLayoutState(state: string): void {
    if (!this.chart) return;
    try {
      const parsed = JSON.parse(state);
      // apply parsed state
    } catch {}
  }

  resetLayout(): void {}

  enterFullscreen(): void {
    // Browser fullscreen API should be used on the container.
  }

  exitFullscreen(): void {}

  exportSnapshot(): string | Promise<string> {
    if (!this.chart) return "";
    return this.chart.getConvertPictureUrl(true, "jpeg", "transparent");
  }

  subscribeToChartEvents(events: any): void {
    if (!this.chart) return;
    this.chart.subscribeAction("onCrosshairChange", events.onCrosshairChange);
    // ...
  }

  getVisibleRange(): { from: number; to: number } {
    return { from: 0, to: 0 };
  }

  getActiveIndicators(): any[] { return []; }

  getActiveDrawings(): ChartDrawing[] { return []; }
}
