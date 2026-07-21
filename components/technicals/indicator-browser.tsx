import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface IndicatorBrowserProps {
  active: string[];
  onToggleIndicator: (name: string) => void;
  onClose: () => void;
}

export function IndicatorBrowser({ active, onToggleIndicator, onClose }: IndicatorBrowserProps) {
  const indicators = [
    { name: "MA", desc: "Moving averages 20, 50, 200" },
    { name: "EMA", desc: "Exponential averages 21, 55" },
    { name: "BOLL", desc: "Bollinger Bands" },
    { name: "VOL", desc: "Volume" },
    { name: "MACD", desc: "Trend momentum" },
    { name: "RSI", desc: "Relative strength, 14 day" },
  ];

  return (
    <div className="absolute right-3 top-14 z-50 w-64 rounded-lg border border-border bg-popover p-2 shadow-lg">
      <div className="mb-1 flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold">Indicators</h3>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>×</Button>
      </div>
      <div className="flex max-h-75 flex-col gap-0.5 overflow-y-auto">
        {indicators.map(ind => {
          const isOn = active.includes(ind.name);
          return (
            <Button
              key={ind.name}
              variant="ghost"
              className="h-9 justify-start gap-0 text-xs"
              onClick={() => onToggleIndicator(ind.name)}
            >
              <span className={cn("w-12 text-left font-semibold", isOn && "text-emerald-700")}>{ind.name}</span>
              <span className="flex-1 truncate text-left text-muted-foreground">{ind.desc}</span>
              {isOn && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
