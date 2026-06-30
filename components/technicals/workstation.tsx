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
import { LayoutManager } from "./layout-manager";

interface TechnicalWorkstationProps {
  ticker: string;
  ohlcvData: CanonicalOHLCV;
  signals: TechnicalSignals;
  supportResistanceZones: SupportResistanceZone[];
}

export function TechnicalWorkstation({
  ticker, ohlcvData, signals, supportResistanceZones
}: TechnicalWorkstationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<KLineChartsAdapter | null>(null);
  const [resolution, setResolution] = useState("1D");
  const [chartType, setChartType] = useState<"candlestick" | "line" | "area">("candlestick");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showLayouts, setShowLayouts] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Initialize adapter
    const adapter = new KLineChartsAdapter();
    adapter.initializeChart(containerRef.current);
    adapter.setSymbol(ticker);
    
    // Determine initial chart type
    if (ohlcvData.dataQuality === "close-only") {
      setChartType("line");
      adapter.setChartType("line");
    } else {
      adapter.setChartType("candlestick");
    }

    adapter.setOHLCVData(ohlcvData);
    
    // Add default volume indicator
    adapter.addIndicator("VOL");

    adapterRef.current = adapter;

    return () => {
      adapter.destroyChart();
      adapterRef.current = null;
    };
  }, [ticker, ohlcvData]);

  const handleResolutionChange = (res: string) => {
    setResolution(res);
    adapterRef.current?.setResolution(res);
    // Real app would fetch new data here
  };

  const handleChartTypeChange = (type: "candlestick" | "line" | "area") => {
    // Prevent changing to candlestick if data is unverified/close-only
    if (type === "candlestick" && ohlcvData.dataQuality === "close-only") return;
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

  const handleAddIndicator = (name: string) => {
    adapterRef.current?.addIndicator(name);
  };

  const handleSaveLayout = () => {
    const state = adapterRef.current?.saveLayoutState();
    if (state) localStorage.setItem(`chart_layout_${ticker}`, state);
  };

  const handleLoadLayout = () => {
    const state = localStorage.getItem(`chart_layout_${ticker}`);
    if (state) adapterRef.current?.loadLayoutState(state);
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
          changePct={null} // compute from technicals if needed
          resolution={resolution}
          onResolutionChange={handleResolutionChange}
          chartType={chartType}
          onChartTypeChange={handleChartTypeChange}
          onFullscreenToggle={handleFullscreenToggle}
          isFullscreen={isFullscreen}
          onOpenIndicators={() => setShowIndicators(!showIndicators)}
          onOpenDrawings={() => { /* Toggle drawing toolbar */ }}
          onOpenLayouts={() => setShowLayouts(!showLayouts)}
        />
        
        {showIndicators && (
          <IndicatorBrowser onSelectIndicator={handleAddIndicator} onClose={() => setShowIndicators(false)} />
        )}
        
        {showLayouts && (
          <LayoutManager onSave={handleSaveLayout} onLoad={handleLoadLayout} onClose={() => setShowLayouts(false)} />
        )}

        {/* Main Chart Area */}
        <div 
          ref={containerRef} 
          className="w-full"
          style={{ height: isFullscreen ? "calc(100vh - 64px)" : "500px" }}
        />
        
        {ohlcvData.dataQuality === "close-only" && (
          <div className="absolute bottom-4 left-4 right-4 rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-800 backdrop-blur-sm z-10 pointer-events-none">
            Verified OHLC data is not currently available. Candlestick charting and range-based indicators are disabled. A close-price line chart is shown instead.
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <TechnicalState signals={signals} volatility={null} />
        <SupportResistance zones={supportResistanceZones} />
      </div>
    </div>
  );
}
