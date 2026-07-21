import { PageHeader } from "@/components/page-header";
import { MarketOutlookView } from "@/components/outlook/market-outlook-view";
import { getMarketOutlook } from "@/lib/engine/outlook/read";

export const dynamic = "force-dynamic";

/**
 * PSX Market Outlook.
 *
 * Reads the cached outlook: the underlying data is end-of-day and identical
 * for every user, so it is assembled once per hour rather than on each load.
 */
export default async function OutlookPage() {
  const outlook = await getMarketOutlook();

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PSX Market Outlook"
        title="What may happen next"
        description="A simple market view combining price structure, market activity, economic conditions and global developments."
      />
      <MarketOutlookView outlook={outlook} />
    </div>
  );
}
