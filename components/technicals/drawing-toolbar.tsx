import { Button } from "@/components/ui/button";
import { TrendingUp, Minus, MoveUpRight, Tag, Ruler, Eraser } from "lucide-react";

interface DrawingToolbarProps {
  onSelectTool: (overlayName: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

/**
 * Drawing tools, mapped to KLineCharts built-in overlay names. Selecting one
 * starts an interactive placement: the user clicks the chart to set each
 * point.
 */
export function DrawingToolbar({ onSelectTool, onClearAll, onClose }: DrawingToolbarProps) {
  const tools = [
    { name: "segment", label: "Trend line", desc: "Two points", icon: TrendingUp },
    { name: "rayLine", label: "Ray", desc: "Extends from a point", icon: MoveUpRight },
    { name: "horizontalStraightLine", label: "Horizontal line", desc: "A level across the chart", icon: Minus },
    { name: "priceLine", label: "Price line", desc: "A level with its price label", icon: Tag },
    { name: "fibonacciLine", label: "Fibonacci", desc: "Retracement levels", icon: Ruler },
  ];

  return (
    <div className="absolute right-3 top-14 z-50 w-64 rounded-lg border border-border bg-popover p-2 shadow-lg">
      <div className="mb-1 flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold">Draw</h3>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>×</Button>
      </div>
      <div className="flex flex-col gap-0.5">
        {tools.map((tool) => (
          <Button
            key={tool.name}
            variant="ghost"
            className="h-9 justify-start gap-2 text-xs"
            onClick={() => onSelectTool(tool.name)}
          >
            <tool.icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{tool.label}</span>
            <span className="truncate text-muted-foreground">{tool.desc}</span>
          </Button>
        ))}
        <div className="my-1 h-px bg-border" />
        <Button variant="ghost" className="h-9 justify-start gap-2 text-xs text-red-600 hover:text-red-700" onClick={onClearAll}>
          <Eraser className="h-3.5 w-3.5" />
          Clear all drawings
        </Button>
      </div>
    </div>
  );
}
