import * as React from "react";
import { cn } from "@/lib/shared/format";

/**
 * Two table styles, one set of components.
 *
 * `default` is the dense grid the admin, settings, import and coverage screens
 * already use: ruled headers with a fixed height, tight cell padding, and a
 * hover tint because those rows are scanned and clicked.
 *
 * `reader` is the lighter style the outlook and research surfaces hand-rolled:
 * smaller type, padding only where a column needs separating, softer row rules
 * and no hover, because those tables are read rather than operated.
 *
 * The variant is applied from the table element as descendant rules rather than
 * threaded through every cell. That keeps the subcomponents untouched, keeps
 * the call site to one prop, and above all keeps this file a server component:
 * a React context would need "use client", which would drag every row of every
 * table into the browser bundle.
 *
 * Specificity does the work. `[&_th]:x` compiles to `.table th`, which outranks
 * the `.th` class the cell carries, so the overrides land without !important.
 */
type Variant = "default" | "reader";

const READER = cn(
  "text-xs",
  // Headers: no fixed row height, weight one step down, wrap allowed.
  "[&_th]:h-auto [&_th]:px-0 [&_th]:pb-2 [&_th]:font-medium [&_th]:whitespace-normal",
  "[&_td]:px-0 [&_td]:whitespace-normal",
  // Gutter between columns, but nothing hanging off the last one.
  "[&_th:not(:last-child)]:pr-3 [&_td:not(:last-child)]:pr-3",
  // Body rows sit on a softer rule. Nothing lights up under the cursor, header
  // row included, because these tables are not clickable.
  "[&_tbody_tr]:border-rule/60 [&_tr:hover]:bg-transparent"
);

export function Table({
  className,
  variant = "default",
  wrapperClassName,
  ...props
}: React.HTMLAttributes<HTMLTableElement> & {
  variant?: Variant;
  /** For the scroll container, e.g. `-mx-4 px-4` to bleed to a card's edge. */
  wrapperClassName?: string;
}) {
  return (
    <div className={cn("scroll-touch w-full overflow-x-auto", wrapperClassName)}>
      <table
        className={cn("w-full caption-bottom text-sm", variant === "reader" && READER, className)}
        {...props}
      />
    </div>
  );
}
export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-rule", className)} {...props} />;
}
export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-rule transition-colors hover:bg-surface-sunken/50", className)}
      {...props}
    />
  );
}
export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 px-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-text-muted whitespace-nowrap",
        className
      )}
      {...props}
    />
  );
}
export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-2.5 py-2 align-middle whitespace-nowrap", className)} {...props} />;
}
