import type { ReactNode } from "react";
import { cn } from "@/lib/shared/format";

/**
 * The editorial metric block: a caps label, a figure value, an optional
 * sub-line under it.
 *
 * The dashboard hero, the Stock Research hero and the stock cockpit header
 * printed these same three lines from three separate copies. What genuinely
 * differed between them was the container, which is why that stays with the
 * caller as `className` rather than becoming a set of layout props: the
 * dashboard pads to the page gutter, the screener sits flush, and the cockpit
 * rules its cells with a left border. A primitive that tried to own all of
 * that would be a configuration table, not a component.
 *
 *   hero     dashboard and screener heroes, --text-h1
 *   compact  the cockpit header strip, one step down the scale
 *
 * Values take a ReactNode because the dashboard prints a formatted amount with
 * its own markup inside.
 */
export function Metric({
  label,
  value,
  sub,
  tone,
  size = "hero",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "up" | "down";
  size?: "hero" | "compact";
  className?: string;
}) {
  const hero = size === "hero";
  return (
    <div className={className}>
      <p
        className={cn(
          "font-bold uppercase tracking-(--tracking-caps) text-text-faint",
          hero ? "text-(length:--text-2xs)" : "text-(length:--text-3xs)"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "figure mt-1.5 font-semibold",
          hero ? "text-(length:--text-h1)" : "text-(length:--text-h2)",
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text-strong"
        )}
      >
        {value}
      </p>
      {sub &&
        (hero ? (
          <p className="figure mt-0.5 text-xs text-text-muted">{sub}</p>
        ) : (
          <p className="mt-0.5 text-(length:--text-2xs) text-text-faint">{sub}</p>
        ))}
    </div>
  );
}
