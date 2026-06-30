import { Button } from "@/components/ui/button";

interface IndicatorBrowserProps {
  onSelectIndicator: (name: string) => void;
  onClose: () => void;
}

export function IndicatorBrowser({ onSelectIndicator, onClose }: IndicatorBrowserProps) {
  const indicators = [
    { name: "MA", desc: "Moving Average" },
    { name: "EMA", desc: "Exponential Moving Average" },
    { name: "SMA", desc: "Simple Moving Average" },
    { name: "BOLL", desc: "Bollinger Bands" },
    { name: "VOL", desc: "Volume" },
    { name: "MACD", desc: "Moving Average Convergence Divergence" },
    { name: "RSI", desc: "Relative Strength Index" },
  ];

  return (
    <div className="absolute top-14 left-4 z-50 w-64 rounded-md border border-border bg-popover p-2 shadow-md">
      <div className="mb-2 flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold">Indicators</h3>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>×</Button>
      </div>
      <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
        {indicators.map(ind => (
          <Button
            key={ind.name}
            variant="ghost"
            className="justify-start text-xs h-8"
            onClick={() => { onSelectIndicator(ind.name); onClose(); }}
          >
            <span className="font-semibold w-12">{ind.name}</span>
            <span className="text-muted-foreground truncate">{ind.desc}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
