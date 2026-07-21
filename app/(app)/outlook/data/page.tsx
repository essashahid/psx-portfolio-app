import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { AboutDataView } from "@/components/outlook/about-data-view";

export const dynamic = "force-dynamic";

/**
 * Plain-language companion to the Outlook tab.
 *
 * Deliberately number-free and table-free: what the feature is, what it is
 * allowed to say, and where its information comes from, written for a reader
 * who is not a market specialist. The full research detail lives at
 * /outlook/research for anyone who wants the workings.
 */
export default function OutlookDataPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="PSX Market Outlook"
        title="About this outlook"
        description="What this feature is, what it is allowed to say, and where its information comes from."
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
      <AboutDataView />
    </div>
  );
}
