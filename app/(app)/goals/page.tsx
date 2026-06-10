import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { PageHeader } from "@/components/page-header";
import { GoalsEditor } from "@/components/goals-editor";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TargetVsActualBar } from "@/components/charts-lazy";
import { Button } from "@/components/ui/button";
import { Target } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const summary = await getPortfolio(supabase, user.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Goals & Targets"
        description="Set target allocation, target price and review level per holding. Drift beyond 5 percentage points raises an alert."
      />
      {summary.holdings.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No holdings to set targets for"
          description="Import a statement first, then come back to define your plan."
          action={<Link href="/import"><Button>Go to Import Center</Button></Link>}
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Actual vs target allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <TargetVsActualBar
                data={summary.holdings
                  .filter((h) => h.target_allocation !== null)
                  .map((h) => ({ ticker: h.ticker, actual: h.weight ?? 0, target: h.target_allocation! }))}
              />
            </CardContent>
          </Card>
          <GoalsEditor holdings={summary.holdings} />
        </>
      )}
    </div>
  );
}
