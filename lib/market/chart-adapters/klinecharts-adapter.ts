import { init, dispose, Chart, KLineData, OverlayCreate, IndicatorCreate, Period } from "klinecharts";
import type { ChartEngineAdapter, CanonicalOHLCV, ChartDrawing } from "@/types/chart-engine";

/** Resolution label from the chart header to a KLineCharts period. */
const PERIODS: Record<string, Period> = {
  "1D": { type: "day", span: 1 },
  "1W": { type: "week", span: 1 },
  "1M": { type: "month", span: 1 },
};

/**
 * Indicators that belong ON the price pane rather than in their own pane
 * below. Without this routing, adding a moving average opened a brand new
 * pane, which is never what anyone means by "add MA".
 */
const PRICE_PANE_INDICATORS = new Set(["MA", "EMA", "SMA", "BOLL", "SAR", "BBI"]);

/**
 * Defaults for the parameters that matter to us. KLineCharts' own defaults
 * lean short-term (MA 5/10/30/60, RSI 6/12/24); the platform's language
 * everywhere else is MA 20/50/200 and RSI 14, so the chart should agree with
 * the rest of the app. VOL gets no params at all: its default 5/10/20 moving
 * averages drew three lines over a 90px pane of bars, which is where most of
 * the volume-pane clutter came from.
 */
const INDICATOR_PARAMS: Record<string, number[]> = {
  MA: [20, 50, 200],
  EMA: [21, 55],
  SMA: [20, 2],
  RSI: [14],
  VOL: [],
};

/**
 * Decimal places per indicator. KLineCharts defaults oscillators to four,
 * which renders an RSI as "55.2681" against a "72.0000" axis. Nobody reads an
 * RSI past the decimal point.
 */
const INDICATOR_PRECISION: Record<string, number> = {
  RSI: 1,
  MACD: 2,
  VOL: 0,
};

/** App palette: emerald price ink on a near-invisible slate scaffold. */
const COLOR = {
  line: "#059669",
  areaTop: "rgba(5, 150, 105, 0.14)",
  areaBottom: "rgba(5, 150, 105, 0.01)",
  up: "#059669",
  down: "#dc2626",
  noChange: "#64748b",
  text: "#64748b",
  grid: "rgba(100, 116, 139, 0.10)",
  axisLine: "rgba(100, 116, 139, 0.22)",
  crosshair: "#94a3b8",
};

export class KLineChartsAdapter implements ChartEngineAdapter {
  private chart: Chart | null = null;
  private currentSymbol: string = "";
  private currentResolution: string = "1D";
  private _bars: import("klinecharts").KLineData[] = [];
  private activeIndicators: string[] = [];
  private closeOnly = false;
  private container: HTMLElement | null = null;

  initializeChart(container: HTMLElement, options?: any): void {
    this.container = container;
    this.chart = init(container, options);
    this.applyBaseStyles();
  }

  /**
   * Restyle the default KLineCharts look (bright blue on loud grid) to match
   * the app: emerald ink, whisper-quiet grid, muted slate text. The canvas'
   * own "{ticker} · {period}" title is turned off because the workstation
   * header above the chart already says exactly that.
   */
  private applyBaseStyles(): void {
    if (!this.chart) return;
    this.chart.setStyles({
      grid: {
        horizontal: { color: COLOR.grid },
        vertical: { show: false },
      },
      candle: {
        bar: { upColor: COLOR.up, downColor: COLOR.down, noChangeColor: COLOR.noChange,
               upBorderColor: COLOR.up, downBorderColor: COLOR.down, noChangeBorderColor: COLOR.noChange,
               upWickColor: COLOR.up, downWickColor: COLOR.down, noChangeWickColor: COLOR.noChange },
        area: {
          lineColor: COLOR.line,
          lineSize: 2,
          smooth: true,
          backgroundColor: [
            { offset: 0, color: COLOR.areaBottom },
            { offset: 1, color: COLOR.areaTop },
          ],
          point: { color: COLOR.line },
        },
        priceMark: {
          last: { upColor: COLOR.up, downColor: COLOR.down, noChangeColor: COLOR.noChange },
        },
        tooltip: {
          title: { show: false },
          legend: { color: COLOR.text },
        },
      },
      indicator: {
        tooltip: { legend: { color: COLOR.text } },
      },
      xAxis: {
        axisLine: { color: COLOR.axisLine },
        tickText: { color: COLOR.text },
        tickLine: { show: false },
      },
      yAxis: {
        axisLine: { show: false },
        tickText: { color: COLOR.text },
        tickLine: { show: false },
      },
      separator: { color: COLOR.axisLine },
      crosshair: {
        horizontal: { line: { color: COLOR.crosshair }, text: { backgroundColor: "#334155" } },
        vertical: { line: { color: COLOR.crosshair }, text: { backgroundColor: "#334155" } },
      },
    });
  }

  /**
   * Close-only mode. PSX EOD data fakes open/high/low as the close, so the
   * default tooltip prints the same number four times and the high/low price
   * marks pin meaningless ticks to the plot. Collapse the tooltip to what is
   * actually known (date, price, volume) and hide the fake extremes.
   */
  setDataQuality(quality: string): void {
    this.closeOnly = quality === "close-only";
    if (!this.chart) return;
    this.chart.setStyles({
      candle: {
        priceMark: { high: { show: !this.closeOnly }, low: { show: !this.closeOnly } },
        tooltip: {
          legend: {
            template: this.closeOnly
              ? [
                  { title: "time", value: "{time}" },
                  { title: "Price: ", value: "{close}" },
                  { title: "volume", value: "{volume}" },
                ]
              : [
                  { title: "time", value: "{time}" },
                  { title: "open", value: "{open}" },
                  { title: "high", value: "{high}" },
                  { title: "low", value: "{low}" },
                  { title: "close", value: "{close}" },
                  { title: "volume", value: "{volume}" },
                ],
          },
        },
      },
    });
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
    this.fitToWidth(bars.length);
  }

  /**
   * Size the bars so the series fills the chart, and keep the right margin
   * under one bar wide.
   *
   * Two visible bugs came out of leaving this to the library. Bar width is
   * sticky across a period change, so switching from ~1,240 daily bars to ~60
   * monthly ones left the series crammed against the right edge with most of
   * the canvas empty. And the default 80px right margin is several months wide
   * once bars are monthly, which the x-axis fills with extrapolated labels —
   * that is why a series ending in July 2026 was labelled out to 2026-11.
   *
   * The floor is the library's own default width: on a five-year daily series
   * filling the canvas would mean 1px bars, so dense resolutions stay scrolled
   * to the latest data instead.
   */
  private fitToWidth(barCount: number): void {
    if (!this.chart || barCount === 0) return;
    const width = this.container?.clientWidth ?? 0;
    if (width <= 0) return;

    const RIGHT_MARGIN = 12;
    const Y_AXIS_WIDTH = 70;
    this.chart.setOffsetRightDistance(RIGHT_MARGIN);

    const usable = Math.max(1, width - Y_AXIS_WIDTH - RIGHT_MARGIN);
    const ideal = usable / barCount;
    this.chart.setBarSpace(Math.min(50, Math.max(10, ideal)));
    this.chart.scrollToRealTime(0);
  }

  /**
   * Daily bars rolled up to the selected resolution. The portal only serves
   * daily closes, so weekly and monthly views are aggregated here rather than
   * refetched — without this the 1W and 1M buttons change the axis but not the
   * data.
   */
  private barsForResolution(): KLineData[] {
    if (this.currentResolution === "1D") return this._bars;
    const monthly = this.currentResolution === "1M";

    /**
     * Start of the period a timestamp falls in. Aggregated bars have to sit on
     * real period boundaries — the first of the month, the Monday of the week
     * — rather than on whichever trading day happened to open the period.
     * KLineCharts derives its axis labels from the bar timestamps, so a bar
     * stamped "5 July" in a monthly series makes the axis drift off the
     * calendar.
     */
    const startOf = (ts: number): number => {
      const d = new Date(ts);
      if (monthly) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
    };

    const out: KLineData[] = [];
    let currentStart: number | null = null;
    for (const bar of this._bars) {
      const start = startOf(bar.timestamp);
      const last = out[out.length - 1];
      if (start !== currentStart || !last) {
        out.push({ ...bar, timestamp: start });
        currentStart = start;
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
    if (this.activeIndicators.includes(name)) return name; // already on — one instance each

    const onPricePane = options?.isMain ?? PRICE_PANE_INDICATORS.has(name);
    const create: IndicatorCreate = {
      name,
      calcParams: options?.calcParams ?? INDICATOR_PARAMS[name],
      shortName: options?.shortName,
      ...(INDICATOR_PRECISION[name] !== undefined ? { precision: INDICATOR_PRECISION[name] } : {}),
    };
    const created = this.chart.createIndicator(create, {
      isStack: onPricePane,
      pane: onPricePane
        ? { id: "candle_pane" }
        : { id: `pane_${name}`, height: name === "VOL" ? 90 : 120 },
    });
    if (created === null) return "";
    this.activeIndicators.push(name);
    return name;
  }

  updateIndicator(id: string, options: any): void {
    if (!this.chart) return;
    this.chart.overrideIndicator({ name: id, ...options });
  }

  removeIndicator(name: string): void {
    if (!this.chart) return;
    this.chart.removeIndicator({ name });
    this.activeIndicators = this.activeIndicators.filter((n) => n !== name);
  }

  /** Adds the indicator if absent, removes it if present. Returns the new state. */
  toggleIndicator(name: string): boolean {
    if (this.activeIndicators.includes(name)) {
      this.removeIndicator(name);
      return false;
    }
    return this.addIndicator(name) !== "";
  }

  /**
   * Start an interactive drawing. The user places the points by clicking on
   * the chart; KLineCharts runs the whole gesture once the overlay exists.
   * Valid names include "segment", "rayLine", "horizontalStraightLine",
   * "priceLine" and "fibonacciLine" — all registered built-ins.
   */
  startDrawing(name: string): void {
    if (!this.chart) return;
    this.chart.createOverlay({
      name,
      styles: {
        line: { color: COLOR.line },
        text: { color: COLOR.line, backgroundColor: "transparent" },
        point: { color: COLOR.line, borderColor: COLOR.areaTop },
      },
    });
  }

  /** Remove every user drawing. Indicators are not overlays, so they survive. */
  clearDrawings(): void {
    if (!this.chart) return;
    this.chart.removeOverlay();
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
    return JSON.stringify({ indicators: this.activeIndicators });
  }

  loadLayoutState(state: string): void {
    if (!this.chart) return;
    try {
      const parsed = JSON.parse(state) as { indicators?: string[] };
      if (!Array.isArray(parsed.indicators)) return;
      for (const name of [...this.activeIndicators]) {
        if (!parsed.indicators.includes(name)) this.removeIndicator(name);
      }
      for (const name of parsed.indicators) this.addIndicator(name);
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

  getActiveIndicators(): string[] { return [...this.activeIndicators]; }

  getActiveDrawings(): ChartDrawing[] { return []; }
}
