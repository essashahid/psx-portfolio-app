import { Suspense } from "react";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyHeader } from "@/lib/company/service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { WatchlistButton } from "@/components/stock/watchlist-button";
import { CardSkeleton, TableSkeleton } from "@/components/page-skeleton";
import { formatMoney, formatNumber, formatSignedPct, cn } from "@/lib/utils";
import { ArrowLeft, Search } from "lucide-react";
import {
  OverviewPanel, FinancialsPanel, EarningsPanel, RatiosPanel,
  TechnicalsPanel, DividendsPanel, NewsFilingsPanel, AiAnalysisPanel,
} from "./panels";

export const dynamic = "force-dynamic";

const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatNumber(v));

function HeaderMetric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", tone === "positive" && "text-emerald-600", tone === "negative" && "text-red-600")}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default async function StockCockpitPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase();

  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  // Shell: cache-first profile + live quote + 52w range, plus ownership/watch
  // status. Heavy per-section data streams in below via Suspense.
  const [header, { data: holding }, { data: watch }, { data: latestIncome }, { data: divRows }] = await Promise.all([
    getCompanyHeader(supabase, ticker),
    supabase.from("holdings").select("quantity").eq("user_id", user.id).eq("ticker", ticker).gt("quantity", 0).maybeSingle(),
    supabase.from("stock_watchlist").select("ticker").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
    supabase
      .from("company_financials")
      .select("fiscal_year, fiscal_period, data")
      .eq("ticker", ticker)
      .eq("statement_type", "income_statement")
      .order("reported_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("dividends")
      .select("dividend_per_share, announcement_date")
      .eq("ticker", ticker)
      .order("announcement_date", { ascending: false })
      .limit(12),
  ]);

  const { metadata, quote } = header;
  const dayTone = quote.dayChangePct ? (quote.dayChangePct > 0 ? "positive" : "negative") : undefined;

  // Header fundamentals from extracted filings + recorded dividends (no live calls).
  const epsRaw = (latestIncome?.data as Record<string, unknown> | undefined)?.eps;
  const eps = typeof epsRaw === "number" && Number.isFinite(epsRaw) ? epsRaw : null;
  const epsPeriod = latestIncome ? `${latestIncome.fiscal_year ?? ""} ${latestIncome.fiscal_period ?? ""}`.trim() : null;
  const pe = eps && quote.price ? quote.price / eps : null;
  const latestDividendDate = divRows?.[0]?.announcement_date ?? null;
  const ttmCutoff = latestDividendDate ? new Date(new Date(latestDividendDate).getTime() - 365 * 86400_000).toISOString().slice(0, 10) : null;
  const ttmDps = (divRows ?? [])
    .filter((d) => d.dividend_per_share && ttmCutoff && (d.announcement_date ?? "") >= ttmCutoff)
    .reduce((s, d) => s + Number(d.dividend_per_share), 0);
  const divYield = ttmDps > 0 && quote.price ? (ttmDps / quote.price) * 100 : null;

  const tabs = [
    { id: "overview", label: "Overview", content: <Suspense fallback={<CardSkeleton lines={8} />}><OverviewPanel ticker={ticker} /></Suspense> },
    { id: "financials", label: "Financials", content: <Suspense fallback={<TableSkeleton />}><FinancialsPanel ticker={ticker} /></Suspense> },
    { id: "earnings", label: "Earnings", content: <Suspense fallback={<CardSkeleton lines={6} />}><EarningsPanel ticker={ticker} /></Suspense> },
    { id: "ratios", label: "Ratios", content: <Suspense fallback={<TableSkeleton />}><RatiosPanel ticker={ticker} /></Suspense> },
    { id: "technicals", label: "Technicals", content: <Suspense fallback={<CardSkeleton lines={8} />}><TechnicalsPanel ticker={ticker} /></Suspense> },
    { id: "dividends", label: "Dividends", content: <Suspense fallback={<TableSkeleton />}><DividendsPanel ticker={ticker} /></Suspense> },
    { id: "news", label: "News & Filings", content: <Suspense fallback={<CardSkeleton lines={8} />}><NewsFilingsPanel ticker={ticker} /></Suspense> },
    { id: "ai", label: "AI Analysis", content: <Suspense fallback={<CardSkeleton lines={6} />}><AiAnalysisPanel ticker={ticker} /></Suspense> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/stocks" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Stock research
        </Link>
        <Link href="/stocks" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Search className="h-3.5 w-3.5" /> Search another stock
        </Link>
      </div>

      {/* Top summary */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{ticker}</h1>
                {holding && <Badge variant="green">Owned</Badge>}
                <Badge variant="secondary">PSX</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {metadata.companyName ?? "Company name unavailable"}{metadata.sector ? ` · ${metadata.sector}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums">{quote.price !== null ? formatNumber(quote.price) : "—"}</p>
                <p className={cn("text-xs tabular-nums", dayTone === "positive" && "text-emerald-600", dayTone === "negative" && "text-red-600", !dayTone && "text-muted-foreground")}>
                  {quote.dayChange !== null ? `${quote.dayChange > 0 ? "+" : ""}${formatNumber(quote.dayChange)}` : "—"}
                  {quote.dayChangePct !== null ? ` (${formatSignedPct(quote.dayChangePct)})` : ""}
                  {quote.asOf ? ` · ${quote.asOf}` : ""}
                </p>
              </div>
              <WatchlistButton ticker={ticker} initialWatched={!!watch} size="default" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4 lg:grid-cols-8">
            <HeaderMetric label="Market cap" value={metadata.marketCap !== null ? formatMoney(metadata.marketCap) : "—"} />
            <HeaderMetric label="52-wk high" value={num(header.technicals?.fiftyTwoWeekHigh)} />
            <HeaderMetric label="52-wk low" value={num(header.technicals?.fiftyTwoWeekLow)} />
            <HeaderMetric label="EPS" value={eps !== null ? formatNumber(eps) : "—"} sub={eps !== null ? epsPeriod ?? undefined : "extract filings"} />
            <HeaderMetric label="P/E" value={pe !== null ? pe.toFixed(1) : "—"} sub={pe === null ? (eps === null ? "needs EPS" : "needs price") : undefined} />
            <HeaderMetric label="Div yield" value={divYield !== null ? `${divYield.toFixed(2)}%` : "—"} sub={divYield !== null ? "TTM recorded" : "no dividends recorded"} />
            <HeaderMetric label="Volume" value={quote.volume !== null ? formatNumber(quote.volume, 0) : "—"} />
            <HeaderMetric label="Updated" value={quote.asOf ?? metadata.meta.lastUpdated?.slice(0, 10) ?? "—"} sub={quote.meta.source ? `via ${quote.meta.source}` : undefined} />
          </div>
        </CardContent>
      </Card>

      <Tabs tabs={tabs} initial="overview" />
    </div>
  );
}
