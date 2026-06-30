import { HeaderSkeleton, StatCardSkeleton, TableSkeleton, CardSkeleton } from "@/components/page-skeleton";

export default function PerformanceLoading() {
  return (
    <div className="space-y-8 pb-6">
      <HeaderSkeleton />
      <div className="grid gap-x-8 gap-y-4 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <TableSkeleton rows={6} />
      <CardSkeleton lines={6} />
      <TableSkeleton rows={8} />
    </div>
  );
}
