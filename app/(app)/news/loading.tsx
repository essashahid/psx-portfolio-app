import { CardSkeleton, FilterChipsSkeleton, StatCardSkeleton } from "@/components/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewsLoading() {
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.9fr)]">
          <div className="p-5 sm:p-6">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-4 h-9 w-56" />
            <Skeleton className="mt-3 h-4 w-full max-w-xl" />
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
            </div>
          </div>
          <div className="border-t border-border bg-muted/30 p-5 lg:border-l lg:border-t-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-9 w-16" />
            <Skeleton className="mt-2 h-3 w-40" />
            <Skeleton className="mt-5 h-24 w-full" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="space-y-4">
          <FilterChipsSkeleton count={4} />
          <FilterChipsSkeleton count={4} />
          <FilterChipsSkeleton count={5} />
          <FilterChipsSkeleton count={8} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} lines={5} />)}
        </div>
        <div className="space-y-3">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={5} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}
