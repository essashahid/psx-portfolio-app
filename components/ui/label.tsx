import * as React from "react";
import { cn } from "@/lib/shared/format";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-medium text-text-strong leading-none", className)}
      {...props}
    />
  );
}
