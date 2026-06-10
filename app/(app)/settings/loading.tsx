import { HeaderSkeleton, CardSkeleton } from "@/components/page-skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} lines={6} />)}
    </div>
  );
}
