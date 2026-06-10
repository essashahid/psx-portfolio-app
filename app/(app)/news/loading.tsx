import { HeaderSkeleton, CardSkeleton, FilterChipsSkeleton } from "@/components/page-skeleton";

export default function NewsLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      <div className="space-y-2">
        <FilterChipsSkeleton count={8} />
        <FilterChipsSkeleton count={5} />
        <FilterChipsSkeleton count={10} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} lines={4} />)}
      </div>
    </div>
  );
}
