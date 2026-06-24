import { cn } from "@/lib/utils";
import { sectorChipStyle } from "@/lib/sectors";

/**
 * A sector shown as a small colored chip: a dot in the sector's stable colour,
 * a faint tint behind it, and darkened text. Used wherever a sector appears so
 * the same sector always reads as the same colour across the app.
 *
 * Pure and presentational, so it works in both server and client components.
 */
export function SectorChip({
  sector,
  className,
  size = "sm",
}: {
  sector?: string | null;
  className?: string;
  size?: "sm" | "xs";
}) {
  if (!sector || !sector.trim()) {
    return <span className={cn("text-xs text-amber-600", className)}>Unclassified</span>;
  }
  const s = sectorChipStyle(sector);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full font-medium",
        size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        className
      )}
      style={{ backgroundColor: s.background, color: s.color }}
      title={sector}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.dot }} />
      <span className="truncate">{sector}</span>
    </span>
  );
}

/** Just the colored dot, for tight spaces (legends, inline rows). */
export function SectorDot({ sector, className }: { sector?: string | null; className?: string }) {
  const s = sectorChipStyle(sector);
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: s.dot }}
      title={sector ?? "Unclassified"}
    />
  );
}
