import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { DataDashboardView } from "@/components/outlook/data-dashboard-view";
import { buildOutlookCoverage } from "@/lib/engine/outlook/coverage";
import { loadAlignedInputs } from "@/lib/engine/outlook/inputs";
import { buildSignalEvidence } from "@/lib/engine/outlook/evaluate";
import { buildDataDashboard } from "@/lib/engine/outlook/data-dashboard";

export const dynamic = "force-dynamic";

/**
 * The research and evidence dashboard behind the Outlook tab.
 *
 * Access is inherited from /outlook through the feature flag, so this stays
 * gated with the parent rather than carrying its own rule.
 */
export default async function OutlookDataPage() {
  const supabase = await createClient();
  const [coverage, inputs] = await Promise.all([buildOutlookCoverage(supabase), loadAlignedInputs(supabase)]);
  const evidence = buildSignalEvidence(inputs);
  const dashboard = buildDataDashboard(coverage, evidence);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PSX Market Outlook"
        title="Research and evidence"
        description="What the market has done, which warning signals survived testing against that record, and what data stands behind the conclusions."
        actions={
          <Link
            href="/outlook"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition-colors duration-(--dur-fast) ease-(--ease-ui) hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            Back to Outlook
          </Link>
        }
      />
      <DataDashboardView dashboard={dashboard} coverage={coverage} evidence={evidence} />
    </div>
  );
}
