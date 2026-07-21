import { init, dispose, Chart, KLineData, OverlayCreate, IndicatorCreate, Period } from "klinecharts";
import type { ChartEngineAdapter, CanonicalOHLCV, ChartDrawing } from "@/types/chart-engine";

/** Resolution label from the chart header to a KLineCharts period. */
const PERIODS: Record<string, Period> = {
  "1D": { type: "day", span: 1 },
  "1W": { type: "week", span: 1 },
  "1M": { type: "month", span: 1 },
};

export class KLineChartsAdapter implements ChartEngineAdapter {
  private chart: Chart | null = null;
  private currentSymbol: string = "";
  private currentResolution: string = "1D";
  private _bars: import("klinecharts").KLineData[] = [];

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
    this.applyToChart();
  }

  /**
   * Push the current symbol, period and bars into the chart.
   *
   * KLineCharts v10 pulls data rather than being handed it: it calls the data
   * loader's getBars only once a symbol AND a period are set on the chart
   * instance. Registering a loader alone leaves the chart empty, which is what
   * happened here — the axis fell back to its default 0-10 range on every
   * stock. The loader has to be registered first so the load that setSymbol and
   * setPeriod trigger has something to read.
   */
  private applyToChart(): void {
    if (!this.chart || !this.currentSymbol || this._bars.length === 0) return;

    const bars = this.barsForResolution();
    this.chart.setDataLoader({
      getBars: ({ type, callback }) => {
        // The whole history is already in memory, so only the initial load has
        // anything to return. Paging requests must report no more data or the
        // chart keeps asking as the user scrolls back.
        if (type === "init") callback(bars, false);
        else callback([], false);
      },
    });
    this.chart.setSymbol({ ticker: this.currentSymbol, pricePrecision: 2, volumePrecision: 0 });
    this.chart.setPeriod(PERIODS[this.currentResolution] ?? PERIODS["1D"]);
  }

  /**
   * Daily bars rolled up to the selected resolution. The portal only serves
   * daily closes, so weekly and monthly views are aggregated here rather than
   * refetched — without this the 1W and 1M buttons change the axis but not the
   * data.
   */
  private barsForResolution(): KLineData[] {
    if (this.currentResolution === "1D") return this._bars;

    const keyOf = (ts: number): string => {
      const d = new Date(ts);
      if (this.currentResolution === "1M") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      // ISO-ish week key: year plus week index from the epoch, which is enough
      // to group consecutive days without a calendar library.
      return String(Math.floor(ts / (7 * 86400000)));
    };

    const out: KLineData[] = [];
    let currentKey: string | null = null;
    for (const bar of this._bars) {
      const key = keyOf(bar.timestamp);
      const last = out[out.length - 1];
      if (key !== currentKey || !last) {
        out.push({ ...bar });
        currentKey = key;
        continue;
      }
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume = (last.volume ?? 0) + (bar.volume ?? 0);
    }
    return out;
  }

  setChartType(type: "candlestick" | "ohlc" | "line" | "area"): void {
    if (!this.chart) return;
    const styleMap: Record<string, import("klinecharts").CandleType> = {
      candlestick: "candle_solid",
      ohlc: "ohlc",
      line: "area",
      area: "area"
    };
    this.chart.setStyles({
      candle: {
        type: styleMap[type] || "candle_solid"
      }
    });
  }

  setResolution(resolution: string): void {
    this.currentResolution = resolution;
    this.applyToChart();
  }

  setDateRange(range: string): void {
    // KLineCharts handles range via scrolling/zooming.
    // For fixed ranges, you might need to adjust the visible range programmatically.
  }

  setOHLCVData(data: CanonicalOHLCV): void {
    if (!this.chart) return;
    this._bars = data.bars.map(bar => ({
      timestamp: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume
    }));
    this.applyToChart();
  }

  updateLatestBar(bar: CanonicalOHLCV["bars"][number]): void {
    if (!this.chart) return;
    const updated: KLineData = {
      timestamp: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume
    };
    const last = this._bars[this._bars.length - 1];
    if (last && last.timestamp === updated.timestamp) {
      this._bars[this._bars.length - 1] = updated;
    } else {
      this._bars.push(updated);
    }
    this.applyToChart();
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
    
    return this.chart.createIndicator(indicatorOptions, { pane: options?.paneOptions }) ?? "";
  }

  updateIndicator(id: string, options: any): void {
    if (!this.chart) return;
    this.chart.overrideIndicator({ name: id, ...options });
  }

  removeIndicator(id: string): void {
    if (!this.chart) return;
    this.chart.removeIndicator({ id });
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
    this.chart.removeOverlay({ id });
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
