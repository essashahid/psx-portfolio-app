import { cn } from "@/lib/shared/format";

/**
 * A stand-in for a table that has not loaded, drawn on the table's own grid.
 *
 * The point is that nothing moves when the data lands. Same column template,
 * same row height, same hairline rules — so the skeleton occupies exactly the
 * space the rows will. If the page jumps on arrival, the grid here does not
 * match the real one and this is the thing to fix, not the table.
 *
 * A spinner belongs where the shape is genuinely unknown. Anywhere the shape
 * is known, a spinner throws that knowledge away and guarantees a reflow.
 */
export function LedgerSkeleton({
  rows = 6,
  /** Must mirror the real table's grid-template-columns. */
  columns = "minmax(0,1fr) 96px 96px",
  /** Must mirror the real row's min-height. */
  rowHeight = 44,
  showHeader = true,
  className,
}: {
  rows?: number;
  columns?: string;
  rowHeight?: number;
  showHeader?: boolean;
  className?: string;
}) {
  const cells = columns.trim().split(/\s+(?![^(]*\))/).length;

  return (
    <div className={cn("w-full", className)} aria-hidden>
      {showHeader ? (
        <div
          className="grid items-center gap-3 border-b border-rule pb-2"
          style={{ gridTemplateColumns: columns }}
        >
          {Array.from({ length: cells }).map((_, i) => (
            <div
              key={i}
              className="sk-shimmer h-2 rounded-sm"
              style={{ width: i === 0 ? "38%" : "58%", marginLeft: i === 0 ? 0 : "auto" }}
            />
          ))}
        </div>
      ) : null}

      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid items-center gap-3 border-b border-rule"
          style={{ gridTemplateColumns: columns, minHeight: rowHeight }}
        >
          {Array.from({ length: cells }).map((_, c) => (
            <div
              key={c}
              className="sk-shimmer h-3 rounded-sm"
              style={{
                // Varying the first column stops six identical rows reading as
                // a loading graphic rather than as rows.
                width: c === 0 ? `${62 + ((r * 7) % 26)}%` : "70%",
                marginLeft: c === 0 ? 0 : "auto",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
