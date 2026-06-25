"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lazy wrappers so the recharts bundle (~150KB gzipped) loads after first
 * paint instead of blocking it. Server pages import from here; the chart
 * area shows a skeleton for the brief hydration gap.
 */
const ChartFallback = () => <Skeleton className="h-56 w-full rounded-md md:h-64" />;

export const AllocationPie = dynamic(
  () => import("@/components/charts").then((m) => m.AllocationPie),
  { ssr: false, loading: ChartFallback }
);

export const GainLossBar = dynamic(
  () => import("@/components/charts").then((m) => m.GainLossBar),
  { ssr: false, loading: ChartFallback }
);

export const DailyHoldingPerformanceBar = dynamic(
  () => import("@/components/charts").then((m) => m.DailyHoldingPerformanceBar),
  { ssr: false, loading: ChartFallback }
);

export const RatioSnapshotChart = dynamic(
  () => import("@/components/charts").then((m) => m.RatioSnapshotChart),
  { ssr: false, loading: ChartFallback }
);

export const TargetVsActualBar = dynamic(
  () => import("@/components/charts").then((m) => m.TargetVsActualBar),
  { ssr: false, loading: ChartFallback }
);

export const ValueLine = dynamic(
  () => import("@/components/charts").then((m) => m.ValueLine),
  { ssr: false, loading: ChartFallback }
);

export const PerformanceWaterfall = dynamic(
  () => import("@/components/charts").then((m) => m.PerformanceWaterfall),
  { ssr: false, loading: ChartFallback }
);

export const PerformanceTimeline = dynamic(
  () => import("@/components/charts").then((m) => m.PerformanceTimeline),
  { ssr: false, loading: ChartFallback }
);

export const CostFrictionBars = dynamic(
  () => import("@/components/charts").then((m) => m.CostFrictionBars),
  { ssr: false, loading: ChartFallback }
);
