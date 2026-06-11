import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { PageHeader } from "@/components/page-header";
import { HoldingsTable } from "@/components/holdings-table";
import { AddTransactionDialog } from "@/components/add-transaction-dialog";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Briefcase, Download, RefreshCw, Sparkles, Upload } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const summary = await getPortfolio(supabase, user.id);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portfolio"
        title="Holdings"
        description="Every position with cost, value, targets and thesis health. Click a ticker for its research workspace."
        actions={
          <>
            <ActionButton
              endpoint="/api/prices"
              body={{ refresh: true }}
              label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh prices</>}
              variant="outline"
              size="sm"
            />
            <ActionButton
              endpoint="/api/holdings/enrich"
              label={<><Sparkles className="h-3.5 w-3.5" /> Enrich metadata</>}
              variant="outline"
              size="sm"
            />
            <AddTransactionDialog />
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download, not a page navigation */}
            <a href="/api/export/holdings">
              <Button variant="outline" size="sm">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </a>
          </>
        }
      />
      {summary.holdings.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No holdings yet"
          description="Import an AKD/CDC statement or add a manual transaction to get started."
          action={
            <Link href="/import">
              <Button><Upload className="h-4 w-4" /> Import a statement</Button>
            </Link>
          }
        />
      ) : (
        <HoldingsTable holdings={summary.holdings} summary={summary} />
      )}
    </div>
  );
}
