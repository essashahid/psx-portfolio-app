"use client";

import { useEffect, useRef, useState } from "react";
import { KLineChartsAdapter } from "@/lib/market/chart-adapters/klinecharts-adapter";
import { CanonicalOHLCV } from "@/types/chart-engine";
import { TechnicalSignals } from "@/lib/market/technicals";
import { SupportResistanceZone } from "@/lib/market/technicals";
import { ChartHeader } from "./chart-header";
import { TechnicalState } from "./technical-state";
import { SupportResistance } from "./support-resistance";
import { IndicatorBrowser } from "./indicator-browser";
import { DrawingToolbar } from "./drawing-toolbar";
import { LayoutManager } from "./layout-manager";

interface TechnicalWorkstationProps {
  ticker: string;
  ohlcvData: CanonicalOHLCV;
  signals: TechnicalSignals;
  supportResistanceZones: SupportResistanceZone[];
  changePct?: number | null;
  volatility?: number | null;
}

export function TechnicalWorkstation({
  ticker, ohlcvData, signals, supportResistanceZones, changePct = null, volatility = null
}: TechnicalWorkstationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<KLineChartsAdapter | null>(null);
  const [resolution, setResolution] = useState("1D");
  const [chartType, setChartType] = useState<"candlestick" | "line" | "area">("candlestick");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [openPanel, setOpenPanel] = useState<"indicators" | "draw" | "layouts" | null>(null);
  const [activeIndicators, setActiveIndicators] = useState<string[]>(["VOL"]);

  const closeOnly = ohlcvData.dataQuality === "close-only";

  useEffect(() => {
    if (!containerRef.current) return;

    const adapter = new KLineChartsAdapter();
    adapter.initializeChart(containerRef.current);
    adapter.setSymbol(ticker);
    adapter.setDataQuality(ohlcvData.dataQuality);

    // Close-only data cannot draw candles, so fall back to the line style.
    if (ohlcvData.dataQuality === "close-only") {
      setChartType("line");
      adapter.setChartType("line");
    } else {
      adapter.setChartType("candlestick");
    }

    adapter.setOHLCVData(ohlcvData);

    // Re-apply whatever the user had on before a re-mount (ticker change).
    setActiveIndicators((current) => {
      for (const name of current) adapter.addIndicator(name);
      return adapter.getActiveIndicators();
    });

    adapterRef.current = adapter;

    return () => {
      adapter.destroyChart();
      adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, ohlcvData]);

  const handleResolutionChange = (res: string) => {
    setResolution(res);
    adapterRef.current?.setResolution(res);
  };

  const handleChartTypeChange = (type: "candlestick" | "line" | "area") => {
    // Close-only data has no real open/high/low to draw candles from.
    if (type === "candlestick" && closeOnly) return;
    setChartType(type);
    adapterRef.current?.setChartType(type);
  };

  const handleFullscreenToggle = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.closest(".workstation-wrapper")?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleToggleIndicator = (name: string) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    adapter.toggleIndicator(name);
    setActiveIndicators(adapter.getActiveIndicators());
  };

  const handleStartDrawing = (name: string) => {
    adapterRef.current?.startDrawing(name);
    setOpenPanel(null);
  };

  const handleClearDrawings = () => {
    adapterRef.current?.clearDrawings();
    setOpenPanel(null);
  };

  const handleSaveLayout = () => {
    const state = adapterRef.current?.saveLayoutState();
    if (state) localStorage.setItem(`chart_layout_${ticker}`, state);
  };

  const handleLoadLayout = () => {
    const adapter = adapterRef.current;
    const state = localStorage.getItem(`chart_layout_${ticker}`);
    if (adapter && state) {
      adapter.loadLayoutState(state);
      setActiveIndicators(adapter.getActiveIndicators());
    }
  };

  // Listen to fullscreen changes outside the button
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  return (
    <div className="workstation-wrapper flex flex-col gap-4 bg-background">
      <div className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <ChartHeader
          ticker={ticker}
          price={signals.lastClose}
          changePct={changePct}
          resolution={resolution}
          onResolutionChange={handleResolutionChange}
          chartType={chartType}
          candlesDisabled={closeOnly}
          onChartTypeChange={handleChartTypeChange}
          onFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
          onOpenIndicators={() => setOpenPanel(openPanel === "indicators" ? null : "indicators")}
          onOpenDrawings={() => setOpenPanel(openPanel === "draw" ? null : "draw")}
          onOpenLayouts={() => setOpenPanel(openPanel === "layouts" ? null : "layouts")}
        />

        {openPanel === "indicators" && (
          <IndicatorBrowser
            active={activeIndicators}
            onToggleIndicator={handleToggleIndicator}
            onClose={() => setOpenPanel(null)}
          />
        )}

        {openPanel === "draw" && (
          <DrawingToolbar
            onSelectTool={handleStartDrawing}
            onClearAll={handleClearDrawings}
            onClose={() => setOpenPanel(null)}
          />
        )}

        {openPanel === "layouts" && (
          <LayoutManager onSave={handleSaveLayout} onLoad={handleLoadLayout} onClose={() => setOpenPanel(null)} />
        )}

        {/* Main Chart Area */}
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: isFullscreen ? "calc(100vh - 64px)" : "500px" }}
        />

        {closeOnly && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            PSX publishes daily closing prices only, so this chart is drawn as a close price line.
            Candlesticks and range indicators need open, high and low data that is not available.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <TechnicalState signals={signals} volatility={volatility} />
        <SupportResistance zones={supportResistanceZones} />
      </div>
    </div>
  );
}
