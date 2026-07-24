"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Client-side lazy loaders for the heavy Market Pulse visuals. Recharts and the
 * heatmap are split out of the initial bundle and stream in behind skeletons,
 * so the page shell and summary cards paint immediately.
 */

export const SectorBarsLazy = dynamic(() => import("./sector-bars").then((m) => m.SectorBars), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

export const MarketHeatmapLazy = dynamic(() => import("./market-heatmap").then((m) => m.MarketHeatmap), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

export const MoversBoardLazy = dynamic(() => import("./movers-board").then((m) => m.MoversBoard), {
  ssr: false,
  loading: () => <Skeleton className="h-80 w-full" />,
});
