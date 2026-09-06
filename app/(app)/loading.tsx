import { CardSkeleton, TableSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a signed-in page's data resolves.
 *
 * Every page in this group is force-dynamic and awaits several queries, so
 * without this a navigation was a dead click until the slowest one returned.
 * The shape is deliberately generic: a title block, a row of figures and a
 * ledger, which is what most of these pages open with.
 */
export default function Loading() {
  return (
    <div className="py-6 sm:py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mb-6">
        <Skeleton className="h-0.75 w-11" />
        <Skeleton className="mt-3.5 h-3 w-24" />
        <Skeleton className="mt-2 h-8 w-64" />
        <Skeleton className="mt-2.5 h-3.5 w-96 max-w-full" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-px border-y border-rule sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-3 py-4 sm:px-6">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-2 h-6 w-24" />
            <Skeleton className="mt-1.5 h-2.5 w-20" />
          </div>
        ))}
      </div>
      <TableSkeleton rows={6} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </div>
    </div>
  );
}
