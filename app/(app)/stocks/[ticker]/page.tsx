import { Suspense } from "react";
import { track } from "@/lib/telemetry/events";
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
import { Metric } from "@/components/ui/metric";
import { PanelHeader } from "@/components/ui/panel-header";
import { AsOf } from "@/components/shared/as-of";
import { formatNumber, formatSignedPct, formatFinancialPeriod, cn } from "@/lib/shared/format";
import { normalizeEnabledFeatures } from "@/lib/config/features";
import { sectorColor } from "@/lib/shared/sector-colors";
import { quoteFreshness } from "@/lib/company/overview";
import { ArrowLeft } from "lucide-react";
import {
  OverviewPanel, RecentDevelopmentsPanel, AskAboutCompany,
  FinancialsPanel, EarningsPanel, RatiosPanel, StatementsPanel, TechnicalsPanel,
  NewsFilingsPanel,
} from "./panels";

export const dynamic = "force-dynamic";

const GUTTER = "px-3 sm:px-4 md:px-(--gutter-page)";

/**
 * A price, always to two decimals.
 *
 * The shared formatNumber sets no minimum, so a round average cost prints as
 * "275" beside a quoted "188.75". Prices carry two decimals throughout, and a
 * cost basis is a price.
 */
const price2 = (v: number) =>
  v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function compactNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: digits }).format(value);
}

/** One cell of the six-metric strip under the header. */
function HeaderMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Metric
      size="compact"
      label={label}
      value={value}
      sub={sub}
      className="border-t border-rule py-3.5 first:border-t-0 sm:border-t-0 sm:border-l sm:px-5 sm:py-0 sm:first:border-l-0 sm:first:pl-0"
    />
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
  // Valuation metrics (P/E, EPS, dividend yield) come from the ratio engine,
  // the single source of truth shared with the Overview tab, so the header can
  // never disagree with Key signals on the period or the value.
  const [header, { data: holding }, { data: watch }, ratios, profileRes, { data: closesRows }] =
    await Promise.all([
      getCompanyHeader(supabase, ticker, user.id),
      supabase.from("holdings").select("quantity, avg_cost").eq("user_id", user.id).eq("ticker", ticker).eq("hidden", false).gt("quantity", 0).maybeSingle(),
      supabase.from("stock_watchlist").select("ticker").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
      computeRatios(supabase, ticker),
      supabase.from("profiles").select("enabled_features, demo_mode").eq("id", user.id).maybeSingle(),
      supabase.from("company_price_history").select("price_date, close").eq("ticker", ticker).order("price_date", { ascending: false }).limit(60),
    ]);

  const enabledFeatures = normalizeEnabledFeatures(profileRes.data?.enabled_features);
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const companyReportsEnabled = enabledFeatures.includes("company_reports") && !isDemo;

  const { metadata, quote } = header;
  const freshness = quoteFreshness(quote);
  void track(user.id, "company_viewed", { ticker, held: Boolean(holding && holding.quantity > 0) });
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

  // A section of the Financials tab: its own heading above its own Suspense
  // boundary, so a slow section streams in under a heading that is already
  // there rather than holding the whole tab.
  const section = (eyebrow: string, title: string, fallback: React.ReactNode, node: React.ReactNode) => (
    <section>
      <PanelHeader eyebrow={eyebrow} title={title} className="mb-6" />
      <Suspense fallback={fallback}>{node}</Suspense>
    </section>
  );

  // Three tabs. Overview explains first; Financials holds everything
  // analytical, with the chart last because it is for timing, not for forming
  // the view; Filings is the primary-source record.
  const tabs = [
    {
      id: "overview",
      label: "Overview",
      content: panel(
        <div>
          <Suspense fallback={<CardSkeleton lines={10} />}><OverviewPanel ticker={ticker} /></Suspense>
          <Suspense fallback={<CardSkeleton lines={4} />}><RecentDevelopmentsPanel ticker={ticker} /></Suspense>
          <AskAboutCompany ticker={ticker} />
        </div>
      ),
    },
    {
      id: "financials",
      label: "Financials",
      content: panel(
        <div className="space-y-14">
          {section("Filed years", "How the business earns", <TableSkeleton />, <FinancialsPanel ticker={ticker} readOnly={isDemo} />)}
          {section("Quarterly earnings", "Reported against the year before", <CardSkeleton lines={6} />, <EarningsPanel ticker={ticker} />)}
          {section("All ratios", "Every figure the engine computes", <TableSkeleton />, <RatiosPanel ticker={ticker} />)}
          {section("Statements as filed", "The filings behind the figures", <TableSkeleton />, <StatementsPanel ticker={ticker} />)}
          {section("Price structure", "For timing, not for forming the view", <CardSkeleton lines={10} />, <TechnicalsPanel ticker={ticker} />)}
        </div>
      ),
    },
    { id: "filings", label: "Filings", content: panel(<Suspense fallback={<CardSkeleton lines={8} />}><NewsFilingsPanel ticker={ticker} /></Suspense>) },
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
              {/*
                The owned marker states the position rather than the fact of
                one: how many shares, at what average cost. It is the only place
                the page carries your holding, so a bare "In your book" would
                make you go and look the numbers up elsewhere.
              */}
              {holding && holding.quantity > 0 && (
                <span className="inline-flex items-center gap-2.5 rounded-(--radius-pill) border border-rule px-3.5 py-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo" />
                  <span className="figure text-(length:--text-2xs) text-text-muted">
                    {formatNumber(holding.quantity, 0)} share{holding.quantity === 1 ? "" : "s"}
                    {holding.avg_cost ? ` at an average cost of ${price2(holding.avg_cost)}` : ""}
                  </span>
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
              {/*
                Quotes reach the platform delayed, and the caption says so
                beside the date rather than leaving a reader to assume the
                figure is live. A quote older than a couple of sessions turns
                amber through the shared AsOf stamp.
              */}
              <span className="mt-1.5 block">
                {freshness === "missing" ? (
                  <span className="text-xs text-text-muted">No quote on file</span>
                ) : (
                  <AsOf date={quote.asOf} label="Delayed quote, as of" staleAfterDays={freshness === "stale" ? 0 : 4} />
                )}
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
          <HeaderMetric
            label="P/E"
            value={pe !== null ? `${pe.toFixed(1)}x` : "—"}
            sub={
              pe !== null
                ? epsPeriod
                  ? `based on ${epsPeriod} EPS`
                  : undefined
                : // The engine withholds the multiple on a loss and says why, so
                  // the reason travels with the dash instead of "needs financials"
                  // implying the data is merely absent.
                  eps !== null && eps < 0
                  ? "loss-making period"
                  : "needs financials"
            }
          />
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
