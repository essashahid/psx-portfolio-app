import { HeaderSkeleton, TableSkeleton } from "@/components/page-skeleton";

export default function GoalsLoading() {
  return (
    <div className="space-y-4">
      <HeaderSkeleton />
      <TableSkeleton rows={10} />
    </div>
  );
}
