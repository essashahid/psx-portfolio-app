import { SupportResistanceZone } from "@/lib/market/technicals";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SupportResistanceProps {
  zones: SupportResistanceZone[];
}

export function SupportResistance({ zones }: SupportResistanceProps) {
  if (zones.length === 0) {
    return (
      <Card className="border-[var(--rule)] bg-[var(--surface-raised)] shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Key Levels</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <p className="text-sm text-muted-foreground">No clear support or resistance zones detected yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--rule)] bg-[var(--surface-raised)] shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">Key Levels</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        {zones.map((z) => (
          <div key={z.id} className="flex flex-col gap-1.5 rounded-lg border border-border bg-[var(--surface-sunken)]/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--text-strong)]">
                PKR {z.low.toFixed(2)} – {z.high.toFixed(2)}
              </span>
              <Badge variant={z.kind === "support" ? "green" : "red"}>{z.kind}</Badge>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-[var(--text-body)]">{z.timeframe}</span> timeframe • {z.confidence} confidence
            </div>
            <div className="text-xs text-muted-foreground">
              {z.touches} historical reactions • Last tested on {z.lastTested}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
