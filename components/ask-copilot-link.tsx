import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Opens the Research Copilot pre-seeded with a question. The chat page reads
 * `?q=` and auto-sends it once, grounding on any ticker it names. Use this to
 * turn any surface (a stock page, a holding row, a news event) into a Copilot
 * on-ramp instead of making the user retype context.
 */
export function AskCopilotLink({
  question,
  label = "Ask Copilot",
  className,
  variant = "button",
}: {
  question: string;
  label?: string;
  className?: string;
  variant?: "button" | "inline";
}) {
  const href = `/chat?q=${encodeURIComponent(question)}`;
  if (variant === "inline") {
    return (
      <Link href={href} className={cn("inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline", className)}>
        <Sparkles className="h-3.5 w-3.5" /> {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent",
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}
