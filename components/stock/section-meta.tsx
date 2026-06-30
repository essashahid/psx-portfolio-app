import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/action-button";
import { RefreshCw } from "lucide-react";
import { freshnessLabel } from "@/lib/company/freshness";
import type { SectionMeta as SectionMetaT } from "@/lib/company/types";

function freshnessVariant(f: SectionMetaT["freshness"]) {
  switch (f) {
    case "fresh": return "green" as const;
    case "stale": return "amber" as const;
    case "partial": return "blue" as const;
    case "needs_review": return "amber" as const;
    default: return "secondary" as const;
  }
}

/** Source + last-updated + freshness row shown under each data section. */
export function SectionMeta({
  meta,
  ticker,
  refreshSection,
}: {
  meta: SectionMetaT;
  ticker?: string;
  refreshSection?: string;
}) {
  // When an update date is shown, a green "Fresh" badge is redundant noise — only
  // surface the badge for states that need attention (stale, partial, etc.).
  const showBadge = meta.freshness !== "fresh" || !meta.lastUpdated;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
      {showBadge && <Badge variant={freshnessVariant(meta.freshness)}>{freshnessLabel(meta.freshness)}</Badge>}
      {meta.source && (
        <span>
          Source:{" "}
          {meta.sourceUrl ? (
            <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
              {meta.source}
            </a>
          ) : (
            meta.source
          )}
        </span>
      )}
      {meta.lastUpdated && <span>· Updated {meta.lastUpdated.slice(0, 10)}</span>}
      {ticker && refreshSection && (
        <ActionButton
          endpoint={`/api/stocks/${ticker}/refresh`}
          body={{ section: refreshSection }}
          label={<><RefreshCw className="h-3 w-3" /> Refresh</>}
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px]"
        />
      )}
    </div>
  );
}
