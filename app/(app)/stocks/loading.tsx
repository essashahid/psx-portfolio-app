import { HeaderSkeleton, StatCardSkeleton, TableSkeleton } from "@/components/page-skeleton";

export default function StocksLoading() {
  return (
    <div className="space-y-5">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <TableSkeleton rows={10} />
    </div>
  );
}
