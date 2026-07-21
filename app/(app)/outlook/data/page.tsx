import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { OutlookCoverageView } from "@/components/outlook/outlook-coverage-view";
import { SignalEvidenceView } from "@/components/outlook/signal-evidence-view";
import { buildOutlookCoverage } from "@/lib/engine/outlook/coverage";
import { loadAlignedInputs } from "@/lib/engine/outlook/inputs";
import { buildSignalEvidence } from "@/lib/engine/outlook/evaluate";

export const dynamic = "force-dynamic";

/**
 * The evidence behind the Outlook tab: full coverage, freshness, known gaps and
 * every horizon measured, including the ones the main view leaves out.
 */
export default async function OutlookDataPage() {
  const supabase = await createClient();
  const [report, inputs] = await Promise.all([buildOutlookCoverage(supabase), loadAlignedInputs(supabase)]);
  const evidence = buildSignalEvidence(inputs);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PSX Market Outlook"
        title="About this data"
        description="What history the platform holds, how current it is, what is missing, and the full statistics behind the main view."
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
      <SignalEvidenceView report={evidence} />
      <OutlookCoverageView report={report} />
    </div>
  );
}
