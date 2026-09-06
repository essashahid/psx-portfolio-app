import { Card, CardContent } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { cn } from "@/lib/shared/format";

/** A Metric in a card, with the tone showing as a coloured left edge. */
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
        <Metric
          label={label}
          value={value}
          sub={sub}
          tone={tone === "positive" ? "up" : tone === "negative" ? "down" : undefined}
        />
      </CardContent>
    </Card>
  );
}
