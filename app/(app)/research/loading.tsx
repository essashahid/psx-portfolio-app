import { HeaderSkeleton, CardSkeleton } from "@/components/page-skeleton";

export default function ResearchLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <CardSkeleton lines={8} />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} lines={5} />)}
        </div>
      </div>
    </div>
  );
}
