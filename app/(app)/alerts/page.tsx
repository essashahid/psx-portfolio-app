import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/action-button";
import { DismissAlertButton } from "@/components/alert-actions";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Bell, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  price_above_target: "Price vs target",
  price_below_review: "Below review level",
  allocation_above_target: "Allocation drift",
  allocation_below_target: "Allocation drift",
  missing_thesis: "Missing thesis",
  review_due: "Review due",
  negative_news: "Negative news",
  dividend_news: "Dividend announcement",
  result_news: "Financial result",
  concentration_risk: "Concentration risk",
  import_issue: "Import issue",
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "history" ? "history" : "open";
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  let query = supabase
    .from("alerts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(80);
  if (view === "open") query = query.eq("status", "open");
  else query = query.neq("status", "open");
  const { data: alerts } = await query;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Signals"
        title="Alerts"
        description="Rule-based signals about what needs your attention — recomputed on every import, price update and news refresh."
        actions={
          <ActionButton
            endpoint="/api/alerts/refresh"
            label={<><RefreshCw className="h-3.5 w-3.5" /> Re-check now</>}
            variant="outline"
            size="sm"
          />
        }
      />

      <div className="flex gap-1.5">
        {(["open", "history"] as const).map((v) => (
          <Link
            key={v}
            href={`/alerts${v === "history" ? "?view=history" : ""}`}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-medium",
              view === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
            )}
          >
            {v === "open" ? "Open" : "Dismissed / resolved"}
          </Link>
        ))}
      </div>

      {(alerts ?? []).length === 0 ? (
        <EmptyState
          icon={Bell}
          title={view === "open" ? "No open alerts" : "No alert history"}
          description={
            view === "open"
              ? "Everything that has a rule is currently within bounds. Alerts appear for missing theses, allocation drift, review dates, target/review price levels, concentration, negative news and import issues."
              : "Dismissed and resolved alerts will appear here."
          }
        />
      ) : (
        <div className="space-y-2">
          {(alerts ?? []).map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
                    <Badge variant="outline">{TYPE_LABEL[a.alert_type] ?? a.alert_type}</Badge>
                    {a.ticker && (
                      <Link href={`/stocks/${a.ticker}`}>
                        <Badge variant="blue">{a.ticker}</Badge>
                      </Link>
                    )}
                    <span className="text-[11px] text-muted-foreground">{a.created_at.slice(0, 10)}</span>
                    {a.status !== "open" && <Badge variant="secondary">{a.status}</Badge>}
                  </div>
                  <h3 className="mt-1.5 text-sm font-medium">{a.title}</h3>
                  {a.message && <p className="mt-0.5 break-words text-xs text-muted-foreground">{a.message}</p>}
                </div>
                {a.status === "open" && <DismissAlertButton alertId={a.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
