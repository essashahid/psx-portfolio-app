import { HeaderSkeleton, CardSkeleton, FilterChipsSkeleton } from "@/components/page-skeleton";

export default function JournalLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      <CardSkeleton lines={5} />
      <div className="space-y-2">
        <FilterChipsSkeleton count={7} />
        <FilterChipsSkeleton count={8} />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} lines={5} />)}
      </div>
    </div>
  );
}
