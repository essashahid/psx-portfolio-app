import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { OutlookView } from "@/components/outlook/outlook-view";
import { buildOutlookCoverage } from "@/lib/engine/outlook/coverage";
import { buildOutlookViewModel } from "@/lib/engine/outlook/presentation";

export const dynamic = "force-dynamic";

/**
 * PSX Market Outlook, Phase 1.
 *
 * The finished feature will carry probability-based scenarios. Today it carries
 * the historical record those scenarios would have to beat. The report is built
 * server-side and trimmed to a view model before crossing to the client, so the
 * fifteen-series coverage detail stays on the data page where it is used.
 */
export default async function OutlookPage() {
  const supabase = await createClient();
  const report = await buildOutlookCoverage(supabase);
  const model = buildOutlookViewModel(report);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Research"
        title="PSX Market Outlook"
        description="How the Pakistani market has behaved over the past five years, and how reliable that record is. The foundation for an early-warning system being built in phases."
      />
      <OutlookView model={model} />
    </div>
  );
}
