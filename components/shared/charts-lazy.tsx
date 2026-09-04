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
  () => import("@/components/shared/charts").then((m) => m.AllocationPie),
  { ssr: false, loading: ChartFallback }
);




export const TargetVsActualBar = dynamic(
  () => import("@/components/shared/charts").then((m) => m.TargetVsActualBar),
  { ssr: false, loading: ChartFallback }
);




export const CostFrictionBars = dynamic(
  () => import("@/components/shared/charts").then((m) => m.CostFrictionBars),
  { ssr: false, loading: ChartFallback }
);
