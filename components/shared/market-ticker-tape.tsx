import { cn } from "@/lib/shared/format";

export type TickerItem = {
  label: string;
  value: string;
  change?: string;
  tone?: "up" | "down" | "flat";
};

/**
 * Scrolling market-snapshot strip under the top nav. Two duplicated runs of
 * the same item list, offset by a CSS keyframe animation that translates by
 * exactly -50%, so the loop is seamless regardless of viewport width.
 */
export function MarketTickerTape({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="border-y border-rule bg-surface-sunken px-(--gutter-page-sm) py-1.5 sm:px-(--gutter-page)">
      <div className="om-tape flex items-center">
        <TapeRun items={items} />
        <TapeRun items={items} aria-hidden />
      </div>
    </div>
  );
}

function TapeRun({ items, "aria-hidden": ariaHidden }: { items: TickerItem[]; "aria-hidden"?: boolean }) {
  return (
    <div className="om-tape-run flex items-center" aria-hidden={ariaHidden || undefined}>
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="mr-6 flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-faint">{item.label}</span>
          <span className="figure text-[11px] font-semibold text-text-muted">{item.value}</span>
          {item.change ? (
            <span
              className={cn(
                "figure text-[10px] font-semibold",
                item.tone === "up" ? "text-up" : item.tone === "down" ? "text-down" : "text-text-faint"
              )}
            >
              {item.change}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
