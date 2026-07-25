import { cn } from "@/lib/shared/format";

/**
 * Eyebrow plus editorial heading, ruled underneath. The repeating unit that
 * titles a panel inside a band.
 */
export function PanelHeader({
  eyebrow,
  title,
  aside,
  className,
}: {
  eyebrow?: string;
  title: string;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-2.5", className)}>
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-1 font-display text-(length:--text-h2) font-normal tracking-editorial text-text-strong">
          {title}
        </h2>
      </div>
      {aside}
    </div>
  );
}
