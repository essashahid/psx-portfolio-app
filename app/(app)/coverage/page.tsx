import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/guard";
import { providerConfigs } from "@/lib/providers/env";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ActionButton } from "@/components/action-button";
import { CoverageProbe } from "@/components/coverage-probe";
import { cn } from "@/lib/utils";
import { Database, Server, RefreshCw, Activity } from "lucide-react";

export const dynamic = "force-dynamic";

function Stat({ label, value, total }: { label: string; value: number; total?: number }) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">
        {value.toLocaleString("en-PK")}
        {pct !== null && <span className="ml-1 text-xs font-normal text-muted-foreground">({pct}%)</span>}
      </p>
    </div>
  );
}

export default async function CoveragePage() {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) redirect("/dashboard");

  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [
    { count: universeCount },
    { count: quoteCount },
    statusRes,
    techRows,
    finRows,
    ratioRows,
    histRows,
    logsRes,
  ] = await Promise.all([
    supabase.from("stock_universe").select("ticker", { count: "exact", head: true }),
    supabase.from("market_quotes").select("ticker", { count: "exact", head: true }),
    supabase.from("data_provider_status").select("*").order("provider"),
    supabase.from("company_technicals").select("ticker").not("as_of_date", "is", null),
    supabase.from("company_financials").select("ticker").eq("review_status", "published"),
    supabase.from("company_ratios").select("ticker").not("ratio_value", "is", null),
    supabase.from("company_price_history").select("ticker").limit(10000),
    supabase
      .from("data_fetch_logs")
      .select("ticker, section, source, status, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const distinct = (rows: { ticker: string }[] | null) => new Set((rows ?? []).map((r) => r.ticker)).size;
  const universe = universeCount ?? 0;
  const statuses = statusRes.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Data engine"
        title="Coverage & Providers"
        description="What the Stock Data Engine has populated across the PSX universe, which providers are healthy, and what failed recently."
        actions={
          <>
            <ActionButton
              endpoint="/api/engine/universe"
              label={<><Database className="h-3.5 w-3.5" /> Sync PSX universe</>}
              variant="outline"
              size="sm"
            />
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Data coverage</CardTitle>
          <CardDescription>
            {universe > 0
              ? `${universe.toLocaleString("en-PK")} PSX listings in the universe. Percentages are share of the universe.`
              : "Universe not synced yet — run “Sync PSX universe” to load all PSX listings from the official directory."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Universe" value={universe} />
            <Stat label="Latest quotes" value={quoteCount ?? 0} total={universe} />
            <Stat label="Price history" value={distinct(histRows.data)} total={universe} />
            <Stat label="Technicals" value={distinct(techRows.data)} total={universe} />
            <Stat label="Financials" value={distinct(finRows.data)} total={universe} />
            <Stat label="Ratios" value={distinct(ratioRows.data)} total={universe} />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Quotes and technicals populate on demand when a stock page is opened, and in batches via the refresh worker
            (<code className="rounded bg-muted px-1">/api/engine/refresh?task=quotes&scope=universe</code>). Financials populate from
            official filings via the extraction queue.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Server className="h-4 w-4" /> Providers</CardTitle>
          <CardDescription>Configuration and live health of every data source in the fallback chain.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead>
              <TR><TH>Provider</TH><TH>Configured</TH><TH>Health</TH><TH>Last success</TH><TH>Last error</TH></TR>
            </THead>
            <TBody>
              {providerConfigs().map((p) => {
                const s = statuses.find((x) => x.provider === p.name);
                return (
                  <TR key={p.name}>
                    <TD>
                      <p className="text-xs font-medium">{p.label}</p>
                      <p className="text-[10px] text-muted-foreground">{p.detail}</p>
                    </TD>
                    <TD><Badge variant={p.configured ? "green" : "secondary"}>{p.configured ? "yes" : "no"}</Badge></TD>
                    <TD>
                      {s?.rate_limited ? (
                        <Badge variant="amber">rate limited</Badge>
                      ) : s?.healthy === true ? (
                        <Badge variant="green">healthy</Badge>
                      ) : s?.healthy === false ? (
                        <Badge variant="red">failing</Badge>
                      ) : (
                        <Badge variant="outline">untested</Badge>
                      )}
                    </TD>
                    <TD className="text-[11px] text-muted-foreground">{s?.last_success_at ? String(s.last_success_at).slice(0, 16).replace("T", " ") : "—"}</TD>
                    <TD className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={s?.last_error ?? undefined}>
                      {s?.last_error ? `${String(s.last_error_at ?? "").slice(0, 10)} — ${s.last_error}` : "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Test ticker coverage</CardTitle>
          <CardDescription>Probe every provider for one ticker — results are stored in the symbol map so the engine remembers what works.</CardDescription>
        </CardHeader>
        <CardContent>
          <CoverageProbe />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent fetches</CardTitle>
          <CardDescription>Latest engine activity across all sections.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {(logsRes.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No fetch activity logged yet. Open a stock page or run a refresh.</p>
          ) : (
            <Table>
              <THead>
                <TR><TH>When</TH><TH>Ticker</TH><TH>Section</TH><TH>Source</TH><TH>Status</TH><TH>Detail</TH></TR>
              </THead>
              <TBody>
                {(logsRes.data ?? []).map((l, i) => (
                  <TR key={i}>
                    <TD className="text-[11px] text-muted-foreground">{String(l.created_at).slice(5, 16).replace("T", " ")}</TD>
                    <TD className="text-xs font-medium">{l.ticker ?? "—"}</TD>
                    <TD className="text-xs">{l.section}</TD>
                    <TD className="text-[11px] text-muted-foreground">{l.source}</TD>
                    <TD>
                      <span className={cn("text-xs font-medium", l.status === "ok" ? "text-emerald-600" : l.status === "error" ? "text-red-600" : "text-muted-foreground")}>
                        {l.status}
                      </span>
                    </TD>
                    <TD className="max-w-[260px] truncate text-[11px] text-muted-foreground" title={l.detail ?? undefined}>{l.detail ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
