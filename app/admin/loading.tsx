import { CardSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Admin pages read several tables; this stands in while they resolve. */
export default function Loading() {
  return (
    <div className="py-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-3.5 w-80 max-w-full" />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>
    </div>
  );
}
