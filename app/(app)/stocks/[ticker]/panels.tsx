import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { getCachedEod, KSE_SYMBOL } from "@/lib/market-data/eod-cache";
import { computeSignals, findSwings, detectSupportResistanceZones, toCanonicalOHLCV } from "@/lib/market/technicals";
import { METRIC_HINTS } from "@/lib/market/glossary";
import { getCompanyDividends } from "@/lib/company/dividends";
import { getCompanyFilings } from "@/lib/company/filings";
import { computeRatios, type RatioRow } from "@/lib/engine/ratios";
import { getPortfolio } from "@/lib/portfolio";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { SectionMeta } from "@/components/stock/section-meta";
import { ActionButton } from "@/components/action-button";
import { WatchlistButton } from "@/components/stock/watchlist-button";
import { CompanyAiActions } from "@/components/stock/company-ai-actions";
import { Markdown } from "@/components/markdown";
import { StockPriceChart } from "@/components/stock/price-chart-lazy";
import { TechnicalWorkstation } from "@/components/technicals/workstation";
import { FinancialsWorkspace, type FinancialWorkspaceRow } from "@/components/stock/financials-workspace";
import { EarningsWorkspace } from "@/components/stock/earnings-workspace";
import { RatiosWorkspace, type RatiosPeerRow, type RatiosQuoteRow } from "@/components/stock/ratios-workspace";
import { formatMoney, formatNumber, formatSignedPct, formatFinancialPeriod, cn } from "@/lib/utils";
import {
  AlertTriangle, Banknote, BriefcaseBusiness, FileText, Info, Newspaper, Sparkles, TrendingUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function InlineNotice({ note }: { note: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
      <Info className="h-3.5 w-3.5 shrink-0" /> {note}
    </div>
  );
}

/** Whole-rupee money for receipts/dividends where sub-rupee precision is noise. */
const wholeMoney = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `PKR ${formatNumber(v, 0)}`;

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

function StatusBadge({
  label,
  tone = "secondary",
}: {
  label: string;
  tone?: "green" | "amber" | "red" | "blue" | "secondary";
}) {
  return <Badge variant={tone}>{label}</Badge>;
}

function freshnessBadge(freshness: string | null | undefined) {
  if (freshness === "fresh") return <StatusBadge label="Fresh" tone="green" />;
  if (freshness === "partial") return <StatusBadge label="Partial" tone="amber" />;
  if (freshness === "stale") return <StatusBadge label="Stale" tone="amber" />;
  if (freshness === "needs_review") return <StatusBadge label="Review" tone="amber" />;
  return <StatusBadge label="Pending" tone="amber" />;
}

function shortDescription(description: string | null): string | null {
  if (!description) return null;
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 180) return cleaned;
  // Prefer a clean sentence boundary; otherwise truncate on a word boundary and
  // add a real ellipsis — never cut mid-word like "...and cl...".
  const firstSentence = cleaned.match(/^.{40,180}?[.!?](\s|$)/)?.[0]?.trim();
  if (firstSentence) return firstSentence;
  const slice = cleaned.slice(0, 170);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 80 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

/** Neutral one-line description of a filing, derived from its category alone
 *  (no fabricated specifics, no positive/negative impact assumed). */
function filingSummary(category: string): string {
  switch (category) {
    case "result": return "Periodic financial results or accounts filed with the PSX.";
    case "dividend": return "Payout-related announcement (dividend, bonus, or entitlement).";
    case "board_meeting": return "Notice of a board of directors meeting.";
    case "material": return "Material or price-sensitive information disclosed to the exchange.";
    default: return "Official corporate announcement filed with the PSX.";
  }
}

function ratioByName(rows: RatioRow[], name: string): RatioRow | null {
  return rows.find((r) => r.ratio_name === name) ?? null;
}

function ratioText(row: RatioRow | null, kind: "multiple" | "percent" | "number" = "number"): string {
  if (!row || row.ratio_value === null) return "—";
  if (kind === "multiple") return `${row.ratio_value.toFixed(1)}x`;
  if (kind === "percent") return `${row.ratio_value.toFixed(1)}%`;
  return formatNumber(row.ratio_value);
}

function latestRatioYear(rows: RatioRow[]): number | null {
  const years = rows
    .map((r) => r.source_period?.match(/\b(20\d{2})\b/)?.[1])
    .filter((v): v is string => Boolean(v))
    .map(Number);
  return years.length ? Math.max(...years) : null;
}

function OverviewMetric({
  label,
  value,
  sub,
  tone,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "warning";
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "text-[11px] text-muted-foreground",
          hint && "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
        )}
        title={hint}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-sm font-semibold tabular-nums text-slate-950",
          tone === "positive" && "text-emerald-700",
          tone === "negative" && "text-red-700",
          tone === "warning" && "text-amber-700"
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function SignalGroup({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string; sub?: string; tone?: "positive" | "negative" | "warning"; hint?: string }[];
}) {
  const visible = items.filter((item) => item.value !== "—");
  if (visible.length === 0) return null;
  // Flat group: a subtle top divider instead of a bordered card-within-a-card.
  return (
    <div className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {visible.map((item) => (
          <OverviewMetric key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------

export async function OverviewPanel({
  ticker,
  companyEnrichmentEnabled = false,
  readOnly = false,
}: {
  ticker: string;
  companyEnrichmentEnabled?: boolean;
  readOnly?: boolean;
}) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [metadata, technicals, dividends, portfolio, ratios, filings, eod] = await Promise.all([
    getCompanyMetadata(supabase, ticker),
    getTechnicals(supabase, ticker),
    getCompanyDividends(supabase, user.id, ticker),
    getPortfolio(supabase, user.id),
    computeRatios(supabase, ticker),
    getCompanyFilings(ticker, 12),
    getCachedEod(supabase, []),
  ]);
  const holding = portfolio.holdings.find((h) => h.ticker === ticker);
  const latestDiv = dividends[0];
  // Use the market quote (technicals.latestPrice) as the single canonical price
  // so the position panel shows exactly the same value as the page header and
  // chart endpoint. The portfolio weight denominator still comes from getPortfolio
  // (other holdings use their own prices table entries), which is labelled clearly.
  const currentPrice = technicals.latestPrice ?? null;
  const totalCost = holding?.total_cost ?? null;
  const marketValue = holding && currentPrice !== null ? holding.quantity * currentPrice : null;
  const positionPl = marketValue !== null && totalCost !== null ? marketValue - totalCost : null;
  const positionReturn = positionPl !== null && totalCost && totalCost > 0 ? (positionPl / totalCost) * 100 : null;
  const positionTone = positionPl === null ? undefined : positionPl >= 0 ? "positive" : "negative";
  const hasReceipt = Boolean(holding && holding.dividend_income > 0);
  const dividendComplete = Boolean(latestDiv?.perShare !== null && latestDiv?.perShare !== undefined && (latestDiv.exDate || latestDiv.payDate || latestDiv.announcementDate));
  const dividendIncomplete = Boolean((latestDiv && !dividendComplete) || (!latestDiv && hasReceipt));
  const officialDescription = metadata.meta.source === "psx-company-page" ? metadata.description : null;
  const companySummary = shortDescription(officialDescription);
  // Precise company fields: surface Products from extracted business lines, and
  // only show Industry when it actually differs from Sector (avoids the vague
  // "Business: Cement" duplicate of the sector).
  // Keep Products clean and short: the two leading business lines joined with
  // "and" (e.g. "Cement and clinker"), falling back to one if the pair runs long.
  const productLines = metadata.businessLines.map((l) => l.trim()).filter(Boolean).slice(0, 2);
  const productsPair = productLines.length === 2 ? `${productLines[0]} and ${productLines[1]}` : productLines[0] ?? null;
  const products = productsPair && productsPair.length > 38 ? productLines[0] : productsPair;
  const industryLabel =
    metadata.industry && metadata.industry.trim().toLowerCase() !== (metadata.sector ?? "").trim().toLowerCase()
      ? metadata.industry
      : null;
  // "Products" only makes sense when we have 2+ distinct business lines that
  // represent actual product categories. A single entry such as "Cement
  // manufacturing" is industry-level and should use the "Industry" label so it
  // doesn't read as a vague repeat of the sector.
  const showAsProducts = productLines.length >= 2;
  const companyFields: { label: string; value: string; sub?: string; tone?: "warning" }[] = [
    { label: "Sector", value: metadata.sector ?? "—" },
  ];
  if (products) companyFields.push({ label: showAsProducts ? "Products" : "Industry", value: products });
  else if (industryLabel) companyFields.push({ label: "Industry", value: industryLabel });
  companyFields.push({ label: "Exchange", value: metadata.exchange ?? "PSX" });
  const signals = computeSignals(technicals.history);
  const benchmark = (eod.get(KSE_SYMBOL) ?? []).map((p) => ({ date: p.date, close: p.close }));
  const latestDevelopment =
    filings.find((f) => f.category === "material") ??
    filings.find((f) => f.category === "result") ??
    filings[0] ??
    null;

  const pe = ratioByName(ratios, "P/E");
  const pb = ratioByName(ratios, "P/B");
  const earningsYield = ratioByName(ratios, "Earnings yield");
  const eps = ratios.find((r) => r.ratio_name === "P/E")?.inputs.eps;
  const epsValue = typeof eps === "number" && Number.isFinite(eps) ? eps : null;
  const roe = ratioByName(ratios, "ROE");
  const netMargin = ratioByName(ratios, "Net margin");
  const debtEquity = ratioByName(ratios, "Debt-to-equity");
  const interestCoverage = ratioByName(ratios, "Interest coverage");
  const cashQuality = ratioByName(ratios, "OCF / PAT");
  const marketDivYield = ratioByName(ratios, "Dividend yield (TTM)");
  const ratioYear = latestRatioYear(ratios);
  const currentYear = new Date().getFullYear();
  const financialTone = ratioYear === null ? "amber" : ratioYear < currentYear - 1 ? "amber" : "green";
  const financialStatus = ratioYear === null ? "Pending" : ratioYear < currentYear - 1 ? "Stale" : "Fresh";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-3 p-5 pb-2">
            <div>
              <CardTitle className="text-base">Price performance</CardTitle>
              <CardDescription>
                Historical price and volume with average cost. Optional benchmark and technical overlays available.
              </CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {technicals.meta.freshness !== "fresh" ? freshnessBadge(technicals.meta.freshness) : null}
              {technicals.asOfDate ? <Badge variant="secondary">Latest close {technicals.asOfDate}</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="p-5 pt-3">
            {technicals.history.length > 0 ? (
              <StockPriceChart
                candles={technicals.history}
                signals={signals}
                benchmark={benchmark}
                ticker={ticker}
                averageCostLine={holding?.avg_cost ?? null}
                showCurrentPriceLine
              />
            ) : (
              <InlineNotice note="No price history loaded from the PSX portal." />
            )}
            <div className="mt-3">
              <SectionMeta meta={technicals.meta} ticker={ticker} refreshSection={readOnly ? undefined : "technicals"} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Your position</CardTitle>
              {holding ? <StatusBadge label="Owned" tone="green" /> : <StatusBadge label="Not held" />}
            </div>
            {technicals.asOfDate
              ? <CardDescription>Market close {technicals.asOfDate}</CardDescription>
              : holding?.price_date
              ? <CardDescription>Price as of {holding.price_date}</CardDescription>
              : null}
          </CardHeader>
          <CardContent className="space-y-4 p-5 pt-3">
            {holding ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">Market value</p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{compactMoney(marketValue)}</p>
                  <div
                    className={cn(
                      "mt-3 rounded-xl px-3 py-2",
                      positionTone === "positive" && "bg-emerald-50 text-emerald-800",
                      positionTone === "negative" && "bg-red-50 text-red-800",
                      !positionTone && "bg-slate-50 text-slate-700"
                    )}
                  >
                    <p className="text-sm font-semibold tabular-nums">
                      {positionPl !== null ? formatMoney(positionPl) : "—"}
                      {positionReturn !== null ? ` · ${formatSignedPct(positionReturn)}` : ""}
                    </p>
                    <p className="text-[11px] opacity-80">Total unrealized return</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <OverviewMetric label="Average cost" value={holding.avg_cost !== null ? `PKR ${formatNumber(holding.avg_cost)}` : "—"} hint="Weighted average price you paid per share." />
                  <OverviewMetric label="Current price" value={currentPrice !== null ? `PKR ${formatNumber(currentPrice)}` : "—"} />
                  <OverviewMetric label="Portfolio weight" value={holding.weight !== null ? `${holding.weight.toFixed(1)}%` : "—"} hint={`${ticker} market value divided by total portfolio market value at the snapshot date.`} />
                  <OverviewMetric label="Quantity" value={formatNumber(holding.quantity, 0)} />
                  <OverviewMetric label="Dividends received" value={wholeMoney(holding.dividend_income)} hint={`Total cash dividends recorded against your ${ticker} holding.`} />
                </div>

                <Link
                  href={`/holdings?ticker=${encodeURIComponent(ticker)}`}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-medium hover:bg-slate-50"
                >
                  View transactions
                </Link>
              </>
            ) : (
              <div className="space-y-3 py-2">
                <p className="text-sm text-muted-foreground">This stock is not currently in your portfolio.</p>
                {!readOnly && <WatchlistButton ticker={ticker} initialWatched={false} />}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-4 w-4" /> Company at a glance</CardTitle>
                <CardDescription>
                  Profile, sector and listing reference data{metadata.meta.lastUpdated ? ` · updated ${metadata.meta.lastUpdated.slice(0, 10)}` : ""}
                </CardDescription>
              </div>
              {metadata.meta.freshness !== "fresh" ? freshnessBadge(metadata.meta.freshness) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5 pt-3">
            {companySummary ? (
              <p className="text-sm leading-relaxed text-slate-800">{companySummary}</p>
            ) : companyEnrichmentEnabled ? (
              <div className="space-y-2">
                <InlineNotice note="No official PSX company profile on file yet." />
                <ActionButton
                  endpoint={`/api/stocks/${ticker}/refresh`}
                  body={{ section: "description" }}
                  label={<><Sparkles className="h-3.5 w-3.5" /> Fetch official profile</>}
                  variant="outline"
                  size="sm"
                />
              </div>
            ) : (
              <InlineNotice note="No company profile on file yet." />
            )}

            <div className="grid grid-cols-2 gap-3">
              {companyFields.map((field) => (
                <OverviewMetric key={field.label} {...field} />
              ))}
            </div>

            {officialDescription ? (
              <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-slate-900">Read full profile</summary>
                <p className="mt-2 leading-relaxed text-muted-foreground">{officialDescription}</p>
              </details>
            ) : null}

            <SectionMeta
              meta={metadata.meta}
              ticker={ticker}
              refreshSection={companyEnrichmentEnabled ? "description" : undefined}
            />
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Key signals</CardTitle>
                <CardDescription>
                  Select ratios only. Full tables and technical indicators remain in their dedicated tabs.
                </CardDescription>
              </div>
              {financialStatus !== "Fresh" ? <StatusBadge label={financialStatus} tone={financialTone} /> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-5 pt-3">
            <SignalGroup
              title="Valuation"
              items={[
                { label: "P/E", value: ratioText(pe, "multiple"), sub: formatFinancialPeriod(pe?.source_period) ?? undefined, hint: METRIC_HINTS["P/E"] },
                { label: "P/B", value: ratioText(pb, "multiple"), sub: formatFinancialPeriod(pb?.source_period) ?? undefined, hint: METRIC_HINTS["P/B"] },
                { label: "Earnings yield", value: ratioText(earningsYield, "percent"), sub: formatFinancialPeriod(earningsYield?.source_period) ?? undefined, hint: METRIC_HINTS["Earnings yield"] },
              ]}
            />
            <SignalGroup
              title="Profitability"
              items={[
                { label: "EPS", value: epsValue !== null ? `PKR ${formatNumber(epsValue)}` : "—", sub: formatFinancialPeriod(pe?.source_period) ?? undefined, hint: "Earnings per share for the reporting period." },
                { label: "ROE", value: ratioText(roe, "percent"), sub: formatFinancialPeriod(roe?.source_period) ?? undefined, hint: METRIC_HINTS["ROE"] },
                { label: "Net margin", value: ratioText(netMargin, "percent"), sub: formatFinancialPeriod(netMargin?.source_period) ?? undefined, hint: METRIC_HINTS["Net margin"] },
              ]}
            />
            <SignalGroup
              title="Financial strength"
              items={[
                { label: "Debt/equity", value: ratioText(debtEquity), sub: formatFinancialPeriod(debtEquity?.source_period) ?? undefined, hint: METRIC_HINTS["Debt-to-equity"] },
                { label: "Interest coverage", value: ratioText(interestCoverage, "multiple"), sub: formatFinancialPeriod(interestCoverage?.source_period) ?? undefined, hint: METRIC_HINTS["Interest coverage"] },
                { label: "OCF / profit", value: ratioText(cashQuality, "multiple"), sub: formatFinancialPeriod(cashQuality?.source_period) ?? undefined, hint: METRIC_HINTS["OCF / PAT"] },
              ]}
            />
            {ratioYear !== null && ratioYear < currentYear - 1 ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Financial ratios include FY{ratioYear} inputs while price data is from {technicals.asOfDate ?? "the latest available quote"}.
              </div>
            ) : null}
            {ratios.every((r) => r.ratio_value === null) ? (
              <InlineNotice note="Key financial signals will appear after sourced financials are loaded." />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Newspaper className="h-4 w-4" /> Latest development</CardTitle>
                <CardDescription>Most recent material filing, result, or announcement found for {ticker}.</CardDescription>
              </div>
              {latestDevelopment ? <Badge variant={latestDevelopment.category === "material" ? "amber" : "blue"}>{latestDevelopment.category.replace(/_/g, " ")}</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {latestDevelopment ? (
              <div className="space-y-2.5">
                <a href={latestDevelopment.url} target="_blank" rel="noopener noreferrer" className="block text-sm font-semibold leading-snug text-slate-950 hover:underline">
                  {latestDevelopment.title}
                </a>
                <p className="text-xs leading-relaxed text-slate-600">{filingSummary(latestDevelopment.category)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {latestDevelopment.date ?? "Date not captured"} · {latestDevelopment.source}
                </p>
                <a
                  href={latestDevelopment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs font-medium hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" /> View filing
                </a>
              </div>
            ) : (
              <InlineNotice note="No recent PSX filings retrieved for this company." />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-4 w-4" /> Dividend status</CardTitle>
                <CardDescription>Market payout yield versus your personal dividend receipts.</CardDescription>
              </div>
              {dividendIncomplete ? <StatusBadge label="Incomplete" tone="amber" /> : dividendComplete ? <StatusBadge label="Verified" tone="green" /> : <StatusBadge label="No records" tone="secondary" />}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-2">
            {dividendComplete && latestDiv ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">Latest dividend</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">
                    PKR {formatNumber(latestDiv.perShare)} per share
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {latestDiv.exDate ? `Ex-date ${latestDiv.exDate}` : "Ex-date unverified"}
                    {latestDiv.payDate ? ` · Payment ${latestDiv.payDate}` : ""}
                  </p>
                </div>
                {holding ? <OverviewMetric label="Amount received" value={wholeMoney(holding.dividend_income)} /> : null}
                <a href="#dividends" className="inline-flex h-8 items-center rounded-md border border-slate-200 px-2.5 text-xs font-medium hover:bg-slate-50">
                  View dividend history
                </a>
              </>
            ) : dividendIncomplete ? (
              <>
                {marketDivYield?.ratio_value !== null && marketDivYield?.ratio_value !== undefined ? (
                  <div>
                    <p className="text-xs text-slate-600">Market dividend yield</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{marketDivYield.ratio_value.toFixed(2)}%</p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Trailing 12-month announced cash dividend per share ÷ current price, from company payout announcements. Your personal receipts below are reconciled separately and are still incomplete.
                    </p>
                  </div>
                ) : null}
                {holding && holding.dividend_income > 0 ? (
                  <OverviewMetric label="Your recorded receipts" value={wholeMoney(holding.dividend_income)} />
                ) : null}
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <p className="text-xs font-semibold">Personal receipts: missing or unverified</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">Dividend per share · Ex-date mapping · Entitlement reconciliation</p>
                </div>
                <a href="#dividends" className="inline-flex h-8 items-center rounded-md border border-slate-200 px-2.5 text-xs font-medium hover:bg-slate-50">
                  View dividend history
                </a>
              </>
            ) : (
              <InlineNotice note="No verified dividend records or user receipts are loaded yet." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Financials
// ---------------------------------------------------------------------------

interface FinancialRow { ticker: string; period_type: string; fiscal_year: number | null; fiscal_period: string | null; statement_type: string; data: Record<string, number | null | string>; reported_date: string | null; source_url: string | null; confidence: number | null; updated_at: string | null; }

function FetchFinancialsButton({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  if (readOnly) return null;
  return (
    <ActionButton
      endpoint={`/api/stocks/${ticker}/refresh`}
      body={{ section: "financials" }}
      label={<><FileText className="h-3.5 w-3.5" /> Refresh financials</>}
      variant="outline"
      size="sm"
    />
  );
}

export async function FinancialsPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();
  const [{ data }, { data: lastLog }] = await Promise.all([
    supabase
      .from("company_financials")
      .select("ticker, period_type, fiscal_year, fiscal_period, statement_type, data, reported_date, source_url, confidence, updated_at")
      .eq("ticker", ticker)
      .order("reported_date", { ascending: false })
      .limit(120),
    supabase
      .from("data_fetch_logs")
      .select("status, detail, created_at, source")
      .eq("ticker", ticker)
      .eq("section", "financials")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = (data ?? []) as FinancialRow[];

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={FileText}
          title="Financial data is not populated yet"
          description={
            lastLog
              ? `Last fetch attempt: ${String(lastLog.created_at).slice(0, 16).replace("T", " ")} via ${lastLog.source} — ${lastLog.status}${lastLog.detail ? ` (${lastLog.detail})` : ""}. The engine reads the official PSX company page; numbers are echoed from PSX, never invented.`
              : `No data has been loaded for ${ticker} yet. The engine reads the official PSX company page (sales, EPS, margins) — numbers are echoed from PSX, never invented.`
          }
          action={<FetchFinancialsButton ticker={ticker} readOnly={readOnly} />}
        />
      </div>
    );
  }

  return <FinancialsWorkspace ticker={ticker} rows={rows as FinancialWorkspaceRow[]} readOnly={readOnly} />;
}

// ---------------------------------------------------------------------------
// 3. Earnings
// ---------------------------------------------------------------------------

export async function EarningsPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();
  const [filings, { data: finData }] = await Promise.all([
    getCompanyFilings(ticker, 120),
    supabase
      .from("company_financials")
      .select("period_type, fiscal_year, fiscal_period, statement_type, data, reported_date, source_url")
      .eq("ticker", ticker)
      .eq("statement_type", "income_statement")
      .order("reported_date", { ascending: false })
      .limit(120),
  ]);
  
  const incomes = (finData ?? []) as FinancialWorkspaceRow[];

  if (incomes.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={TrendingUp}
          title="No earnings loaded yet"
          description={`Load ${ticker}'s revenue, profit, and EPS from the official PSX company page. Numbers are echoed from PSX, never invented.`}
          action={<FetchFinancialsButton ticker={ticker} readOnly={readOnly} />}
        />
      </div>
    );
  }

  return (
    <EarningsWorkspace
      ticker={ticker}
      rows={incomes}
      filings={filings}
      readOnly={readOnly}
    />
  );
}

// ---------------------------------------------------------------------------
// 4. Ratios
// ---------------------------------------------------------------------------

const RATIO_PEER_METRICS = [
  "P/E",
  "P/B",
  "P/S",
  "EV/Sales",
  "EV/EBIT",
  "FCF yield",
  "Dividend yield (TTM)",
  "Gross margin",
  "Net margin",
  "ROE",
  "ROA",
  "ROIC",
  "Revenue growth",
  "EPS growth",
  "Debt-to-equity",
  "Net debt-to-equity",
  "Interest coverage",
  "Current ratio",
  "OCF / PAT",
] as const;

export async function RatiosPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();

  // Always compute live from stored inputs — the engine is pure reads, so the
  // tab reflects the newest extracted financials and quote without waiting on
  // a persisted snapshot.
  const [ratios, metadata, quoteRes] = await Promise.all([
    computeRatios(supabase, ticker),
    getCompanyMetadata(supabase, ticker),
    supabase
      .from("market_quotes")
      .select("price, as_of, last_fetched_at")
      .eq("ticker", ticker.toUpperCase())
      .maybeSingle(),
  ]);

  const quote = (quoteRes.data ?? null) as RatiosQuoteRow | null;
  let peers: RatiosPeerRow[] = [];

  if (metadata.sector) {
    const { data: peerMasters } = await supabase
      .from("stock_master")
      .select("ticker, company_name, sector")
      .eq("sector", metadata.sector)
      .neq("ticker", ticker.toUpperCase())
      .limit(8);
    const peerRows = (peerMasters ?? []) as { ticker: string; company_name: string | null; sector: string | null }[];
    const peerTickers = peerRows.map((row) => row.ticker).filter(Boolean);
    if (peerTickers.length) {
      const { data: peerRatioRows } = await supabase
        .from("company_ratios")
        .select("ticker, ratio_name, ratio_value, source_period, computed_at")
        .in("ticker", peerTickers)
        .in("ratio_name", [...RATIO_PEER_METRICS]);
      const grouped = new Map<string, RatiosPeerRow["ratios"]>();
      for (const row of (peerRatioRows ?? []) as { ticker: string; ratio_name: string; ratio_value: number | null; source_period: string | null; computed_at: string | null }[]) {
        grouped.set(row.ticker, [...(grouped.get(row.ticker) ?? []), {
          ratio_name: row.ratio_name,
          ratio_value: row.ratio_value,
          source_period: row.source_period,
          computed_at: row.computed_at,
        }]);
      }
      peers = peerRows.map((row) => ({
        ticker: row.ticker,
        companyName: row.company_name,
        sector: row.sector,
        ratios: grouped.get(row.ticker) ?? [],
      }));
    }
  }

  const usableRatios = ratios.filter((row) => row.ratio_value !== null && Number.isFinite(row.ratio_value));

  return (
    <RatiosWorkspace
      ticker={ticker.toUpperCase()}
      ratios={usableRatios}
      metadata={metadata}
      quote={quote}
      peers={peers}
      readOnly={readOnly}
    />
  );
}

// ---------------------------------------------------------------------------
// 5. Technicals
// ---------------------------------------------------------------------------

export async function TechnicalsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const technicals = await getTechnicals(supabase, ticker);
  const signals = computeSignals(technicals.history);

  if (technicals.history.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No price history available"
        description={`The PSX portal returned no daily history for ${ticker}. This is normal for newly listed, suspended, or illiquid symbols.`}
      />
    );
  }

  const swings = findSwings(technicals.history, 8);
  const zones = detectSupportResistanceZones(technicals.history, swings, signals.lastClose ?? 0);
  const ohlcvData = toCanonicalOHLCV(ticker, technicals.history);

  return (
    <TechnicalWorkstation 
      ticker={ticker}
      ohlcvData={ohlcvData}
      signals={signals}
      supportResistanceZones={zones}
    />
  );
}

// ---------------------------------------------------------------------------
// 6. Dividends
// ---------------------------------------------------------------------------

export async function DividendsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [dividends, filings] = await Promise.all([
    getCompanyDividends(supabase, user.id, ticker),
    getCompanyFilings(ticker, 25),
  ]);
  const divFilings = filings.filter((f) => f.category === "dividend");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Banknote className="h-4 w-4" /> Dividend history</CardTitle>
          <CardDescription>Recorded cash dividends, bonus and rights for {ticker}.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {dividends.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No dividends recorded yet. Dividend announcements appear under filings below as they are detected.</p>
          ) : (
            <Table>
              <THead>
                <TR><TH>Announced</TH><TH>Type</TH><TH className="text-right">Per share</TH><TH>Ex-date</TH><TH>Pay date</TH><TH>Source</TH></TR>
              </THead>
              <TBody>
                {dividends.map((d, i) => (
                  <TR key={i}>
                    <TD className="text-xs">{d.announcementDate ?? d.date ?? "—"}</TD>
                    <TD><Badge variant={d.kind === "cash" ? "green" : d.kind === "bonus" ? "blue" : "amber"}>{d.kind}</Badge></TD>
                    <TD className="text-right text-xs tabular-nums">{d.perShare !== null ? formatNumber(d.perShare) : "—"}</TD>
                    <TD className="text-xs">{d.exDate ?? "—"}</TD>
                    <TD className="text-xs">{d.payDate ?? "—"}</TD>
                    <TD className="text-[11px] text-muted-foreground">{d.source}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {divFilings.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Dividend & entitlement filings</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {divFilings.map((f, i) => (
                <li key={i} className="border-b border-border pb-2 last:border-0">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">{f.title}</a>
                  <p className="text-[11px] text-muted-foreground">{f.date ?? ""} · {f.source}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. News & Filings
// ---------------------------------------------------------------------------

const FILING_VARIANT: Record<string, "green" | "blue" | "amber" | "secondary"> = {
  result: "blue", dividend: "green", board_meeting: "amber", material: "amber", corporate_announcement: "secondary",
};

export async function NewsFilingsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [filings, newsRes] = await Promise.all([
    getCompanyFilings(ticker, 30),
    supabase
      .from("news_articles")
      .select("id, title, url, source, published_at, ai_summary, sentiment, relevance_score, category")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .eq("ignored", false)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);
  const news = newsRes.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> PSX filings</CardTitle>
          <CardDescription>Official company announcements — results, board meetings, dividends, material info.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {filings.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No filings retrieved from the PSX portal for {ticker}.</p>
          ) : (
            filings.map((f, i) => (
              <div key={i} className="flex items-start justify-between gap-2 border-b border-border pb-2 last:border-0">
                <div className="min-w-0">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium leading-snug hover:underline">{f.title}</a>
                  <p className="text-[11px] text-muted-foreground">{f.date ?? ""} · {f.source}</p>
                </div>
                <Badge variant={FILING_VARIANT[f.category] ?? "secondary"}>{f.category.replace(/_/g, " ")}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>News</CardTitle>
          <CardDescription>Relevant stored news. Low-confidence / off-target items are hidden by default.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {news.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No stored news for {ticker}. Use the News Center to refresh.</p>
          ) : (
            news.map((n) => (
              <div key={n.id} className="border-b border-border pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  {n.relevance_score && <Badge variant="outline">{n.relevance_score}/10</Badge>}
                  {n.category && n.category !== "general" && <Badge variant="blue">{n.category}</Badge>}
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium leading-snug hover:underline">{n.title}</a>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{n.source} {n.published_at ? `· ${String(n.published_at).slice(0, 10)}` : ""}</p>
                {n.ai_summary && <p className="mt-1 text-xs">{n.ai_summary}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. AI Analysis
// ---------------------------------------------------------------------------

export async function AiAnalysisPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const { data: briefings } = await supabase
    .from("ai_briefings")
    .select("id, title, content, created_at")
    .eq("user_id", user.id)
    .eq("ticker", ticker)
    .order("created_at", { ascending: false })
    .limit(6);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI research assistant</CardTitle>
          <CardDescription>Grounded in the data on this page. Never invents numbers.</CardDescription>
        </CardHeader>
        <CardContent><CompanyAiActions ticker={ticker} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Saved analyses</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(briefings ?? []).length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">No saved analyses yet. Run an action above.</p>
          ) : (
            (briefings ?? []).map((b) => (
              <details key={b.id} className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-xs font-medium">{b.title} <span className="text-muted-foreground">· {b.created_at.slice(0, 10)}</span></summary>
                <div className="mt-2 max-h-72 overflow-y-auto"><Markdown content={b.content} /></div>
              </details>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
