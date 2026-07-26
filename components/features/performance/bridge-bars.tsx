import { cn, formatNumber } from "@/lib/shared/format";

export interface BridgeBarRow {
  label: string;
  value: number;
  kind: "start" | "increase" | "decrease" | "end" | string;
  note?: string;
}

function barColor(row: BridgeBarRow, index: number): string {
  if (index === 0 || row.kind === "start") return "color-mix(in oklab, var(--indigo-3) 72%, var(--surface-page))";
  if (row.kind === "end") return "var(--ink-2)";
  if (/dividend/i.test(row.label)) return "var(--saffron-2)";
  return row.value >= 0 ? "var(--up-1)" : "var(--down-1)";
}

function textColor(row: BridgeBarRow, index: number): string {
  if (index === 0 || row.kind === "start" || row.kind === "end") return "var(--text-strong)";
  if (/dividend/i.test(row.label)) return "var(--saffron-1)";
  return row.value >= 0 ? "var(--text-up)" : "var(--text-down)";
}

/**
 * The design's wealth-creation bridge: floating columns whose offsets carry
 * the running total from capital in to net worth, values printed above each
 * bar and labels ruled off beneath.
 */
export function BridgeBars({ rows }: { rows: BridgeBarRow[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const px = (v: number) => Math.max((Math.abs(v) / max) * 190, 3);

  let running = 0;
  const bars = rows.map((row, i) => {
    const isEdge = i === 0 || row.kind === "start" || row.kind === "end";
    const offset = isEdge ? 0 : (Math.min(running, running + row.value) / max) * 190;
    if (!isEdge) running += row.value;
    else if (i === 0 || row.kind === "start") running = row.value;
    return { row, i, offset: Math.max(0, offset) };
  });

  return (
    <div>
      <div className="grid items-end gap-3.5" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))`, height: 220 }}>
        {bars.map(({ row, i, offset }) => (
          <div key={row.label} className="flex h-full flex-col justify-end">
            <span className="figure mb-2 text-sm font-semibold" style={{ color: textColor(row, i) }}>
              {row.value < 0 ? "−" : row.kind === "increase" ? "+" : ""}{formatNumber(Math.abs(row.value), 0)}
            </span>
            <span style={{ height: px(row.value), marginBottom: offset, background: barColor(row, i) }} />
          </div>
        ))}
      </div>
      <div className="grid gap-3.5 border-t border-rule-strong pt-2.5" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }}>
        {rows.map((row) => (
          <span key={row.label} className={cn("text-xs text-text-muted")}>{row.label}</span>
        ))}
      </div>
    </div>
  );
}
