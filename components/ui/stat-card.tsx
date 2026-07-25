import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/shared/format";

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <Card className={cn(
      tone === "positive" && "border-l-(length:--border-accent) border-l-up",
      tone === "negative" && "border-l-(length:--border-accent) border-l-down",
    )}>
      <CardContent className="p-4">
        <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
        <p
          className={cn(
            "figure mt-1.5 text-(length:--text-h1) font-semibold",
            tone === "positive" && "text-up",
            tone === "negative" && "text-down"
          )}
        >
          {value}
        </p>
        {sub && <p className="figure mt-0.5 text-xs text-text-muted">{sub}</p>}
      </CardContent>
    </Card>
  );
}
