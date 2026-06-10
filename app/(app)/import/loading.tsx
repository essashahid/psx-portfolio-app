import { HeaderSkeleton, CardSkeleton } from "@/components/page-skeleton";

export default function ImportLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      <CardSkeleton lines={8} />
    </div>
  );
}
