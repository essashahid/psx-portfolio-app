import * as React from "react";
import { cn } from "@/lib/shared/format";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-md border border-rule bg-surface-raised px-3 py-1 text-base shadow-sm transition-colors placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:h-9 md:text-sm",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
