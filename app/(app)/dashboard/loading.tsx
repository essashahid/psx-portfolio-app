import { HeaderSkeleton, StatCardSkeleton, CardSkeleton } from "@/components/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-5">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="mb-4 h-4 w-36" />
            <Skeleton className="h-52 w-full rounded-md" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <Skeleton className="mb-2 h-4 w-40" />
        <Skeleton className="h-36 w-full rounded-md" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={8} />
        <div className="space-y-4">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
        <CardSkeleton lines={3} />
      </div>
    </div>
  );
}
