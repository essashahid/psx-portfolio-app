/**
 * The chart renders nothing unless the adapter tells KLineCharts its symbol and
 * period — the library pulls data via the loader rather than being handed it,
 * and it only pulls once both are set. That was missed once already and shipped
 * a blank chart on every stock, so it is pinned here.
 */
import type { KLineData } from "klinecharts";

const chart = {
  setDataLoader: jest.fn(),
  setSymbol: jest.fn(),
  setPeriod: jest.fn(),
  setStyles: jest.fn(),
  createIndicator: jest.fn(() => "ind_1"),
};

jest.mock("klinecharts", () => ({
  init: jest.fn(() => chart),
  dispose: jest.fn(),
}));

import { KLineChartsAdapter } from "@/lib/market/chart-adapters/klinecharts-adapter";

const DAY = 86400000;

function ohlcv(bars: number) {
  return {
    symbol: "MEBL",
    exchange: "PSX",
    resolution: "1D",
    timezone: "Asia/Karachi",
    bars: Array.from({ length: bars }, (_, i) => ({
      time: Date.UTC(2026, 0, 5) + i * DAY,
      open: 500 + i, high: 500 + i, low: 500 + i, close: 500 + i,
      volume: 1000 + i,
      status: "unverified",
    })),
    latestMarketDate: "2026-01-05",
    refreshedAt: "2026-01-05T00:00:00Z",
    adjustmentStatus: "unadjusted",
    dataQuality: "close-only",
  } as never;
}

/** Runs the registered loader the way KLineCharts would on first load. */
function loadedBars(): KLineData[] {
  const loader = chart.setDataLoader.mock.calls.at(-1)![0] as {
    getBars: (p: { type: string; callback: (d: KLineData[], m: unknown) => void }) => void;
  };
  let got: KLineData[] = [];
  loader.getBars({ type: "init", callback: (d) => { got = d; } });
  return got;
}

describe("KLineChartsAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mounted(bars = 30) {
    const a = new KLineChartsAdapter();
    a.initializeChart({} as HTMLElement);
    a.setSymbol("MEBL");
    a.setOHLCVData(ohlcv(bars));
    return a;
  }

  test("sets symbol and period on the chart, not just locally", () => {
    mounted();
    expect(chart.setSymbol).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: "MEBL", pricePrecision: 2 })
    );
    expect(chart.setPeriod).toHaveBeenCalledWith({ type: "day", span: 1 });
  });

  test("registers the loader before the load is triggered", () => {
    mounted();
    const loaderCall = chart.setDataLoader.mock.invocationCallOrder[0];
    const symbolCall = chart.setSymbol.mock.invocationCallOrder[0];
    expect(loaderCall).toBeLessThan(symbolCall);
  });

  test("serves the bars on the initial load", () => {
    mounted(30);
    expect(loadedBars()).toHaveLength(30);
  });

  test("reports no more data for paging requests", () => {
    mounted(30);
    const loader = chart.setDataLoader.mock.calls.at(-1)![0] as {
      getBars: (p: { type: string; callback: (d: KLineData[], m: unknown) => void }) => void;
    };
    let more: unknown = "unset";
    let data: KLineData[] = [];
    loader.getBars({ type: "forward", callback: (d, m) => { data = d; more = m; } });
    expect(data).toHaveLength(0);
    expect(more).toBe(false);
  });

  test("does nothing until both a symbol and bars exist", () => {
    const a = new KLineChartsAdapter();
    a.initializeChart({} as HTMLElement);
    a.setSymbol("MEBL"); // no data yet
    expect(chart.setPeriod).not.toHaveBeenCalled();
  });

  test("aggregates daily bars for the weekly and monthly resolutions", () => {
    const a = mounted(60);
    expect(loadedBars()).toHaveLength(60);

    a.setResolution("1W");
    const weekly = loadedBars();
    expect(weekly.length).toBeGreaterThan(5);
    expect(weekly.length).toBeLessThan(60);
    expect(chart.setPeriod).toHaveBeenLastCalledWith({ type: "week", span: 1 });

    a.setResolution("1M");
    const monthly = loadedBars();
    expect(monthly.length).toBeLessThan(weekly.length);
    expect(chart.setPeriod).toHaveBeenLastCalledWith({ type: "month", span: 1 });
  });

  test("an aggregated bar spans its constituents", () => {
    const a = mounted(60);
    a.setResolution("1M");
    const monthly = loadedBars();
    const first = monthly[0];
    expect(first.high).toBeGreaterThanOrEqual(first.low);
    expect(first.volume).toBeGreaterThan(1000); // summed, not copied
  });
});
