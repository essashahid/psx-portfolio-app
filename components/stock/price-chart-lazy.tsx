"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** Lazy so the recharts bundle loads after first paint, not before it. */
export const StockPriceChart = dynamic(
  () => import("@/components/stock/price-chart").then((m) => m.StockPriceChart),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full rounded-md" /> }
);
