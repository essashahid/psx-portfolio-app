import { cn } from "@/lib/shared/format";

/**
 * A bar standing in for a value that has not arrived.
 *
 * Uses .sk-shimmer — a moving background — rather than an opacity pulse.
 * Fading a placeholder in and out reads as the page struggling, and it breaks
 * the rule the rest of the motion system follows: backgrounds shift, opacity
 * does not.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sk-shimmer rounded-md", className)} {...props} />;
}
