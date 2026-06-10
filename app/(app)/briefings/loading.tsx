import { HeaderSkeleton, CardSkeleton } from "@/components/page-skeleton";

export default function BriefingsLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} lines={10} />)}
    </div>
  );
}
