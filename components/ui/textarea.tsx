import * as React from "react";
import { cn } from "@/lib/shared/format";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[4.75rem] w-full rounded-md border border-rule bg-surface-raised px-3 py-2 text-base shadow-sm placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:min-h-[4.375rem] md:text-sm",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
