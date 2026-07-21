"use client";

import { Button } from "@/components/ui/button";
import { Maximize, BarChart2, Calendar, Settings2, PenTool, LayoutTemplate, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChartHeaderProps {
  ticker: string;
  price: number | null;
  changePct: number | null;
  resolution: string;
  onResolutionChange: (res: string) => void;
  chartType: string;
  candlesDisabled?: boolean;
  onChartTypeChange: (type: "candlestick" | "line" | "area") => void;
  onFullscreenToggle: () => void;
  isFullscreen: boolean;
  onOpenIndicators: () => void;
  onOpenDrawings: () => void;
  onOpenLayouts: () => void;
}

export function ChartHeader({
  ticker, price, changePct, resolution, onResolutionChange, chartType, candlesDisabled, onChartTypeChange, onFullscreenToggle, isFullscreen, onOpenIndicators, onOpenDrawings, onOpenLayouts
}: ChartHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-3">
      {/* Left: Ticker & Price */}
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-bold tracking-tight">{ticker}</h2>
        {price !== null && (
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">PKR {price.toFixed(2)}</span>
            {changePct !== null && (
              <span className={cn("text-xs font-medium tabular-nums", changePct > 0 ? "text-emerald-600" : changePct < 0 ? "text-red-600" : "text-muted-foreground")}>
                {changePct > 0 ? "+" : ""}{changePct.toFixed(2)}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Middle/Right: Controls */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
          <Button variant="ghost" size="sm" className={cn("h-7 px-2 text-xs", resolution === "1D" && "bg-background shadow-sm")} onClick={() => onResolutionChange("1D")}>1D</Button>
          <Button variant="ghost" size="sm" className={cn("h-7 px-2 text-xs", resolution === "1W" && "bg-background shadow-sm")} onClick={() => onResolutionChange("1W")}>1W</Button>
          <Button variant="ghost" size="sm" className={cn("h-7 px-2 text-xs", resolution === "1M" && "bg-background shadow-sm")} onClick={() => onResolutionChange("1M")}>1M</Button>
        </div>

        <div className="mx-1 h-4 w-px bg-border" />

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={candlesDisabled}
          title={candlesDisabled ? "Candles need open, high and low data, which PSX does not publish" : undefined}
          onClick={() => onChartTypeChange(chartType === "candlestick" ? "line" : "candlestick")}
        >
          <BarChart2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{chartType === "candlestick" ? "Candles" : "Line"}</span>
        </Button>

        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={onOpenIndicators}>
          <Settings2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Indicators</span>
        </Button>

        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={onOpenDrawings}>
          <PenTool className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Draw</span>
        </Button>

        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={onOpenLayouts}>
          <LayoutTemplate className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Layouts</span>
        </Button>

        <div className="mx-1 h-4 w-px bg-border" />

        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onFullscreenToggle}>
          <Maximize className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
