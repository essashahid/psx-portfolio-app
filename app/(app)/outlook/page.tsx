import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/guard";
import { PageHeader } from "@/components/page-header";
import { OutlookCoverageView } from "@/components/outlook/outlook-coverage-view";
import { buildOutlookCoverage } from "@/lib/engine/outlook/coverage";

export const dynamic = "force-dynamic";

/**
 * PSX Market Outlook, Phase 1.
 *
 * The finished feature will carry probability-based scenarios. Today it carries
 * only the data audit that decides whether those scenarios can be built at all,
 * and over which horizons. Kept admin-only until a model exists and has been
 * validated, so nothing here can be mistaken for a market call.
 */
export default async function OutlookPage() {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) redirect("/dashboard");

  const supabase = await createClient();
  const report = await buildOutlookCoverage(supabase);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Research"
        title="PSX Market Outlook"
        description="An early-warning and forecasting system for the PSX, built in phases. This is the data foundation: what history exists, how reliable it is, and how the market has behaved in the past."
      />
      <OutlookCoverageView report={report} />
    </div>
  );
}
