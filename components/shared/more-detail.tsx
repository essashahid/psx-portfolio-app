import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/shared/format";

/**
 * A fold for everything analytical that is not part of a page's plain answer.
 *
 * First built for the bottom of the Market page (breadth strip, 52-week band,
 * return histogram, participant flows, internals); now also the company
 * Financials and Filings tabs, the Dividends page and the Portfolio page. It
 * is a native details element: no client JavaScript, closed by default unless
 * told otherwise, and the chevron turns on the open attribute alone.
 *
 * `compact` draws a smaller summary for a fold nested inside another one.
 */
export function MoreDetail({
  title = "More detail",
  children,
  className,
  defaultOpen = false,
  compact = false,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  return (
    <details className={cn("group border-t border-rule", className)} open={defaultOpen || undefined}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-4 text-text-strong [&::-webkit-details-marker]:hidden",
          compact ? "py-3" : "py-5"
        )}
      >
        <span className={compact ? "text-sm font-semibold" : "font-display text-(length:--text-h2) font-normal tracking-editorial"}>{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}
