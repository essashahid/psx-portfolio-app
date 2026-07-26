import { Suspense } from "react";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyHeader } from "@/lib/company/service";
import { computeRatios } from "@/lib/engine/ratios";
import { WatchlistButton } from "@/components/features/stocks/watchlist-button";
import { GenerateReportDialog } from "@/components/features/stocks/generate-report-dialog";
import { AskCopilotLink } from "@/components/shared/ask-copilot-link";
import { CompanyTabs } from "@/components/features/stocks/company-tabs";
import { PriceTrack } from "@/components/features/stocks/price-track";
import { CardSkeleton, TableSkeleton } from "@/components/ui/page-skeleton";
import { Band } from "@/components/ui/band";
import { formatNumber, formatSignedPct, formatFinancialPeriod, cn } from "@/lib/shared/format";
import { normalizeEnabledFeatures } from "@/lib/config/features";
import { sectorColor } from "@/lib/shared/sector-colors";
import { ArrowLeft } from "lucide-react";
import {
  OverviewPanel, FinancialsPanel, EarningsPanel,
  DividendsPanel, NewsFilingsPanel, TechnicalsPanel,
} from "./panels";

export const dynamic = "force-dynamic";

const GUTTER = "px-3 sm:px-4 md:px-(--gutter-page)";

function compactNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: digits }).format(value);
}

/** One cell of the six-metric strip under the header. */
function HeaderMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-t border-rule py-3.5 first:border-t-0 sm:border-t-0 sm:border-l sm:px-5 sm:py-0 sm:first:border-l-0 sm:first:pl-0">
      <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
      <p className="figure mt-1.5 text-(length:--text-h2) font-semibold text-text-strong">{value}</p>
      {sub && <p className="mt-0.5 text-(length:--text-2xs) text-text-faint">{sub}</p>}
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
  // status and the 60 closes the header track draws. Heavy per-section data
  // streams in below via Suspense.
  //
  // Valuation metrics (P/E, EPS, dividend yield) come from the ratio engine —
  // the single source of truth shared with the Overview tab — so the header can
  // never disagree with Key signals on the period or the value.
  const [header, { data: holding }, { data: watch }, ratios, profileRes, { data: closesRows }] =
    await Promise.all([
      getCompanyHeader(supabase, ticker),
      supabase.from("holdings").select("quantity").eq("user_id", user.id).eq("ticker", ticker).eq("hidden", false).gt("quantity", 0).maybeSingle(),
      supabase.from("stock_watchlist").select("ticker").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
      computeRatios(supabase, ticker),
      supabase.from("profiles").select("enabled_features, demo_mode").eq("id", user.id).maybeSingle(),
      supabase.from("company_price_history").select("price_date, close").eq("ticker", ticker).order("price_date", { ascending: false }).limit(60),
    ]);

  const enabledFeatures = normalizeEnabledFeatures(profileRes.data?.enabled_features);
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const companyEnrichmentEnabled = enabledFeatures.includes("company_enrichment") && !isDemo;
  const companyReportsEnabled = enabledFeatures.includes("company_reports") && !isDemo;

  const { metadata, quote } = header;
  const hue = sectorColor(metadata.sector);
  const dayUp = quote.dayChangePct !== null && quote.dayChangePct > 0;
  const dayDown = quote.dayChangePct !== null && quote.dayChangePct < 0;

  // Oldest-first for the track; the query reads newest-first for the limit.
  const closes = (closesRows ?? []).map((r) => Number(r.close)).filter((c) => Number.isFinite(c) && c > 0).reverse();

  const peRatio = ratios.find((r) => r.ratio_name === "P/E") ?? null;
  const divYieldRatio = ratios.find((r) => r.ratio_name === "Dividend yield (TTM)") ?? null;
  const pe = peRatio?.ratio_value ?? null;
  const epsRaw = peRatio?.inputs.eps;
  const eps = typeof epsRaw === "number" && Number.isFinite(epsRaw) ? epsRaw : null;
  const epsPeriod = formatFinancialPeriod(peRatio?.source_period);
  const divYield = divYieldRatio?.ratio_value ?? null;

  const low52 = header.technicals?.fiftyTwoWeekLow ?? null;
  const high52 = header.technicals?.fiftyTwoWeekHigh ?? null;
  const hasRange = low52 !== null && high52 !== null && high52 > low52;
  const pctOfRange =
    hasRange && quote.price !== null
      ? Math.round(((quote.price - low52) / (high52 - low52)) * 100)
      : null;

  // Every panel sits in the same dot-grid field, so switching tabs changes the
  // content and nothing else about the page.
  const panel = (node: React.ReactNode) => (
    <Band tone="paper" rule="none" className={cn("dot-grid", GUTTER)}>
      {node}
    </Band>
  );

  const tabs = [
    { id: "overview", label: "Overview", content: panel(<Suspense fallback={<CardSkeleton lines={8} />}><OverviewPanel ticker={ticker} companyEnrichmentEnabled={companyEnrichmentEnabled} readOnly={isDemo} /></Suspense>) },
    { id: "fundamentals", label: "Fundamentals", content: panel(<Suspense fallback={<TableSkeleton />}><FinancialsPanel ticker={ticker} readOnly={isDemo} /></Suspense>) },
    { id: "earnings", label: "Earnings", content: panel(<Suspense fallback={<CardSkeleton lines={6} />}><EarningsPanel ticker={ticker} readOnly={isDemo} /></Suspense>) },
    { id: "dividends", label: "Dividends", content: panel(<Suspense fallback={<TableSkeleton />}><DividendsPanel ticker={ticker} /></Suspense>) },
    // Placed after the fundamental tabs on purpose: the chart is for timing an
    // accumulation, not for forming the view.
    { id: "technicals", label: "Technicals", content: panel(<Suspense fallback={<CardSkeleton lines={10} />}><TechnicalsPanel ticker={ticker} /></Suspense>) },
    { id: "news", label: "Filings & news", content: panel(<Suspense fallback={<CardSkeleton lines={8} />}><NewsFilingsPanel ticker={ticker} /></Suspense>) },
  ];

  return (
    <div className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
      {/* ── Identity band, tinted with the sector's own hue ── */}
      <Band
        tone="paper"
        className={GUTTER}
        style={{ background: `color-mix(in oklab, ${hue} 12%, var(--surface-page))` }}
      >
        <Link href="/stocks" className="mb-5 inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-strong">
          <ArrowLeft className="h-3.5 w-3.5" /> All companies
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-7">
          <div className="min-w-0">
            <span className="mb-3.5 block h-0.75 w-11" style={{ background: hue }} />
            <div className="flex flex-wrap items-baseline gap-3.5">
              <h1 className="font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">{ticker}</h1>
              {holding && (
                <span className="text-(length:--text-2xs) font-semibold uppercase tracking-(--tracking-caps) text-text-muted">
                  In your book
                </span>
              )}
            </div>
            <p className="mt-2 text-(length:--text-h3) text-text-strong">{metadata.companyName ?? "Company name unavailable"}</p>
            <p className="mt-1 text-(length:--text-2xs) text-text-faint">
              {[metadata.sector, metadata.exchange ?? "PSX"].filter(Boolean).join(" · ")}
            </p>
          </div>

          <div className="min-w-[15.625rem] max-w-[28.75rem] flex-1 basis-[18.75rem] self-end">
            <PriceTrack closes={closes} low52={low52} high52={high52} hue={hue} />
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="text-right">
              <span className="block text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Last price</span>
              <span className="figure mt-1.5 block text-(length:--text-display) font-semibold leading-none tracking-editorial text-text-strong">
                {quote.price !== null ? formatNumber(quote.price) : "—"}
              </span>
              <span className={cn("figure mt-1.5 block text-sm font-semibold", dayUp && "text-up", dayDown && "text-down", !dayUp && !dayDown && "text-text-muted")}>
                {quote.dayChange !== null ? `${quote.dayChange > 0 ? "+" : quote.dayChange < 0 ? "−" : ""}${formatNumber(Math.abs(quote.dayChange))}` : ""}
                {quote.dayChangePct !== null ? `${quote.dayChange !== null ? " · " : ""}${formatSignedPct(quote.dayChangePct)} today` : quote.dayChange === null ? "—" : ""}
              </span>
            </div>
            <div className="flex flex-wrap justify-end gap-2.5">
              {!isDemo && <WatchlistButton ticker={ticker} initialWatched={!!watch} size="default" />}
              {companyReportsEnabled && <GenerateReportDialog ticker={ticker} companyName={metadata.companyName} />}
              <AskCopilotLink question={`What should I know about ${ticker} right now?`} />
            </div>
          </div>
        </div>

        <div className="mt-7 grid border-t border-rule sm:grid-cols-3 lg:grid-cols-6">
          <HeaderMetric label="Market cap" value={metadata.marketCap !== null ? compactNumber(metadata.marketCap) : "—"} sub="PKR" />
          <HeaderMetric label="P/E" value={pe !== null ? `${pe.toFixed(1)}x` : "—"} sub={pe !== null && epsPeriod ? `based on ${epsPeriod} EPS` : "needs financials"} />
          <HeaderMetric label="EPS" value={eps !== null ? formatNumber(eps) : "—"} sub={eps !== null ? epsPeriod ?? "PKR" : "needs financials"} />
          <HeaderMetric label="Dividend yield" value={divYield !== null ? `${divYield.toFixed(2)}%` : "—"} sub={divYield !== null ? "announced DPS · TTM" : "DPS unverified"} />
          <HeaderMetric label="Volume" value={quote.volume !== null ? compactNumber(quote.volume) : "—"} sub="shares today" />
          <HeaderMetric
            label="52-week range"
            value={hasRange ? `${formatNumber(low52)}–${formatNumber(high52)}` : "—"}
            sub={pctOfRange !== null ? `${pctOfRange}% of range` : undefined}
          />
        </div>
      </Band>

      <CompanyTabs tabs={tabs} initial="overview" accent={hue} />
    </div>
  );
}
