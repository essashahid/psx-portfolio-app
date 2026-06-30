import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { getCachedEod, KSE_SYMBOL } from "@/lib/market-data/eod-cache";
import { computeSignals } from "@/lib/market/technicals";
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
import { RatioSnapshotChart } from "@/components/charts-lazy";
import { StockPriceChart } from "@/components/stock/price-chart-lazy";
import { FinancialsWorkspace, type FinancialWorkspaceRow } from "@/components/stock/financials-workspace";
import { formatMoney, formatNumber, formatSignedPct, formatFinancialPeriod, cn } from "@/lib/utils";
import {
  AlertTriangle, Banknote, BriefcaseBusiness, Calculator, FileText, Info, Newspaper, Sparkles, TrendingUp,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function Metric({ label, value, sub, tone, hint }: { label: string; value: string; sub?: string; tone?: "positive" | "negative"; hint?: string }) {
  const resolvedHint = hint ?? METRIC_HINTS[label];
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
          resolvedHint && "cursor-help decoration-muted-foreground/40 underline decoration-dotted underline-offset-2"
        )}
        title={resolvedHint}
      >
        {label}
      </p>
      <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", tone === "positive" && "text-emerald-600", tone === "negative" && "text-red-600")}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Unavailable({ note }: { note: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
      <Info className="h-3.5 w-3.5 shrink-0" /> {note}
    </div>
  );
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatNumber(v));

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
  if (freshness === "needs_review") return <StatusBadge label="Unverified" tone="amber" />;
  return <StatusBadge label="Missing" tone="red" />;
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
      {sub ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p> : null}
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
  const currentPrice = technicals.latestPrice ?? holding?.latest_price ?? null;
  const marketValue =
    holding && currentPrice !== null ? holding.quantity * currentPrice : holding?.market_value ?? null;
  const totalCost = holding?.total_cost ?? null;
  const positionPl = marketValue !== null && totalCost !== null ? marketValue - totalCost : holding?.unrealized_pl ?? null;
  const positionReturn = positionPl !== null && totalCost && totalCost > 0 ? (positionPl / totalCost) * 100 : holding?.unrealized_pl_pct ?? null;
  const positionTone = positionPl === null ? undefined : positionPl >= 0 ? "positive" : "negative";
  const hasReceipt = Boolean(holding && holding.dividend_income > 0);
  const dividendComplete = Boolean(latestDiv?.perShare !== null && latestDiv?.perShare !== undefined && (latestDiv.exDate || latestDiv.payDate || latestDiv.announcementDate));
  const dividendIncomplete = Boolean((latestDiv && !dividendComplete) || (!latestDiv && hasReceipt));
  const companySummary = shortDescription(metadata.description);
  const marketsLabel = metadata.description
    ? /export/i.test(metadata.description)
      ? "Domestic and export"
      : "Unverified"
    : "Unverified";
  const marketsSub = metadata.description && /export/i.test(metadata.description)
    ? "from company profile"
    : "needs source";
  // Precise company fields: surface Products from extracted business lines, and
  // only show Industry when it actually differs from Sector (avoids the vague
  // "Business: Cement" duplicate of the sector).
  const products = metadata.businessLines.length ? metadata.businessLines.slice(0, 3).join(", ") : null;
  const industryLabel =
    metadata.industry && metadata.industry.trim().toLowerCase() !== (metadata.sector ?? "").trim().toLowerCase()
      ? metadata.industry
      : null;
  const companyFields: { label: string; value: string; sub?: string; tone?: "warning" }[] = [
    { label: "Sector", value: metadata.sector ?? "—" },
  ];
  if (products) companyFields.push({ label: "Products", value: products });
  else if (industryLabel) companyFields.push({ label: "Industry", value: industryLabel });
  companyFields.push({ label: "Markets", value: marketsLabel, sub: marketsSub, tone: marketsLabel === "Unverified" ? "warning" : undefined });
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
  const ratioYear = latestRatioYear(ratios);
  const currentYear = new Date().getFullYear();
  const financialTone = ratioYear === null ? "red" : ratioYear < currentYear - 1 ? "amber" : "green";
  const financialStatus = ratioYear === null ? "Missing" : ratioYear < currentYear - 1 ? "Stale" : "Fresh";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-3 p-5 pb-2">
            <div>
              <CardTitle className="text-base">Price performance</CardTitle>
              <CardDescription>
                Historical close, volume, 52-week structure, average cost, and benchmark comparison.
              </CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {technicals.meta.freshness !== "fresh" ? freshnessBadge(technicals.meta.freshness) : null}
              {technicals.asOfDate ? <Badge variant="secondary">Price {technicals.asOfDate}</Badge> : null}
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
              <Unavailable note="No price history available from the PSX portal." />
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
            {holding?.price_date ? <CardDescription>Portfolio snapshot {holding.price_date}</CardDescription> : null}
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
                  Source {metadata.meta.source ?? "unavailable"}{metadata.meta.lastUpdated ? ` · updated ${metadata.meta.lastUpdated.slice(0, 10)}` : ""}
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
                <Unavailable note="No company profile on file yet. Generate one from public knowledge, cited as AI." />
                <ActionButton
                  endpoint={`/api/stocks/${ticker}/refresh`}
                  body={{ section: "description" }}
                  label={<><Sparkles className="h-3.5 w-3.5" /> Generate company profile</>}
                  variant="outline"
                  size="sm"
                />
              </div>
            ) : (
              <Unavailable note="No company profile on file yet." />
            )}

            <div className="grid grid-cols-2 gap-3">
              {companyFields.map((field) => (
                <OverviewMetric key={field.label} {...field} />
              ))}
            </div>

            {metadata.description ? (
              <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs">
                <summary className="cursor-pointer font-medium text-slate-900">Read full profile</summary>
                <p className="mt-2 leading-relaxed text-muted-foreground">{metadata.description}</p>
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
              {financialStatus === "Fresh"
                ? ratioYear !== null
                  ? <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">FY{ratioYear}</span>
                  : null
                : <StatusBadge label={financialStatus} tone={financialTone} />}
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
              <Unavailable note="Key financial signals are unavailable until sourced financials are loaded." />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
                <p className="text-[11px] text-muted-foreground">
                  {latestDevelopment.date ?? "Date unavailable"} · {latestDevelopment.source}
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
              <Unavailable note="No recent PSX filings retrieved for this company." />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-4 w-4" /> Dividend status</CardTitle>
                <CardDescription>User receipts and detected dividend records are reconciled here.</CardDescription>
              </div>
              {dividendIncomplete ? <StatusBadge label="Incomplete" tone="amber" /> : dividendComplete ? <StatusBadge label="Verified" tone="green" /> : <StatusBadge label="Unverified" tone="secondary" />}
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
                {holding && holding.dividend_income > 0 ? (
                  <OverviewMetric label="Recorded receipts" value={wholeMoney(holding.dividend_income)} />
                ) : null}
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                  <p className="font-semibold">Missing or unverified</p>
                  <ul className="mt-1.5 space-y-1 text-xs leading-relaxed">
                    <li>Dividend per share</li>
                    <li>Ex-date mapping</li>
                    <li>Entitlement reconciliation</li>
                  </ul>
                </div>
                <a href="#dividends" className="inline-flex h-8 items-center rounded-md border border-slate-200 px-2.5 text-xs font-medium hover:bg-slate-50">
                  View dividend history
                </a>
              </>
            ) : (
              <Unavailable note="No verified dividend records or user receipts are available yet." />
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
    getCompanyFilings(ticker, 25),
    supabase
      .from("company_financials")
      .select("period_type, fiscal_year, fiscal_period, statement_type, data, reported_date, source_url")
      .eq("ticker", ticker)
      .eq("statement_type", "income_statement")
      .order("reported_date", { ascending: false })
      .limit(8),
  ]);
  const resultFilings = filings.filter((f) => f.category === "result");
  const incomes = (finData ?? []) as FinancialRow[];
  const latest = incomes[0];
  const prior = incomes[1];

  const g = (k: string): number | null => {
    const a = latest?.data?.[k];
    const b = prior?.data?.[k];
    if (typeof a !== "number" || typeof b !== "number" || b === 0) return null;
    return ((a - b) / Math.abs(b)) * 100;
  };
  const v = (row: FinancialRow | undefined, k: string): number | null => {
    const x = row?.data?.[k];
    return typeof x === "number" ? x : null;
  };
  const margin = (row: FinancialRow | undefined): number | null => {
    const pat = v(row, "profit_after_tax");
    const rev = v(row, "revenue");
    return pat !== null && rev ? (pat / rev) * 100 : null;
  };

  return (
    <div className="space-y-4">
      {latest ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Latest result — {latest.fiscal_year} {latest.fiscal_period}</CardTitle>
            <CardDescription>
              Reported {latest.reported_date ?? "—"} ·{" "}
              <a href={latest.source_url ?? "#"} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">PSX source</a>
              {prior ? ` · compared with ${prior.fiscal_year} ${prior.fiscal_period}` : " · no prior period loaded yet for growth"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Revenue" value={num(v(latest, "revenue"))} sub={g("revenue") !== null ? `${formatSignedPct(g("revenue"))} vs prior` : undefined} tone={g("revenue") !== null ? (g("revenue")! >= 0 ? "positive" : "negative") : undefined} />
              <Metric label="Profit after tax" value={num(v(latest, "profit_after_tax"))} sub={g("profit_after_tax") !== null ? `${formatSignedPct(g("profit_after_tax"))} vs prior` : undefined} tone={g("profit_after_tax") !== null ? (g("profit_after_tax")! >= 0 ? "positive" : "negative") : undefined} />
              <Metric label="EPS (Rs)" value={num(v(latest, "eps"))} sub={g("eps") !== null ? `${formatSignedPct(g("eps"))} vs prior` : undefined} tone={g("eps") !== null ? (g("eps")! >= 0 ? "positive" : "negative") : undefined} />
              <Metric label="Profit before tax" value={num(v(latest, "profit_before_tax"))} />
              <Metric label="Net margin" value={margin(latest) !== null ? `${margin(latest)!.toFixed(1)}%` : "—"} sub={prior && margin(prior) !== null ? `prior ${margin(prior)!.toFixed(1)}%` : undefined} />
              <Metric label="Finance cost" value={num(v(latest, "finance_cost"))} />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Figures {String(latest.data?._units ?? "as reported")}; EPS in rupees. Missing values were not published on the PSX page.</p>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={TrendingUp}
          title="No earnings loaded yet"
          description={`Load ${ticker}'s revenue, profit, and EPS from the official PSX company page. Numbers are echoed from PSX, never invented.`}
          action={<FetchFinancialsButton ticker={ticker} readOnly={readOnly} />}
        />
      )}

      {incomes.length > 1 && (
        <Card>
          <CardHeader><CardTitle>Extracted periods</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <THead>
                <TR><TH>Period</TH><TH className="text-right">Revenue</TH><TH className="text-right">PAT</TH><TH className="text-right">EPS</TH><TH className="text-right">Net margin</TH><TH>Reported</TH></TR>
              </THead>
              <TBody>
                {incomes.map((r, i) => (
                  <TR key={i}>
                    <TD className="text-xs font-medium">{r.fiscal_year} {r.fiscal_period}</TD>
                    <TD className="text-right text-xs tabular-nums">{num(v(r, "revenue"))}</TD>
                    <TD className="text-right text-xs tabular-nums">{num(v(r, "profit_after_tax"))}</TD>
                    <TD className="text-right text-xs tabular-nums">{num(v(r, "eps"))}</TD>
                    <TD className="text-right text-xs tabular-nums">{margin(r) !== null ? `${margin(r)!.toFixed(1)}%` : "—"}</TD>
                    <TD className="text-[11px] text-muted-foreground">{r.reported_date ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Result & earnings filings</CardTitle>
          <CardDescription>Official quarterly and annual result announcements from the PSX portal.</CardDescription>
        </CardHeader>
        <CardContent>
          {resultFilings.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No result filings retrieved for {ticker}.</p>
          ) : (
            <ul className="space-y-2">
              {resultFilings.map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
                  <div>
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">{f.title}</a>
                    <p className="text-[11px] text-muted-foreground">{f.date ?? ""} · {f.source}</p>
                  </div>
                  <Badge variant="blue">result</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Ratios
// ---------------------------------------------------------------------------

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function highScore(value: number | null | undefined, low: number, high: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return clampScore(((value - low) / (high - low)) * 100);
}

function lowScore(value: number | null | undefined, good: number, bad: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return clampScore(((bad - value) / (bad - good)) * 100);
}

function lowPositiveScore(value: number | null | undefined, good: number, bad: number): number | null {
  if (value === null || value === undefined || value <= 0 || !Number.isFinite(value)) return null;
  return lowScore(value, good, bad);
}

function avgScore(values: (number | null)[]): number | null {
  const scored = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, v) => sum + v, 0) / scored.length);
}

function buildRatioFactors(ratios: RatioRow[]): { factor: string; score: number; summary: string }[] {
  const byName = new Map(ratios.map((r) => [r.ratio_name, r.ratio_value]));
  const v = (name: string) => byName.get(name) ?? null;
  const pctText = (name: string) => formatSignedPct(v(name), 1);
  const numText = (name: string) => formatNumber(v(name), 2);
  const row = (factor: string, scores: (number | null)[], summary: string) => {
    const score = avgScore(scores);
    return score === null ? null : { factor, score, summary };
  };

  return [
    row(
      "Value",
      [
        highScore(v("Earnings yield"), 0, 20),
        highScore(v("FCF yield"), 0, 15),
        lowPositiveScore(v("P/E"), 5, 30),
        lowPositiveScore(v("P/B"), 0.5, 3),
        lowPositiveScore(v("P/S"), 0.5, 5),
        lowPositiveScore(v("EV/EBIT"), 3, 25),
      ],
      `P/E ${numText("P/E")}, P/B ${numText("P/B")}, FCF yield ${pctText("FCF yield")}.`
    ),
    row(
      "Quality",
      [
        highScore(v("ROE"), 0, 30),
        highScore(v("ROIC"), 0, 25),
        highScore(v("Net margin"), 0, 25),
        highScore(v("Interest coverage"), 0, 8),
        highScore(v("OCF / PAT"), 0, 1.5),
        lowScore(v("Accrual ratio"), -0.1, 0.2),
      ],
      `ROE ${pctText("ROE")}, ROIC ${pctText("ROIC")}, OCF/PAT ${numText("OCF / PAT")}.`
    ),
    row(
      "Balance sheet",
      [
        lowScore(v("Debt-to-equity"), 0, 2),
        lowScore(v("Net debt-to-equity"), -0.5, 1.5),
        lowScore(v("Liabilities / assets"), 0.2, 0.8),
        highScore(v("Current ratio"), 0.6, 2),
        highScore(v("Cash ratio"), 0, 1),
      ],
      `Debt/equity ${numText("Debt-to-equity")}, net debt/equity ${numText("Net debt-to-equity")}, current ratio ${numText("Current ratio")}.`
    ),
    row(
      "Growth",
      [
        highScore(v("EPS growth"), -10, 30),
        highScore(v("Revenue growth"), -10, 25),
        highScore(v("Profit growth"), -10, 30),
        highScore(v("EPS CAGR"), 0, 20),
        highScore(v("Revenue CAGR"), 0, 20),
        highScore(v("Gross margin change"), -5, 5),
      ],
      `EPS growth ${pctText("EPS growth")}, revenue growth ${pctText("Revenue growth")}, revenue CAGR ${pctText("Revenue CAGR")}.`
    ),
    row(
      "Cash flow",
      [
        highScore(v("FCF margin"), -5, 20),
        highScore(v("FCF yield"), 0, 15),
        highScore(v("OCF / PAT"), 0, 1.5),
        highScore(v("Cash conversion"), 0, 1.5),
        lowScore(v("Accrual ratio"), -0.1, 0.2),
      ],
      `FCF margin ${pctText("FCF margin")}, cash conversion ${numText("Cash conversion")}, accrual ratio ${numText("Accrual ratio")}.`
    ),
  ].filter((r): r is { factor: string; score: number; summary: string } => r !== null);
}

export async function RatiosPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();

  // Always compute live from stored inputs — the engine is pure reads, so the
  // tab reflects the newest extracted financials and quote without waiting on
  // a persisted snapshot.
  const ratios = await computeRatios(supabase, ticker);
  const available = ratios.filter((r) => r.ratio_value !== null);
  const hasFinancials = ratios.some((r) => r.source !== null);
  const factorRows = buildRatioFactors(ratios);

  const fmtVal = (r: (typeof ratios)[number]): string => {
    if (r.ratio_value === null) return "—";
    if (/Days sales outstanding/i.test(r.ratio_name)) return `${r.ratio_value.toFixed(0)} days`;
    if (/^(Shares outstanding|Market cap)/i.test(r.ratio_name)) return formatNumber(r.ratio_value, 0);
    const pctNames = /yield|margin|growth|ROE|ROA|ROIC|Payout|tax rate|CAGR|change|% of/i;
    return pctNames.test(r.ratio_name) ? `${r.ratio_value.toFixed(2)}%` : r.ratio_value.toFixed(2);
  };

  return (
    <div className="space-y-3">
      {!hasFinancials && (
        <EmptyState
          icon={Calculator}
          title="Most ratios need financials loaded"
          description={`Only market-data ratios can be computed for ${ticker} right now. Load the official PSX company page to unlock P/E, margins, and growth ratios.`}
          action={<FetchFinancialsButton ticker={ticker} readOnly={readOnly} />}
        />
      )}
      {factorRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Fundamental factor snapshot</CardTitle>
            <CardDescription>
              A quick visual read of the company&apos;s value, quality, balance sheet, growth, and cash-flow profile. Scores only use ratios that are available below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RatioSnapshotChart data={factorRows} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Calculator className="h-4 w-4" /> Fundamental ratios</CardTitle>
          <CardDescription>
            {available.length} of {ratios.length} computable from stored, sourced data. Uncomputable rows name the exact missing input — nothing is estimated.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <THead>
              <TR><TH>Ratio</TH><TH className="text-right">Value</TH><TH>Formula</TH><TH>Period</TH></TR>
            </THead>
            <TBody>
              {ratios.map((r) => (
                <TR key={r.ratio_name}>
                  <TD className="text-xs font-medium">
                    {METRIC_HINTS[r.ratio_name] ? (
                      <span className="cursor-help decoration-muted-foreground/40 underline decoration-dotted underline-offset-2" title={METRIC_HINTS[r.ratio_name]}>
                        {r.ratio_name}
                      </span>
                    ) : (
                      r.ratio_name
                    )}
                  </TD>
                  <TD
                    className={cn("text-right text-xs tabular-nums", r.ratio_value === null && "text-muted-foreground")}
                    title={r.missing ?? undefined}
                  >
                    {fmtVal(r)}
                  </TD>
                  <TD className="text-[11px] text-muted-foreground">{r.formula}{r.missing ? <span className="block text-[10px] italic">{r.missing}</span> : null}</TD>
                  <TD className="text-[11px] text-muted-foreground">{r.source_period ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Inputs: official PSX company page + live quote + recorded dividends · computed {new Date().toISOString().slice(0, 10)}
            {ratios[0]?.source ? <> · <a href={ratios[0].source} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">PSX source</a></> : null}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Technicals
// ---------------------------------------------------------------------------

export async function TechnicalsPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();
  const technicals = await getTechnicals(supabase, ticker);
  const signals = computeSignals(technicals.history);

  // KSE-100 closes power the "vs KSE-100" relative view on the price chart.
  const eod = await getCachedEod(supabase, []);
  const benchmark = (eod.get(KSE_SYMBOL) ?? []).map((p) => ({ date: p.date, close: p.close }));

  if (technicals.history.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No price history available"
        description={`The PSX portal returned no daily history for ${ticker}. This is normal for newly listed, suspended, or illiquid symbols.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Price & volume</CardTitle>
        </CardHeader>
        <CardContent>
          <StockPriceChart candles={technicals.history} signals={signals} benchmark={benchmark} ticker={ticker} />
          <div className="mt-2"><SectionMeta meta={technicals.meta} ticker={ticker} refreshSection={readOnly ? undefined : "technicals"} /></div>
        </CardContent>
      </Card>

      {signals.accumulation && (
        <Card className="chart-reveal">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Long-term structure
            </CardTitle>
            <CardDescription>This helps with accumulation timing. Your fundamentals should drive the decision, not the chart.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <p className="font-medium">
              The long-term trend is{" "}
              <span className={cn(signals.longTermTrend === "uptrend" && "text-emerald-600", signals.longTermTrend === "downtrend" && "text-red-600")}>
                {signals.longTermTrend === "uptrend" ? "rising" : signals.longTermTrend === "downtrend" ? "falling" : "sideways"}
              </span>{" "}
              and the price is{" "}
              <span className={cn(signals.accumulation.status === "attractive" && "text-emerald-600", signals.accumulation.status === "deteriorating" && "text-red-600", signals.accumulation.status === "extended" && "text-amber-600")}>
                {signals.accumulation.status === "attractive" ? "at a healthy accumulation level" : signals.accumulation.status === "extended" ? "extended above its recent base" : signals.accumulation.status === "deteriorating" ? "below its normal pullback range" : "at an unclear level"}
              </span>
              {signals.divergences[0] ? `. There is a ${signals.divergences[0].kind} momentum divergence.` : "."}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{signals.accumulation.note}</p>
            {signals.seasonality.length > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Seasonality.</span>{" "}
                {signals.seasonality
                  .map((w) => `In the past, ${w.label} closed positive in ${w.positive} of ${w.years} years (${w.winRatePct.toFixed(0)}%), with an average move of ${w.avgReturnPct >= 0 ? "+" : ""}${w.avgReturnPct.toFixed(1)}%.`)
                  .join(" ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="20-day MA" value={num(technicals.ma20)} />
        <Metric label="50-day MA" value={num(technicals.ma50)} />
        <Metric label="100-day MA" value={num(technicals.ma100)} />
        <Metric label="200-day MA" value={num(technicals.ma200)} />
        <Metric label="RSI (14)" value={technicals.rsi !== null ? technicals.rsi.toFixed(0) : "—"} />
        <Metric label="Avg volume (30d)" value={num(technicals.averageVolume)} />
        <Metric label="52-wk high" value={num(technicals.fiftyTwoWeekHigh)} sub={technicals.distanceFromHighPct !== null ? `${formatSignedPct(technicals.distanceFromHighPct)} away` : undefined} />
        <Metric label="52-wk low" value={num(technicals.fiftyTwoWeekLow)} sub={technicals.distanceFromLowPct !== null ? `${formatSignedPct(technicals.distanceFromLowPct)} away` : undefined} />
        <Metric label="Volume (last)" value={num(technicals.volume)} />
        <Metric label="Volatility" value={technicals.volatility !== null ? `${technicals.volatility.toFixed(1)}%` : "—"} sub="annualized" />
      </div>

      <Card>
        <CardHeader><CardTitle>Trend signals</CardTitle><CardDescription>Neutral observations, not trading signals.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {technicals.flags.length === 0 ? (
            <p className="text-xs text-muted-foreground">Not enough history to derive trend signals.</p>
          ) : (
            technicals.flags.map((f, i) => (
              <Badge key={i} variant={f.tone === "positive" ? "green" : f.tone === "negative" ? "red" : "secondary"}>{f.label}</Badge>
            ))
          )}
        </CardContent>
      </Card>
    </div>
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
