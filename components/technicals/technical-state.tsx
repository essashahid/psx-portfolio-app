import { TechnicalSignals } from "@/lib/market/technicals";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface TechnicalStateProps {
  signals: TechnicalSignals;
  volatility: number | null;
}

export function TechnicalState({ signals, volatility }: TechnicalStateProps) {
  const longTerm = signals.longTermTrend;
  const accumulation = signals.accumulation;
  
  // Map internal signals to display rows
  const rows = [
    {
      dimension: "Primary trend",
      state: longTerm === "uptrend" ? "Rising" : longTerm === "downtrend" ? "Falling" : "Mixed",
      evidence: signals.emaWeekly?.note || "Not enough data",
      confidence: signals.emaWeekly?.fast !== null ? "High" : "Low",
      tone: longTerm === "uptrend" ? "green" : longTerm === "downtrend" ? "red" : "amber"
    },
    {
      dimension: "Accumulation Zone",
      state: accumulation?.status === "attractive" ? "In Zone" : accumulation?.status === "extended" ? "Extended" : accumulation?.status === "deteriorating" ? "Deteriorating" : "Unclear",
      evidence: accumulation?.note || "Not enough data",
      confidence: accumulation?.status !== "unclear" ? "Medium" : "Low",
      tone: accumulation?.status === "attractive" ? "green" : accumulation?.status === "deteriorating" ? "red" : "amber"
    },
    {
      dimension: "Momentum",
      state: signals.rsi !== null ? (signals.rsi > 70 ? "Overbought" : signals.rsi < 30 ? "Oversold" : "Neutral") : "Unknown",
      evidence: signals.rsi !== null ? `RSI (14) is at ${signals.rsi.toFixed(1)}.` : "Missing RSI",
      confidence: signals.rsi !== null ? "High" : "Low",
      tone: signals.rsi !== null && signals.rsi > 70 ? "red" : signals.rsi !== null && signals.rsi < 30 ? "green" : "secondary"
    },
    {
      dimension: "Volatility",
      state: volatility !== null ? (volatility > 40 ? "Elevated" : "Normal") : "Unknown",
      evidence: volatility !== null ? `Annualized volatility is ${volatility.toFixed(1)}%.` : "Not enough data",
      confidence: volatility !== null ? "High" : "Low",
      tone: volatility !== null && volatility > 40 ? "amber" : "secondary"
    }
  ];

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">Technical State</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i} className="border-b border-border last:border-0 hover:bg-slate-50/50">
                <TD className="w-[140px] py-3 pl-4 align-top font-medium text-slate-900">{r.dimension}</TD>
                <TD className="w-[120px] py-3 align-top">
                  <Badge variant={r.tone as any} className="whitespace-nowrap">{r.state}</Badge>
                </TD>
                <TD className="py-3 align-top text-xs text-slate-600 leading-relaxed">{r.evidence}</TD>
                <TD className="w-[100px] py-3 pr-4 text-right align-top text-xs text-muted-foreground">{r.confidence} confidence</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
