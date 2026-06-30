import { HeaderSkeleton, StatCardSkeleton, CardSkeleton } from "@/components/page-skeleton";

export default function MarketLoading() {
  return (
    <div className="space-y-7 pb-4">
      <HeaderSkeleton />
      <div className="grid gap-4 border-y border-border py-5 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} lines={6} />)}
      </div>
    </div>
  );
}
