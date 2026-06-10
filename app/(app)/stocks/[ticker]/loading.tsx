import { HeaderSkeleton, StatCardSkeleton, CardSkeleton } from "@/components/page-skeleton";

export default function StockLoading() {
  return (
    <div className="space-y-5">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={7} />
        <CardSkeleton lines={7} />
      </div>
      <CardSkeleton lines={5} />
      <CardSkeleton lines={4} />
    </div>
  );
}
