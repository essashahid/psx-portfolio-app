"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function HeaderSkeleton() {
  return (
    <div className="flex items-start justify-between">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-8 w-32" />
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-6 w-28" />
    </div>
  );
}

export function CardSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  const widths = ["w-full", "w-4/5", "w-11/12", "w-3/4", "w-5/6", "w-2/3"];
  return (
    <div className={`rounded-lg border border-border bg-card p-4 space-y-3 ${className ?? ""}`}>
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  const colWidths = ["w-1/5", "w-2/5", "w-1/6", "w-1/6", "w-1/5"];
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex gap-4">
          {colWidths.map((w, i) => (
            <Skeleton key={i} className={`h-3 ${w}`} />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-border px-4 py-3 last:border-0">
          <div className="flex gap-4">
            {colWidths.map((w, j) => (
              <Skeleton key={j} className={`h-3 ${w}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilterChipsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-14 rounded-full" />
      ))}
    </div>
  );
}
