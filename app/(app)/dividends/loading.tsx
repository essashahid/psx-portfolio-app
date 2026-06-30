import { HeaderSkeleton, StatCardSkeleton, TableSkeleton } from "@/components/page-skeleton";

export default function DividendsLoading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <TableSkeleton rows={8} />
    </div>
  );
}
