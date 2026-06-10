import { HeaderSkeleton, TableSkeleton } from "@/components/page-skeleton";

export default function HoldingsLoading() {
  return (
    <div className="space-y-5">
      <HeaderSkeleton />
      <TableSkeleton rows={12} />
    </div>
  );
}
