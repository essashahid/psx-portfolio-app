import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { FileWarning } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Data review" };

/**
 * The two queues the extraction pipeline fills and nothing ever showed.
 *
 * A row parked in needs_review is excluded from every read path, so on the
 * stock page it looks exactly like data that was never fetched. A conflict is
 * worse: two extractions disagree about the same period, the reader is served
 * whichever was written last, and there is no marker saying so.
 *
 * This is visibility, not a workflow. Nothing here resolves anything; it exists
 * so the size and shape of the backlog is knowable before Phase 3 decides what
 * to do about it.
 */
export default async function DataReviewPage() {
  const supabase = createAdminClient();

  const [needsReview, conflicts] = await Promise.all([
    supabase
      .from("company_financials")
      .select("ticker, statement_type, period_type, fiscal_year, fiscal_period, source_type, updated_at")
      .eq("review_status", "needs_review")
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("financial_statement_conflicts")
      .select("id, ticker, statement_type, fiscal_year, fiscal_period, conflict_type, severity, message, created_at")
      .eq("status", "open")
      .order("severity", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const review = needsReview.data ?? [];
  const open = conflicts.data ?? [];

  // Which companies carry the most withheld rows: the useful first question.
  const byTicker = new Map<string, number>();
  for (const r of review) byTicker.set(r.ticker, (byTicker.get(r.ticker) ?? 0) + 1);
  const worst = [...byTicker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  const severityTone = (s: string | null) =>
    s === "high" ? "red" : s === "medium" ? "amber" : "secondary";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Data review</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Financial rows the extractor withheld, and periods where two extractions disagree. Both are
          invisible everywhere else in the app: a withheld row reads as missing data, and a conflict is
          served silently as whichever version was written last.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              Rows withheld
            </p>
            <p className="figure mt-1.5 text-(length:--text-h1) font-semibold">{review.length}</p>
            <p className="figure mt-0.5 text-xs text-text-muted">
              {byTicker.size} companies{review.length === 500 ? " · showing first 500" : ""}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              Open conflicts
            </p>
            <p className="figure mt-1.5 text-(length:--text-h1) font-semibold">{open.length}</p>
            <p className="figure mt-0.5 text-xs text-text-muted">
              {open.length === 200 ? "showing first 200" : "all of them"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              Worst company
            </p>
            <p className="figure mt-1.5 text-(length:--text-h1) font-semibold">{worst[0]?.[0] ?? "—"}</p>
            <p className="figure mt-0.5 text-xs text-text-muted">
              {worst[0] ? `${worst[0][1]} withheld rows` : "nothing withheld"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Most withheld rows, by company</h2>
          {worst.length === 0 ? (
            <EmptyState icon={FileWarning} title="Nothing withheld" description="Every extracted row is published." />
          ) : (
            <Table variant="reader">
              <THead>
                <TR>
                  <TH>Ticker</TH>
                  <TH className="text-right">Withheld rows</TH>
                  <TH>Open on the stock page</TH>
                </TR>
              </THead>
              <TBody>
                {worst.map(([ticker, count]) => (
                  <TR key={ticker}>
                    <TD className="font-medium text-text-strong">{ticker}</TD>
                    <TD className="text-right tabular-nums">{count}</TD>
                    <TD>
                      <Link href={`/stocks/${ticker}`} className="text-text-muted underline-offset-2 hover:text-text-strong hover:underline">
                        /stocks/{ticker}
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Open conflicts</h2>
          {open.length === 0 ? (
            <EmptyState icon={FileWarning} title="No open conflicts" description="No period has two extractions disagreeing." />
          ) : (
            <Table variant="reader" className="min-w-[52rem]">
              <THead>
                <TR>
                  <TH>Ticker</TH>
                  <TH>Period</TH>
                  <TH>Statement</TH>
                  <TH>Kind</TH>
                  <TH>Severity</TH>
                  <TH>What disagrees</TH>
                </TR>
              </THead>
              <TBody>
                {open.slice(0, 60).map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-text-strong">{c.ticker}</TD>
                    <TD className="tabular-nums text-text-muted">
                      {c.fiscal_year}
                      {c.fiscal_period ? ` ${c.fiscal_period}` : ""}
                    </TD>
                    <TD className="text-text-muted">{c.statement_type}</TD>
                    <TD className="text-text-muted">{c.conflict_type}</TD>
                    <TD>
                      <Badge variant={severityTone(c.severity)}>{c.severity ?? "unknown"}</Badge>
                    </TD>
                    <TD className="text-text-muted">{c.message ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {open.length > 60 && (
            <p className="mt-3 text-(length:--text-2xs) text-text-faint">
              Showing 60 of {open.length} loaded. Resolving them is Phase 3 work, not something to do row by row here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
