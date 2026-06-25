import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyReportViewer } from "@/components/stock/company-report-viewer";
import { RefreshReportButton } from "@/components/stock/refresh-report-button";
import { FileText } from "lucide-react";
import type { CompanyReportPayload } from "@/lib/company/report";

export const dynamic = "force-dynamic";

export default async function ResearchLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  let query = supabase
    .from("ai_briefings")
    .select("id, ticker, title, created_at, meta")
    .eq("user_id", user.id)
    .eq("briefing_type", "company_report")
    .order("created_at", { ascending: false })
    .limit(40);
  if (sp.ticker) query = query.eq("ticker", sp.ticker.toUpperCase());
  const { data: reports } = await query;

  const selectedId = sp.id ?? reports?.[0]?.id;
  const selected = reports?.find((r) => r.id === selectedId) ?? reports?.[0];
  const payload = selected
    ? ((selected.meta as { reportPayload?: CompanyReportPayload })?.reportPayload ?? null)
    : null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Research"
        title="Saved company reports"
        description="Versioned equity-research reports with source-backed data, interactive sections, and exports."
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
          <CardContent className="p-2">
            {(!reports || reports.length === 0) && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No reports yet. Generate one from Stock Research or Holdings.
              </p>
            )}
            {reports?.map((r) => {
              const v = (r.meta as { reportVersion?: number })?.reportVersion ?? 1;
              const active = r.id === selected?.id;
              return (
                <Link
                  key={r.id}
                  href={`/research?id=${r.id}`}
                  className={`block rounded-md px-2.5 py-2 text-left transition-colors ${active ? "bg-accent" : "hover:bg-muted"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{r.ticker}</span>
                    <Badge variant="secondary" className="text-[10px]">v{v}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{r.title}</p>
                  <p className="text-[10px] text-muted-foreground">{r.created_at.slice(0, 16).replace("T", " ")}</p>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-3">
          {selected && payload ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/reports/company/${selected.id}/pdf`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                >
                  <FileText className="h-3.5 w-3.5" /> PDF
                </a>
                <a
                  href={`/api/reports/company/${selected.id}/docx`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                >
                  DOCX
                </a>
                <RefreshReportButton reportId={selected.id} />
                <Link href={`/stocks/${selected.ticker}`} className="text-xs text-muted-foreground hover:text-foreground">
                  Open {selected.ticker} research →
                </Link>
              </div>
              {payload.versionDiff && payload.versionDiff.summary.length > 0 && payload.reportVersion > 1 && (
                <Card>
                  <CardContent className="p-3 text-xs">
                    <p className="font-semibold">What changed since previous version</p>
                    <ul className="mt-1 list-inside list-disc text-muted-foreground">
                      {payload.versionDiff.summary.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              )}
              <CompanyReportViewer payload={payload} reportId={selected.id} />
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Select a report</p>
                <p className="text-xs text-muted-foreground">Or generate a new report from any company page.</p>
                <Link href="/stocks" className="text-xs font-medium text-primary hover:underline">Browse stocks</Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
