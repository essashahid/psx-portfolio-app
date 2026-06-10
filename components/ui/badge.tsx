import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "green"
  | "red"
  | "amber"
  | "blue";

const variants: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-muted text-muted-foreground",
  outline: "border border-border text-foreground",
  green: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  red: "bg-red-50 text-red-700 border border-red-200",
  amber: "bg-amber-50 text-amber-700 border border-amber-200",
  blue: "bg-blue-50 text-blue-700 border border-blue-200",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function sentimentVariant(s: string | null): BadgeVariant {
  if (s === "positive") return "green";
  if (s === "negative") return "red";
  return "secondary";
}

export function thesisStatusVariant(s: string | null): BadgeVariant {
  switch (s) {
    case "Active": return "green";
    case "Watch": return "blue";
    case "Weakening": return "amber";
    case "Broken": return "red";
    case "Closed": return "secondary";
    default: return "outline";
  }
}

export function severityVariant(s: string): BadgeVariant {
  if (s === "critical") return "red";
  if (s === "warning") return "amber";
  return "blue";
}
