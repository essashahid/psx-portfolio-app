import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/shared/format";

/**
 * The fold at the bottom of the Market page. Everything analytical that is
 * not part of the day's plain answer (breadth strip, 52-week band, return
 * histogram, participant flows, internals) sits inside it, closed by default.
 *
 * A native details element: it needs no client JavaScript, keeps its state
 * across navigation the way the browser decides, and the chevron turns on
 * the open attribute alone.
 */
export function MoreDetail({ title = "More detail", children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <details className={cn("group border-t border-rule", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-text-strong [&::-webkit-details-marker]:hidden">
        <span className="font-display text-(length:--text-h2) font-normal tracking-editorial">{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}
