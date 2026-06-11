import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { normalizeDividend, summarizeDividends } from "@/lib/dividends";
import { formatMoney, formatNumber, formatSignedPct, cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ThesisForm } from "@/components/thesis-form";
import { TargetForm } from "@/components/target-form";
import { StockAiActions } from "@/components/stock-ai-actions";
import { AddTransactionDialog } from "@/components/add-transaction-dialog";
import { ActionButton } from "@/components/action-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, sentimentVariant, thesisStatusVariant, severityVariant } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { Dividend, Target, Thesis } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = decodeURIComponent(rawTicker).toUpperCase();

  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const summary = await getPortfolio(supabase, user.id);
  const holding = summary.holdings.find((h) => h.ticker === ticker);
  if (!holding) notFound();

  const [thesisRes, targetRes, newsRes, journalRes, briefingsRes, alertsRes, txnRes, divRes] =
    await Promise.all([
      supabase.from("theses").select("*").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
      supabase.from("targets").select("*").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
      supabase
        .from("news_articles")
        .select("*")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .eq("ignored", false)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("journal_entries")
        .select("*")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .order("entry_date", { ascending: false })
        .limit(8),
      supabase
        .from("ai_briefings")
        .select("id, title, content, created_at")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("alerts")
        .select("id, alert_type, severity, title, message, created_at")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      supabase
        .from("transactions")
        .select("trade_date, type, quantity, price, net_amount, realized_pl, source")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .order("trade_date", { ascending: false })
        .limit(15),
      supabase
        .from("dividends")
        .select("*")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .order("payment_date", { ascending: false, nullsFirst: false })
        .limit(8),
    ]);

  const thesis = thesisRes.data as Thesis | null;
  const target = targetRes.data as Target | null;
  const stockDividends = ((divRes.data ?? []) as Dividend[]).map((row) => normalizeDividend(row as unknown as Record<string, unknown>));
  const stockDividendSummary = summarizeDividends(stockDividends);
  const dividendYieldOnCost = holding.total_cost > 0 ? (stockDividendSummary.netReceived / holding.total_cost) * 100 : null;

  return (
    <div className="space-y-5">
      <Link href="/holdings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to holdings
      </Link>
      <PageHeader
        eyebrow="Research workspace"
        title={`${ticker} — ${holding.company_name ?? ""}`}
        description={`${holding.sector ?? "Sector unknown"} · position source: ${holding.source} · last updated ${holding.last_updated.slice(0, 10)}`}
        actions={
          <>
            <ActionButton
              endpoint="/api/news/refresh"
              body={{ ticker }}
              label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh news</>}
              variant="outline"
              size="sm"
            />
            <AddTransactionDialog defaultTicker={ticker} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Quantity" value={formatNumber(holding.quantity, 0)} />
        <StatCard label="Avg cost" value={formatNumber(holding.avg_cost)} sub={`total ${formatNumber(holding.total_cost, 0)}`} />
        <StatCard
          label="Latest price"
          value={holding.latest_price !== null ? formatNumber(holding.latest_price) : "no price"}
          sub={holding.price_date ? `as of ${holding.price_date} (${holding.price_source})` : "set one in Settings"}
        />
        <StatCard
          label="Market value"
          value={holding.market_value !== null ? formatMoney(holding.market_value) : "—"}
          sub={holding.weight !== null ? `${holding.weight.toFixed(1)}% of portfolio` : undefined}
        />
        <StatCard
          label="Unrealized P/L"
          value={holding.unrealized_pl !== null ? formatMoney(holding.unrealized_pl) : "—"}
          sub={holding.unrealized_pl_pct !== null ? formatSignedPct(holding.unrealized_pl_pct) : undefined}
          tone={holding.unrealized_pl !== null ? (holding.unrealized_pl > 0 ? "positive" : holding.unrealized_pl < 0 ? "negative" : "neutral") : "neutral"}
        />
        <StatCard label="Dividend income" value={formatMoney(holding.dividend_income)} />
        <StatCard
          label="Dividend yield on cost"
          value={dividendYieldOnCost !== null ? `${dividendYieldOnCost.toFixed(1)}%` : "—"}
          sub={`${stockDividendSummary.pendingCount} pending`}
        />
      </div>

      {(alertsRes.data ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open alerts for {ticker}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(alertsRes.data ?? []).map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
                <span>{a.title}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>AI research actions</CardTitle>
          <CardDescription>
            Research support only — outputs never recommend buying or selling. Results are saved under AI Briefings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StockAiActions ticker={ticker} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Investment thesis
              {thesis && <Badge variant={thesisStatusVariant(thesis.status)}>{thesis.status}</Badge>}
              {thesis?.confidence && <Badge variant="outline">confidence {thesis.confidence}/5</Badge>}
            </CardTitle>
            <CardDescription>
              {thesis ? `Last updated ${thesis.updated_at.slice(0, 10)}` : "No thesis yet — write down why you own this."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ThesisForm ticker={ticker} thesis={thesis} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Goals & targets</CardTitle>
              <CardDescription>
                {holding.target_price !== null && holding.latest_price !== null
                  ? `Distance to target: ${formatSignedPct(holding.distance_to_target_pct)}`
                  : "Set a target price, allocation and review level."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TargetForm ticker={ticker} target={target} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent AI notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(briefingsRes.data ?? []).length === 0 && (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  No AI notes yet. Run an action above.
                </p>
              )}
              {(briefingsRes.data ?? []).map((b) => (
                <details key={b.id} className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    {b.title} <span className="text-muted-foreground">· {b.created_at.slice(0, 10)}</span>
                  </summary>
                  <div className="mt-2 max-h-64 overflow-y-auto">
                    <Markdown content={b.content} />
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>News for {ticker}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(newsRes.data ?? []).length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No stored news. Use “Refresh news” above to search with Tavily.
            </p>
          )}
          {(newsRes.data ?? []).map((n) => (
            <div key={n.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <div className="flex items-start gap-2">
                <Badge variant={sentimentVariant(n.sentiment)}>{n.sentiment ?? "unrated"}</Badge>
                {n.relevance_score && <Badge variant="outline">{n.relevance_score}/10</Badge>}
                {n.category && n.category !== "general" && <Badge variant="blue">{n.category}</Badge>}
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium leading-snug hover:underline">
                  {n.title}
                </a>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {n.source} {n.published_at ? `· ${String(n.published_at).slice(0, 10)}` : ""}
              </p>
              {n.ai_summary && <p className="mt-1.5 text-xs">{n.ai_summary}</p>}
              {n.thesis_impact && (
                <p className="mt-1 text-xs"><span className="font-medium">Thesis impact:</span> {n.thesis_impact}</p>
              )}
              {n.review_question && (
                <p className="mt-1 text-xs italic text-muted-foreground">Ask yourself: {n.review_question}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Transactions & dividends</CardTitle>
          </CardHeader>
          <CardContent>
            {(txnRes.data ?? []).length === 0 && stockDividends.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No transaction history — this position came from a holdings snapshot.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH><TH>Type</TH><TH className="text-right">Qty</TH><TH className="text-right">Price</TH><TH className="text-right">Net</TH><TH className="text-right">Realized P/L</TH>
                  </TR>
                </THead>
                <TBody>
                  {(txnRes.data ?? []).map((t, i) => (
                    <TR key={`t${i}`}>
                      <TD className="text-xs">{t.trade_date ?? "—"}</TD>
                      <TD><Badge variant={t.type === "BUY" ? "green" : t.type === "SELL" ? "red" : "secondary"}>{t.type}</Badge></TD>
                      <TD className="text-right text-xs tabular-nums">{t.quantity ? formatNumber(Number(t.quantity), 0) : "—"}</TD>
                      <TD className="text-right text-xs tabular-nums">{t.price ? formatNumber(Number(t.price)) : "—"}</TD>
                      <TD className="text-right text-xs tabular-nums">{t.net_amount ? formatNumber(Number(t.net_amount), 0) : "—"}</TD>
                      <TD className={cn("text-right text-xs tabular-nums", t.realized_pl && Number(t.realized_pl) > 0 && "text-emerald-600", t.realized_pl && Number(t.realized_pl) < 0 && "text-red-600")}>
                        {t.realized_pl !== null ? formatNumber(Number(t.realized_pl), 0) : "—"}
                      </TD>
                    </TR>
                  ))}
                  {stockDividends.map((d, i) => (
                    <TR key={`d${i}`}>
                      <TD className="text-xs">{d.payment_date ?? d.pay_date ?? "—"}</TD>
                      <TD><Badge variant={d.status === "received" ? "blue" : "amber"}>{d.status} dividend</Badge></TD>
                      <TD className="text-right text-xs">{d.quantity_held !== null ? formatNumber(d.quantity_held, 0) : "—"}</TD>
                      <TD className="text-right text-xs">{d.dividend_per_share !== null ? formatNumber(d.dividend_per_share) : "—"}</TD>
                      <TD className="text-right text-xs tabular-nums">{formatNumber(Number(d.net_amount ?? d.amount), 0)}</TD>
                      <TD className="text-right text-xs">—</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Journal for {ticker}</CardTitle>
            <Link href="/journal" className="text-xs text-muted-foreground hover:text-foreground">Open journal</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {(journalRes.data ?? []).length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No journal entries for this stock yet.</p>
            )}
            {(journalRes.data ?? []).map((j) => (
              <details key={j.id} className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-xs">
                  <span className="font-medium">{j.title}</span>
                  <span className="ml-2 text-muted-foreground">{j.entry_date} · {j.entry_type.replace(/_/g, " ")}</span>
                </summary>
                {j.body && <div className="mt-2 max-h-48 overflow-y-auto"><Markdown content={j.body} /></div>}
              </details>
            ))}
            <Link href={`/journal?ticker=${ticker}`}>
              <Button variant="outline" size="sm">Add journal entry</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
