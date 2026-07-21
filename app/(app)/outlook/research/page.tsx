import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAdminContext } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Phase3Review, type Phase3Evaluation } from "@/components/outlook/phase3-review";
import { DataDashboardView } from "@/components/outlook/data-dashboard-view";
import { buildOutlookCoverage } from "@/lib/engine/outlook/coverage";
import { loadAlignedInputs } from "@/lib/engine/outlook/inputs";
import { buildSignalEvidence } from "@/lib/engine/outlook/evaluate";
import { buildDataDashboard } from "@/lib/engine/outlook/data-dashboard";
import type { ExperimentalOutlook } from "@/lib/engine/outlook/experimental-outlook";
import phase3Evaluation from "@/data/outlook-phase3-evaluation.json";
import experimentalOutlook from "@/data/outlook-experimental.json";

export const dynamic = "force-dynamic";

/**
 * The research workbench: everything behind the Outlook, for review rather
 * than for customers. Phase 3 gates and the experimental preview come from the
 * committed artifacts (the exact evaluated run); the Phase 2 dashboard is
 * computed live from the database as before.
 */
export default async function OutlookResearchPage() {
  // Internal review surface: model evaluation, failed candidates and the
  // experimental preview. Kept off the customer path entirely, not merely
  // unlinked, so it cannot be reached by typing the URL.
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) redirect("/outlook");

  const supabase = await createClient();
  const [coverage, inputs] = await Promise.all([buildOutlookCoverage(supabase), loadAlignedInputs(supabase)]);
  const evidence = buildSignalEvidence(inputs);
  const dashboard = buildDataDashboard(coverage, evidence);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PSX Market Outlook"
        title="Research workbench"
        description="Model evaluation, signal research and data coverage in full. Nothing here is customer-facing; the experimental preview is not production-approved."
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
      <Phase3Review
        evaluation={phase3Evaluation as unknown as Phase3Evaluation}
        outlook={experimentalOutlook as unknown as ExperimentalOutlook}
      />
      <DataDashboardView dashboard={dashboard} coverage={coverage} evidence={evidence} />
    </div>
  );
}
