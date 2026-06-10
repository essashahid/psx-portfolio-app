import { HeaderSkeleton, TableSkeleton } from "@/components/page-skeleton";

export default function AlertsLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      <TableSkeleton rows={8} />
    </div>
  );
}
