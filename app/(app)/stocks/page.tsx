import { createClient, getUser } from "@/lib/supabase/server";
import { getScreenerData } from "@/lib/market/screener";
import { fmtPct, fmtInt, tone } from "@/lib/market/format";
import { PageHeader } from "@/components/page-header";
import { StockSearch } from "@/components/stock-search";
import { StockScreener } from "@/components/market/stock-screener";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { cn } from "@/lib/utils";
import { normalizeEnabledFeatures } from "@/lib/features";
import { Activity, RefreshCw, DatabaseZap, Layers } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StockResearchPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [d, profileRes] = await Promise.all([
    getScreenerData(supabase, user.id),
    supabase.from("profiles").select("enabled_features, demo_mode").eq("id", user.id).maybeSingle(),
  ]);
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const companyReportsEnabled = normalizeEnabledFeatures(profileRes.data?.enabled_features).includes("company_reports");
  const indexTone = tone(d.index?.changePercent);
  const coveragePct = d.coverage.total ? Math.round((d.coverage.withSpark / d.coverage.total) * 100) : 0;

  const actions = isDemo ? null : (
    <div className="flex items-center gap-2">
      <ActionButton endpoint="/api/market/refresh" body={{ section: "snapshot" }} label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh prices</>} variant="outline" size="sm" />
      <ActionButton endpoint="/api/market/backfill" body={{ limit: 60 }} label={<><DatabaseZap className="h-3.5 w-3.5" /> Build deep data</>} variant="outline" size="sm" />
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Company intelligence"
        title="Stock Research"
        description="Screen the whole PSX — prices, trends, 52-week range, volume and your positions in one fast view. Open any company for its full cockpit."
        actions={actions}
      />

      <StockSearch autoFocus companyReportsEnabled={companyReportsEnabled} />

      {!d.snapshotDate ? (
        <EmptyState
          icon={Activity}
          title="No market data yet"
          description="The screener is powered by the daily market snapshot. Refresh prices to pull the whole PSX, then build deep data for sparklines and 52-week ranges."
          action={actions ?? undefined}
        />
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="rise">
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{d.index?.name ?? "Index"}</p>
                {d.index?.value != null ? (
                  <>
                    <p className="text-lg font-semibold tabular-nums">{d.index.value.toLocaleString("en-PK", { maximumFractionDigits: 0 })}</p>
                    <p className={cn("text-[11px] font-medium tabular-nums", indexTone === "positive" ? "text-emerald-600" : indexTone === "negative" ? "text-red-600" : "text-muted-foreground")}>{fmtPct(d.index.changePercent)}</p>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Unavailable</p>
                )}
              </CardContent>
            </Card>
            <Card className="rise rise-1">
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Breadth</p>
                <p className="text-lg font-semibold tabular-nums">
                  <span className="text-emerald-600">{d.breadth?.advancers ?? 0}</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span className="text-red-600">{d.breadth?.decliners ?? 0}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">advancing / declining</p>
              </CardContent>
            </Card>
            <Card className="rise rise-2">
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Stocks</p>
                <p className="text-lg font-semibold tabular-nums">{fmtInt(d.coverage.total)}</p>
                <p className="text-[11px] text-muted-foreground">traded today</p>
              </CardContent>
            </Card>
            <Card className="rise rise-3">
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"><Layers className="h-3 w-3" /> Deep data</p>
                <p className="text-lg font-semibold tabular-nums">{coveragePct}%</p>
                <p className="text-[11px] text-muted-foreground">{fmtInt(d.coverage.withSpark)} with trends</p>
              </CardContent>
            </Card>
          </div>

          <Card className="rise">
            <CardContent className="p-4 sm:p-5">
              <StockScreener stocks={d.stocks} />
            </CardContent>
          </Card>

          <p className="text-center text-[11px] text-muted-foreground">
            Source: official PSX market-watch via {d.source} · snapshot {d.snapshotDate}{d.updatedLabel ? ` · updated ${d.updatedLabel} PKT` : ""}. Sparklines &amp; 52-week ranges fill in as deep data is built. Data is cached and served fast; missing values are labelled, never invented.
          </p>
        </>
      )}
    </div>
  );
}
