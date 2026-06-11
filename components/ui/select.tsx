import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-border bg-card px-2.5 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-9 md:text-sm",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
