import { Suspense } from "react";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyHeader } from "@/lib/company/service";
import { computeRatios } from "@/lib/engine/ratios";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { WatchlistButton } from "@/components/stock/watchlist-button";
import { GenerateReportDialog } from "@/components/stock/generate-report-dialog";
import { AskCopilotLink } from "@/components/ask-copilot-link";
import { CardSkeleton, TableSkeleton } from "@/components/page-skeleton";
import { formatNumber, formatSignedPct, formatFinancialPeriod, cn } from "@/lib/utils";
import { normalizeEnabledFeatures } from "@/lib/features";
import { ArrowLeft, Search } from "lucide-react";
import {
  OverviewPanel, FinancialsPanel, EarningsPanel, RatiosPanel,
  DividendsPanel, NewsFilingsPanel, AiAnalysisPanel,
} from "./panels";

export const dynamic = "force-dynamic";

function HeaderMetric({ label, value, sub, tone, hint }: { label: string; value: string; sub?: string; tone?: "positive" | "negative"; hint?: string }) {
  return (
    <div className="min-w-[7rem]">
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
          hint && "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
        )}
        title={hint}
      >
        {label}
      </p>
      <p className={cn("mt-0.5 text-sm font-semibold tabular-nums text-foreground", tone === "positive" && "text-emerald-600", tone === "negative" && "text-red-600")}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function compactNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-PK", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);
}

function compactMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `PKR ${compactNumber(value)}`;
}

export default async function StockCockpitPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).toUpperCase();

  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  // Shell: cache-first profile + live quote + 52w range, plus ownership/watch
  // status. Heavy per-section data streams in below via Suspense.
  //
  // Valuation metrics (P/E, EPS, dividend yield) come from the ratio engine —
  // the single source of truth shared with the Overview tab — so the header can
  // never disagree with Key signals on the period or the value. The engine
  // already selects the latest reliable financial period per stock, so this is
  // correct for every ticker, not just the one on screen.
  const [header, { data: holding }, { data: watch }, ratios, profileRes] = await Promise.all([
    getCompanyHeader(supabase, ticker),
    supabase.from("holdings").select("quantity").eq("user_id", user.id).eq("ticker", ticker).gt("quantity", 0).maybeSingle(),
    supabase.from("stock_watchlist").select("ticker").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
    computeRatios(supabase, ticker),
    supabase.from("profiles").select("enabled_features, demo_mode").eq("id", user.id).maybeSingle(),
  ]);
  const enabledFeatures = normalizeEnabledFeatures(profileRes.data?.enabled_features);
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const companyEnrichmentEnabled = enabledFeatures.includes("company_enrichment") && !isDemo;
  const companyReportsEnabled = enabledFeatures.includes("company_reports") && !isDemo;

  const { metadata, quote } = header;
  const dayTone = quote.dayChangePct ? (quote.dayChangePct > 0 ? "positive" : "negative") : undefined;

  // Header fundamentals, read from the ratio engine so value + period + source
  // match the Overview exactly. Each metric keeps the engine's own period label.
  const peRatio = ratios.find((r) => r.ratio_name === "P/E") ?? null;
  const divYieldRatio = ratios.find((r) => r.ratio_name === "Dividend yield (TTM)") ?? null;
  const pe = peRatio?.ratio_value ?? null;
  const epsRaw = peRatio?.inputs.eps;
  const eps = typeof epsRaw === "number" && Number.isFinite(epsRaw) ? epsRaw : null;
  const epsPeriod = formatFinancialPeriod(peRatio?.source_period);
  const divYield = divYieldRatio?.ratio_value ?? null;
  const range52 =
    header.technicals?.fiftyTwoWeekLow !== null && header.technicals?.fiftyTwoWeekLow !== undefined &&
    header.technicals?.fiftyTwoWeekHigh !== null && header.technicals?.fiftyTwoWeekHigh !== undefined
      ? `${formatNumber(header.technicals.fiftyTwoWeekLow)}-${formatNumber(header.technicals.fiftyTwoWeekHigh)}`
      : "—";
  const lastUpdated = quote.asOf ?? metadata.meta.lastUpdated?.slice(0, 10) ?? null;
  const hasUsableRatios = ratios.some((row) => row.ratio_value !== null && Number.isFinite(row.ratio_value));

  const tabs = [
    { id: "overview", label: "Overview", content: <Suspense fallback={<CardSkeleton lines={8} />}><OverviewPanel ticker={ticker} companyEnrichmentEnabled={companyEnrichmentEnabled} readOnly={isDemo} /></Suspense> },
    { id: "financials", label: "Financials", content: <Suspense fallback={<TableSkeleton />}><FinancialsPanel ticker={ticker} readOnly={isDemo} /></Suspense> },
    { id: "earnings", label: "Earnings", content: <Suspense fallback={<CardSkeleton lines={6} />}><EarningsPanel ticker={ticker} readOnly={isDemo} /></Suspense> },
    ...(hasUsableRatios
      ? [{ id: "ratios", label: "Ratios", content: <Suspense fallback={<TableSkeleton />}><RatiosPanel ticker={ticker} readOnly={isDemo} /></Suspense> }]
      : []),
    { id: "dividends", label: "Dividends", content: <Suspense fallback={<TableSkeleton />}><DividendsPanel ticker={ticker} /></Suspense> },
    { id: "news", label: "News & Filings", content: <Suspense fallback={<CardSkeleton lines={8} />}><NewsFilingsPanel ticker={ticker} /></Suspense> },

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

      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{ticker}</h1>
                {holding && <Badge variant="green">Owned</Badge>}
              </div>
              <p className="mt-1 text-sm font-medium text-slate-700">{metadata.companyName ?? "Company name unavailable"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[metadata.sector, metadata.exchange ?? "PSX"].filter(Boolean).join(" · ")}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
              <div className="sm:text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current price</p>
                <p className="text-3xl font-semibold leading-tight tabular-nums text-slate-950">
                  {quote.price !== null ? `PKR ${formatNumber(quote.price)}` : "—"}
                </p>
                <p className={cn("mt-0.5 text-xs font-medium tabular-nums", dayTone === "positive" && "text-emerald-600", dayTone === "negative" && "text-red-600", !dayTone && "text-muted-foreground")}>
                  {quote.dayChange !== null ? `${quote.dayChange > 0 ? "+" : quote.dayChange < 0 ? "−" : ""}PKR ${formatNumber(Math.abs(quote.dayChange))}` : ""}
                  {quote.dayChangePct !== null ? `${quote.dayChange !== null ? " · " : ""}${formatSignedPct(quote.dayChangePct)} today` : quote.dayChange === null ? "—" : ""}
                  {lastUpdated ? <span className="font-normal text-muted-foreground"> · Updated {lastUpdated}</span> : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {companyReportsEnabled && <GenerateReportDialog ticker={ticker} companyName={metadata.companyName} />}
                {!isDemo && <WatchlistButton ticker={ticker} initialWatched={!!watch} size="default" />}
                <AskCopilotLink question={`What should I know about ${ticker} right now?`} />
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto border-t border-slate-200 pt-4">
            <div className="grid min-w-[760px] grid-cols-6 gap-4">
              <HeaderMetric label="Market cap" value={compactMoney(metadata.marketCap)} />
              <HeaderMetric label="P/E" value={pe !== null ? `${pe.toFixed(1)}x` : "—"} sub={pe !== null && epsPeriod ? `Based on ${epsPeriod} EPS` : pe === null ? "needs financials" : undefined} />
              <HeaderMetric label="EPS" value={eps !== null ? `PKR ${formatNumber(eps)}` : "—"} sub={eps !== null ? epsPeriod ?? undefined : "needs financials"} />
              <HeaderMetric label="Dividend yield" value={divYield !== null ? `${divYield.toFixed(2)}%` : "Incomplete"} sub={divYield !== null ? "Announced DPS · TTM" : "DPS unverified"} hint={divYield !== null ? "Trailing 12-month announced cash dividend per share divided by the current price. Based on the company's public payout announcements — not your personal dividend receipts, which are reconciled separately in the Dividend status card." : undefined} />
              <HeaderMetric label="Volume" value={quote.volume !== null ? compactNumber(quote.volume) : "—"} />
              <HeaderMetric label="52-week range" value={range52} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs tabs={tabs} initial="overview" />
    </div>
  );
}
