import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { getCompanyFilings } from "@/lib/company/filings";
import { getFundamentals, type FundamentalsData } from "@/lib/company/fundamentals";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getClustersForTickers } from "@/lib/news/global-store";
import { sectorColor } from "@/lib/shared/sector-colors";
import { computeRatios, type RatioRow } from "@/lib/engine/ratios";
import { buildKeyFigures, formatRatioValue, isContested, readerKeyFigures, withheldReason } from "@/lib/company/key-figures";
import { TREND_FIELDS, TREND_YEARS, filingCategoryLabel, newsSourceLabel, officialDescription, recentFilings, RECENT_FILING_DAYS } from "@/lib/company/overview";
import { growthReading, payoutReading, priceStructureReading, valuationReading } from "@/lib/company/readings";
import { groupRatiosForReader } from "@psx/shared/company/ratio-groups";
import { MoreDetail } from "@/components/shared/more-detail";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionButton } from "@/components/ui/action-button";
import { Metric } from "@/components/ui/metric";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { AskCopilotLink } from "@/components/shared/ask-copilot-link";
import { FundamentalsGrid } from "@/components/features/stocks/fundamentals-grid";
import { WhatIfCalculator } from "@/components/features/stocks/what-if-calculator";
import { FilingsSpine, type SpineEntry } from "@/components/features/stocks/filings-spine";
import { formatNumber, formatFinancialPeriod, formatSignedPct, cn } from "@/lib/shared/format";
import { adjustForCorporateActions, detectCorporateActionBreaks } from "@psx/shared/market/adjust";
import { FileText } from "lucide-react";

const compactShares = (v: number) =>
  new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: 1 }).format(v);

const compactPkr = (v: number) =>
  new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** A price or a cost basis, always to two decimals. */
const price2 = (v: number) =>
  v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DATE = new Intl.DateTimeFormat("en-PK", { day: "2-digit", month: "short", year: "numeric" });
const readableDate = (iso: string | null | undefined): string => {
  if (!iso) return "undated";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
};

function ratioByName(rows: RatioRow[], name: string): RatioRow | null {
  return rows.find((r) => r.ratio_name === name) ?? null;
}

const SECTION_LABEL = "border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint";

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------

/**
 * A reader's description of a withheld ratio: what to print in place of the
 * figure, and the reason for the caption beneath it.
 */
function withheldDisplay(row: RatioRow | null): { value: string; caption: string } {
  if (row && isContested(row.missing)) return { value: "Contested, under review", caption: withheldReason(row.missing) };
  if (row?.missing && /^Loss-making/i.test(row.missing)) return { value: "No multiple, loss-making period", caption: "" };
  return { value: "Not enough filed data", caption: withheldReason(row?.missing) };
}

/**
 * Small bars for three or four filed years. A withheld year draws as a hollow
 * slot rather than a gap, so the reader sees it was filed and is under
 * review, not that it was never filed.
 */
function TinyBars({
  points,
  withheld,
  format,
}: {
  points: { year: number; value: number }[];
  withheld: { year: number; reason: string }[];
  format: (v: number) => string;
}) {
  const years = [...new Set([...points.map((p) => p.year), ...withheld.map((w) => w.year)])].sort((a, b) => a - b).slice(-TREND_YEARS);
  if (years.length === 0) return null;
  const byYear = new Map(points.map((p) => [p.year, p.value]));
  const reasonFor = new Map(withheld.map((w) => [w.year, w.reason]));

  const values = years.map((y) => byYear.get(y)).filter((v): v is number => typeof v === "number");
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const H = 44;
  const W = 22;
  const GAP = 10;
  const zeroY = (hi / span) * H;

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${years.length * (W + GAP) - GAP} ${H}`}
        width={years.length * (W + GAP) - GAP}
        height={H}
        className="block overflow-visible"
        aria-hidden="true"
      >
        {years.map((year, i) => {
          const x = i * (W + GAP);
          const v = byYear.get(year);
          if (typeof v !== "number") {
            return (
              <rect key={year} x={x + 0.5} y={0.5} width={W - 1} height={H - 1} fill="none" stroke="var(--ink-4)" strokeDasharray="2 2" />
            );
          }
          const top = v >= 0 ? zeroY - (v / span) * H : zeroY;
          const h = Math.max(1.5, (Math.abs(v) / span) * H);
          const last = i === years.length - 1;
          return <rect key={year} x={x} y={top} width={W} height={h} fill={v < 0 ? "var(--down-2)" : last ? "var(--ink-1)" : "var(--ink-4)"} />;
        })}
      </svg>
      <div className="mt-1.5 flex" style={{ width: years.length * (W + GAP) - GAP }}>
        {years.map((year) => {
          const v = byYear.get(year);
          const reason = reasonFor.get(year);
          return (
            <span
              key={year}
              className="figure shrink-0 text-center text-(length:--text-3xs) text-text-faint"
              style={{ width: W, marginRight: GAP }}
              title={typeof v === "number" ? `FY${year}: ${format(v)}` : reason ? `FY${year} withheld. ${reason}` : undefined}
            >
              {String(year).slice(2)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function withheldYears(fundamentals: FundamentalsData, fields: string[]): { year: number; reason: string }[] {
  const seen = new Set<number>();
  return fundamentals.contested
    .filter((c) => fields.includes(c.field))
    .filter((c) => (seen.has(c.year) ? false : (seen.add(c.year), true)))
    .map((c) => ({ year: c.year, reason: c.reason }));
}

/**
 * One of the three plain questions. The reading is the answer in a sentence,
 * computed from the filed figures by lib/company/readings; the figures beneath
 * it are the evidence.
 */
function QuestionRow({ question, reading, children }: { question: string; reading: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-rule py-6 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-8">
      <h3 className="font-display text-(length:--text-h3) font-normal tracking-editorial text-text-strong">{question}</h3>
      <div className="min-w-0">
        <p className="mb-5 max-w-(--measure) text-base leading-relaxed text-text-strong">{reading}</p>
        {children}
      </div>
    </section>
  );
}

function Figure({ label, value, period, reading, caption, children }: {
  label: string;
  value: string;
  period?: string | null;
  reading?: string | null;
  caption?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="figure text-(length:--text-h2) font-semibold text-text-strong">{value}</span>
        {period && <span className="figure text-(length:--text-2xs) text-text-faint">{period}</span>}
      </p>
      {reading && <p className="mt-1 max-w-(--measure) text-sm leading-relaxed text-text-muted">{reading}</p>}
      {children}
      {caption && <p className="mt-1.5 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">{caption}</p>}
    </div>
  );
}

export async function OverviewPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [metadata, ratios, fundamentals, portfolio, payoutsRes] = await Promise.all([
    getCompanyMetadata(supabase, ticker),
    computeRatios(supabase, ticker),
    getFundamentals(supabase, ticker),
    getPortfolio(supabase, user.id),
    supabase
      .from("company_payouts")
      .select("kind, term, dividend_per_share, announcement_date")
      .eq("ticker", ticker)
      .order("announcement_date", { ascending: false })
      .limit(24),
  ]);

  const summary = officialDescription(metadata);
  const holding = portfolio.holdings.find((h) => h.ticker === ticker) ?? null;

  // Is it growing?
  const revenue = fundamentals.series.revenue.points.slice(-TREND_YEARS);
  const eps = fundamentals.series.eps.points.slice(-TREND_YEARS);
  const margin = fundamentals.series.margin.points.slice(-TREND_YEARS);
  const revenueWithheld = withheldYears(fundamentals, TREND_FIELDS.revenue);
  const epsWithheld = withheldYears(fundamentals, TREND_FIELDS.eps);
  const fmtPkr = (v: number) => `PKR ${compactPkr(v)}`;
  const fmtEps = (v: number) => `PKR ${formatNumber(v, 2)}`;
  const marginLast = margin[margin.length - 1] ?? null;
  const marginFirst = margin.length > 1 ? margin[0] : null;
  const marginReading =
    marginLast === null
      ? "No filed net margin on record."
      : marginFirst
        ? `Net margin ${marginLast.value.toFixed(1)}% in FY${marginLast.year}, from ${marginFirst.value.toFixed(1)}% in FY${marginFirst.year}.`
        : `Net margin ${marginLast.value.toFixed(1)}% in FY${marginLast.year}.`;
  const growReading = growthReading(revenue, eps);

  // Does it pay?
  const yieldRow = ratioByName(ratios, "Dividend yield (TTM)");
  const payoutRow = ratioByName(ratios, "Payout ratio");
  const ttmDpsRaw = yieldRow?.inputs.ttm_dps;
  const ttmDps = typeof ttmDpsRaw === "number" && Number.isFinite(ttmDpsRaw) ? ttmDpsRaw : null;
  const divYield = yieldRow?.ratio_value ?? null;
  const payout = payoutRow?.ratio_value ?? null;
  const cashPayouts = (payoutsRes.data ?? [])
    .filter((p) => (!p.kind || String(p.kind).toLowerCase() === "cash") && typeof p.dividend_per_share === "number")
    .slice(0, 4);
  const payReading = payoutReading({ ttmDps, divYield, payoutRatio: payout });

  // Is it expensive?
  const peRow = ratioByName(ratios, "P/E");
  const pbRow = ratioByName(ratios, "P/B");
  const pe = peRow?.ratio_value ?? null;
  const sectorPe = fundamentals.sectorPe;
  const peWithheld = pe === null ? withheldDisplay(peRow) : null;
  const peReading = valuationReading({ pe, sectorMedianPe: sectorPe.median, peers: sectorPe.contributors, missing: peRow?.missing });

  // A figure that is only a gap in the data is left out; one that is contested
  // or loss-making stays, with its reason, because that is worth knowing.
  const keyFigures = readerKeyFigures(buildKeyFigures(ratios));

  return (
    <div>
      <p className="eyebrow">What the company does</p>
      <p className="mt-3 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        {summary ??
          `No description on file. PSX company data carries no business summary for ${ticker} yet, so nothing is shown rather than inferred.`}
      </p>

      {holding && (
        <div className="mt-10">
          <p className={SECTION_LABEL}>Your position</p>
          <div className="grid grid-cols-2 gap-y-5 pt-4 sm:grid-cols-3 lg:grid-cols-6">
            <Metric size="compact" label="Shares" value={formatNumber(holding.quantity, 0)} />
            <Metric size="compact" label="Average cost" value={price2(holding.avg_cost)} sub="PKR per share" />
            <Metric size="compact" label="Value now" value={holding.market_value !== null ? `PKR ${formatNumber(holding.market_value, 0)}` : "—"} sub={holding.market_value === null ? "no recent price" : undefined} />
            <Metric
              size="compact"
              label="Unrealised P/L"
              value={holding.unrealized_pl !== null ? `${holding.unrealized_pl < 0 ? "−" : "+"}${formatNumber(Math.abs(holding.unrealized_pl), 0)}` : "—"}
              sub={holding.unrealized_pl_pct !== null ? `${formatSignedPct(holding.unrealized_pl_pct)} on cost` : undefined}
              tone={holding.unrealized_pl === null ? undefined : holding.unrealized_pl >= 0 ? "up" : "down"}
            />
            <Metric size="compact" label="Share of portfolio" value={holding.weight !== null ? `${holding.weight.toFixed(1)}%` : "—"} sub="by value" />
            <Metric size="compact" label="Dividends received" value={`PKR ${formatNumber(holding.dividend_income, 0)}`} sub="from this company" />
          </div>
        </div>
      )}

      <div className="mt-10">
        <p className={SECTION_LABEL}>Three plain questions</p>

        <QuestionRow question="Is it growing?" reading={growReading}>
          <div className="grid gap-6 sm:grid-cols-2">
            <Figure
              label="Revenue"
              value={revenue.length ? fmtPkr(revenue[revenue.length - 1].value) : "—"}
              period={revenue.length ? `FY${revenue[revenue.length - 1].year}` : null}
              caption={revenueWithheld.map((w) => `FY${w.year} withheld. ${w.reason}`).join(" ") || null}
            >
              <TinyBars points={revenue} withheld={revenueWithheld} format={fmtPkr} />
            </Figure>
            <Figure
              label="Earnings per share"
              value={eps.length ? fmtEps(eps[eps.length - 1].value) : "—"}
              period={eps.length ? `FY${eps[eps.length - 1].year}` : null}
              caption={epsWithheld.map((w) => `FY${w.year} withheld. ${w.reason}`).join(" ") || null}
            >
              <TinyBars points={eps} withheld={epsWithheld} format={fmtEps} />
            </Figure>
          </div>
          <p className="mt-4 max-w-(--measure) text-sm leading-relaxed text-text-muted">{marginReading}</p>
        </QuestionRow>

        <QuestionRow question="Does it pay?" reading={payReading}>
          <div className="grid gap-6 sm:grid-cols-2">
            <Figure
              label="Dividend yield"
              value={divYield !== null ? `${divYield.toFixed(2)}%` : "—"}
              period={divYield !== null ? "last 12 months" : null}
              caption={divYield === null ? withheldReason(yieldRow?.missing) : null}
            />
            <div>
              <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Last cash payouts</p>
              {cashPayouts.length === 0 ? (
                <p className="mt-1 text-sm text-text-muted">No cash payout announcements on file.</p>
              ) : (
                <ul className="mt-1">
                  {cashPayouts.map((p, i) => (
                    <li key={`${p.announcement_date}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-rule py-1.5 last:border-0">
                      <span className="figure text-sm text-text-muted">
                        {readableDate(p.announcement_date)}
                        {p.term ? <span className="text-text-faint"> {String(p.term).toLowerCase()}</span> : null}
                      </span>
                      <span className="figure text-sm font-semibold text-text-strong">PKR {formatNumber(p.dividend_per_share as number, 2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </QuestionRow>

        <QuestionRow question="Is it expensive?" reading={peReading}>
          <div className="grid gap-6 sm:grid-cols-2">
            <Figure
              label="Price to earnings"
              value={pe !== null ? `${pe.toFixed(1)}x` : peWithheld?.value ?? "—"}
              period={pe !== null ? formatFinancialPeriod(peRow?.source_period) : null}
              caption={peWithheld?.caption || null}
            />
            {pbRow && (
              <Figure
                label="Price to book"
                value={pbRow.ratio_value !== null ? `${pbRow.ratio_value.toFixed(2)}x` : withheldDisplay(pbRow).value}
                period={pbRow.ratio_value !== null ? formatFinancialPeriod(pbRow.source_period) : null}
                reading={
                  pbRow.ratio_value === null
                    ? null
                    : pbRow.ratio_value < 1
                      ? "The shares trade below the net assets on the books."
                      : `You pay ${pbRow.ratio_value.toFixed(2)} rupees for each rupee of book value.`
                }
                caption={pbRow.ratio_value === null ? withheldDisplay(pbRow).caption || null : null}
              />
            )}
          </div>
        </QuestionRow>

        <WhatIfCalculator ticker={ticker} />
      </div>

      <div className="mt-10">
        <p className={SECTION_LABEL}>Key figures</p>
        <div className="grid grid-cols-2 gap-y-6 pt-4 sm:grid-cols-4">
          {keyFigures.map((f) => (
            <div key={f.key} title={f.hint} className="pr-4">
              <Metric
                size="compact"
                label={f.label}
                value={f.display}
                sub={f.withheld ?? f.period ?? undefined}
              />
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
          Hover a figure for what it means. Every figure is struck on filed accounts and today&apos;s price. A
          withheld one says why, and one with no filed input yet is left out. The full set is under Financials.
        </p>
      </div>
    </div>
  );
}

/**
 * The last five official filings and up to three news clusters, on one dated
 * list. Filings carry a "PSX filing" label and the category in words; media
 * carries the publisher's hostname. That label is the whole distinction, so
 * the two are told apart without a colour code.
 */
export async function RecentDevelopmentsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const [filings, clusters] = await Promise.all([
    getCompanyFilings(ticker, 5, { supabase }),
    getClustersForTickers(supabase, [ticker], { limit: 3 }),
  ]);

  const entries = [
    ...filings.map((f) => ({
      key: `f-${f.date}-${f.title}`,
      date: f.date,
      label: "PSX filing",
      title: f.title,
      note: filingCategoryLabel(f.category),
      url: f.url as string | null,
    })),
    ...clusters.map((c) => ({
      key: `n-${c.id}`,
      date: (c.last_published_at ?? c.first_published_at)?.slice(0, 10) ?? null,
      label: newsSourceLabel(c.url) ?? "Press",
      title: c.title,
      note: c.article_count > 1 ? `${c.article_count} articles` : "",
      url: c.url,
    })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <div className="mt-10">
      <p className={SECTION_LABEL}>Recent developments</p>
      {entries.length === 0 ? (
        <p className="mt-4 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No filings or coverage on file for {ticker}. Announcements appear here as the exchange publishes them.
        </p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-4 border-b border-rule py-3 sm:grid-cols-[6.5rem_7.5rem_minmax(0,1fr)]">
              <span className="figure text-(length:--text-2xs) text-text-faint">{readableDate(e.date)}</span>
              <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{e.label}</span>
              <span className="col-span-2 min-w-0 sm:col-span-1">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="text-sm text-text-strong hover:underline">{e.title}</a>
                ) : (
                  <span className="text-sm text-text-strong">{e.title}</span>
                )}
                {e.note && <span className="ml-2 text-(length:--text-2xs) text-text-faint">{e.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-(length:--text-2xs) text-text-faint">
        <Link href="#filings" className="hover:text-text-strong hover:underline">Everything filed or reported is under Filings.</Link>
      </p>
    </div>
  );
}

/** The closing prompt on the Overview. */
export function AskAboutCompany({ ticker }: { ticker: string }) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-rule-strong pt-6">
      <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
        Want the plain version? Ask for a walk through {ticker} in a few sentences.
      </p>
      <AskCopilotLink
        label={`Ask about ${ticker}`}
        question={`Explain ${ticker} to me simply: what it does, how it is doing, and whether it pays dividends.`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Financials
// ---------------------------------------------------------------------------

interface FinancialRow {
  ticker: string;
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  data: Record<string, number | null | string>;
  reported_date: string | null;
  source_type: string | null;
  source_url: string | null;
  reporting_basis: string | null;
  review_status: string | null;
  confidence: number | null;
  updated_at: string | null;
}

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

/**
 * Fundamentals: the six metrics as small multiples over their filed years.
 *
 * The design asks for a reading of how the business earns, against its own
 * history and its sector, rather than a table of every line item ever
 * extracted. The heading sits in the page, above the Suspense boundary.
 */
export async function FinancialsPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();
  const [{ data }, { data: lastLog }, fundamentals, { data: master }] = await Promise.all([
    supabase
      .from("company_financials")
      .select("ticker, period_type, fiscal_year, fiscal_period, statement_type, data, reported_date, source_type, source_url, reporting_basis, review_status, confidence, updated_at")
      .eq("ticker", ticker)
      .eq("review_status", "published")
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
    getFundamentals(supabase, ticker),
    supabase.from("stock_master").select("sector").eq("ticker", ticker).maybeSingle(),
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
              ? `Last fetch attempt: ${String(lastLog.created_at).slice(0, 16).replace("T", " ")} via ${lastLog.source}, ${lastLog.status}${lastLog.detail ? ` (${lastLog.detail})` : ""}. The engine reads the official PSX company page; numbers are echoed from PSX, never invented.`
              : `No data has been loaded for ${ticker} yet. The engine reads the official PSX company page (sales, EPS, margins); numbers are echoed from PSX, never invented.`
          }
          action={<FetchFinancialsButton ticker={ticker} readOnly={readOnly} />}
        />
      </div>
    );
  }

  // Only promise the median hairline when at least one cell actually draws one;
  // sectors with too few filers show none.
  const hasAnyMedian = Object.values(fundamentals.series).some((v) => v.sectorMedian !== null);

  return (
    <div>
      <p className="mb-7 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        The shaded band is this company&apos;s own filed range{hasAnyMedian ? ", and the dashed hairline is the sector median" : ""}.
        Select a chart to read the years and the sector ranking.
      </p>
      <FundamentalsGrid data={fundamentals} hue={sectorColor(master?.sector)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Earnings
// ---------------------------------------------------------------------------

/**
 * Earnings: reported EPS by quarter, against the same quarter a year earlier.
 *
 * We have no expected figure. PSX publishes no consensus and we source none,
 * so rather than invent an estimate to subtract from, the bars compare each
 * quarter with the same quarter of the prior year, which is the comparison a
 * PSX reader makes anyway and needs no data we do not hold.
 */
export async function EarningsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_financials")
    .select("fiscal_year, fiscal_period, data, updated_at")
    .eq("ticker", ticker)
    .eq("period_type", "quarterly")
    .eq("review_status", "published")
    .order("fiscal_year", { ascending: true })
    .limit(60);

  // One row per fiscal quarter, newest extraction winning, same rule as the
  // annual merge: a company can hold two extractions that disagree.
  const byQuarter = new Map<string, { year: number; period: string; eps: number }>();
  for (const r of [...(data ?? [])].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))) {
    const eps = (r.data as Record<string, unknown> | null)?.eps;
    if (typeof eps !== "number" || !Number.isFinite(eps)) continue;
    if (!r.fiscal_period) continue;
    byQuarter.set(`${r.fiscal_year}-${r.fiscal_period}`, { year: r.fiscal_year, period: r.fiscal_period, eps });
  }

  // Five fiscal years where the filings support it. Eight quarters only ever
  // showed two years, which is one year-on-year comparison per quarter and no
  // sense of whether a move is a trend or a wobble. Companies whose history is
  // thinner simply render fewer rows.
  const quarters = [...byQuarter.values()]
    .sort((a, b) => a.year - b.year || a.period.localeCompare(b.period))
    .slice(-20);

  if (quarters.length === 0) {
    return (
      <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
        No quarterly accounts have been extracted for {ticker} yet. They appear here as the filings are read.
      </p>
    );
  }

  const rows = quarters.map((q) => {
    const prior = byQuarter.get(`${q.year - 1}-${q.period}`) ?? null;
    const change = prior && prior.eps !== 0 ? ((q.eps - prior.eps) / Math.abs(prior.eps)) * 100 : null;
    return { ...q, prior: prior?.eps ?? null, change };
  });

  const withChange = rows.filter((r) => r.change !== null);

  // The ledger carries the full five years; the bars carry the recent shape.
  // Twenty bars at a legible width is a chart nobody can see the end of
  // without scrolling, and the older ones are the least interesting.
  const chartRows = rows.slice(-12);
  // Scaled to the tallest bar actually drawn, so a swing that is no longer on
  // screen cannot flatten every visible bar against the floor.
  const maxAbs = Math.max(1, ...chartRows.filter((r) => r.change !== null).map((r) => Math.abs(r.change as number)));
  const newestFirst = [...rows].reverse();
  const recentRows = newestFirst.slice(0, 4);
  const earlierRows = newestFirst.slice(4);

  return (
    <div>
      <p className="mb-8 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        Each quarter&apos;s reported earnings per share against the same quarter a year earlier, which controls for
        the seasonality most PSX businesses carry. No analyst estimate is involved, because none is published for
        this market.
      </p>

      {/*
        The bars only earn their space once there are a few of them to compare.
        With one or two year-on-year pairs the chart is mostly empty slots
        labelled "no prior year", which reads as broken rather than sparse.
      */}
      {withChange.length >= 3 && (
        <div className="flex items-end gap-3 overflow-x-auto pb-1" style={{ minHeight: "11rem" }}>
          {chartRows.map((r) => {
            const pct = r.change;
            const h = pct === null ? 0 : Math.max(4, (Math.abs(pct) / maxAbs) * 96);
            const up = (pct ?? 0) >= 0;
            return (
              <div key={`${r.year}-${r.period}`} className="flex min-w-[5.5rem] flex-1 flex-col items-stretch">
                <div className="flex h-24 items-end">
                  {pct !== null && (
                    <span className={cn("block w-full", up ? "bg-up" : "bg-down")} style={{ height: `${h}px` }} />
                  )}
                </div>
                <span className={cn("figure mt-2 block text-center text-(length:--text-2xs) font-semibold", pct === null ? "text-text-faint" : up ? "text-up" : "text-down")}>
                  {pct === null ? "no prior year" : `${up ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}
                </span>
                <span className="figure mt-0.5 block text-center text-(length:--text-2xs) text-text-faint">
                  {r.period} FY{r.year}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/*
        The newest four periods are the ledger a reader actually checks; the
        rest of the five-year record stays a fold away, nothing dropped.
      */}
      <div className="mt-9 overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] gap-4 border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
            <span>Quarter</span>
            <span className="text-right">Reported EPS</span>
            <span className="text-right">Year before</span>
            <span className="text-right">Change</span>
          </div>
          {recentRows.map((r) => <EarningsRow key={`row-${r.year}-${r.period}`} row={r} />)}
          {earlierRows.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none py-3 text-sm font-semibold text-text-muted transition-colors hover:text-text-strong [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show earlier periods ({earlierRows.length})</span>
                <span className="hidden group-open:inline">Hide earlier periods</span>
              </summary>
              {earlierRows.map((r) => <EarningsRow key={`row-${r.year}-${r.period}`} row={r} />)}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function EarningsRow({ row: r }: { row: { year: number; period: string; eps: number; prior: number | null; change: number | null } }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] items-baseline gap-4 border-b border-rule py-2.5">
      <span className="figure text-sm text-text-strong">{r.period} FY{r.year}</span>
      <span className="figure text-right text-sm font-semibold text-text-strong">{formatNumber(r.eps)}</span>
      <span className="figure text-right text-sm text-text-muted">{r.prior === null ? "—" : formatNumber(r.prior)}</span>
      <span className={cn("figure text-right text-sm font-semibold", r.change === null ? "text-text-faint" : r.change >= 0 ? "text-up" : "text-down")}>
        {r.change === null ? "—" : `${r.change >= 0 ? "+" : "−"}${Math.abs(r.change).toFixed(1)}%`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. All ratios
// ---------------------------------------------------------------------------

/**
 * Every ratio the engine computes, grouped the way the questions get asked.
 * A withheld ratio keeps its row and says why beneath the name, so the table
 * never has a silent gap.
 *
 * The table is the reader's view: a group in which nothing was computed (the
 * Banking ratios of an oil producer) is left out, and the rows only an analyst
 * reads sit under their own fold. groupRatiosForReader is the one rule for
 * both, shared with the phone.
 */
export async function RatiosPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const ratios = await computeRatios(supabase, ticker);

  if (ratios.length === 0) {
    return (
      <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
        No ratios yet for {ticker}. They are computed once filed accounts are on record.
      </p>
    );
  }

  const { groups, analyst } = groupRatiosForReader(ratios.map((r) => ({ name: r.ratio_name, value: r.ratio_value, row: r })));

  return (
    <div>
      <Table variant="reader">
        <THead>
          <TR>
            <TH>Ratio</TH>
            <TH className="text-right">Value</TH>
            <TH className="text-right">Period</TH>
          </TR>
        </THead>
        <TBody>
          {groups.map((g) => (
            <GroupRows key={g.title} title={g.title} rows={g.rows.map((r) => r.row)} />
          ))}
        </TBody>
      </Table>
      {analyst.length > 0 && (
        <MoreDetail title="Analyst rows" compact className="mt-6">
          <p className="mb-3 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
            Reconciliations, derived share counts and second-order accrual and cost measures. Kept for checking the
            engine&apos;s work rather than for forming a view.
          </p>
          <Table variant="reader">
            <TBody>
              <GroupRows title="Analyst" rows={analyst.map((r) => r.row)} />
            </TBody>
          </Table>
        </MoreDetail>
      )}
    </div>
  );
}

function GroupRows({ title, rows }: { title: string; rows: RatioRow[] }) {
  return (
    <>
      <TR>
        <TD colSpan={3} className="pt-5 pb-1.5 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
          {title}
        </TD>
      </TR>
      {rows.map((r) => {
        const withheld = r.ratio_value === null;
        return (
          <TR key={r.ratio_name}>
            <TD className="py-2 align-top">
              <span className="text-text-strong" title={r.formula}>{r.ratio_name}</span>
              {withheld && (
                <span className="mt-0.5 block max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
                  {withheldReason(r.missing)}
                </span>
              )}
            </TD>
            <TD className={cn("figure py-2 text-right align-top", withheld ? "text-text-faint" : "font-semibold text-text-strong")}>
              {formatRatioValue(r.ratio_name, r.ratio_value)}
            </TD>
            <TD className="figure py-2 text-right align-top text-text-muted">
              {formatFinancialPeriod(r.source_period) ?? r.source_period ?? ""}
            </TD>
          </TR>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Statements as filed
// ---------------------------------------------------------------------------

const STATEMENT_LABEL: Record<string, string> = {
  income_statement: "Income statement",
  balance_sheet: "Balance sheet",
  cash_flow: "Cash flow",
};

const PERIOD_ORDER: Record<string, number> = { FY: 0, "9M": 1, H1: 2, Q4: 3, Q3: 4, Q2: 5, Q1: 6 };

/**
 * The filings behind the figures: each published statement with the unit it
 * was extracted in, the reporting basis and a link to the source. This is the
 * audit trail for everything above it, so a reader can check a number against
 * the document it came from.
 */
export async function StatementsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_financials")
    .select("ticker, period_type, fiscal_year, fiscal_period, statement_type, data, reported_date, source_type, source_url, reporting_basis, review_status, confidence, updated_at")
    .eq("ticker", ticker)
    .eq("review_status", "published")
    .order("fiscal_year", { ascending: false })
    .limit(200);

  // One row per statement and period, the newest extraction winning.
  const byKey = new Map<string, FinancialRow>();
  for (const r of [...((data ?? []) as FinancialRow[])].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))) {
    byKey.set(`${r.statement_type}|${r.fiscal_year}|${r.fiscal_period}`, r);
  }
  const rows = [...byKey.values()]
    .sort(
      (a, b) =>
        (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0) ||
        (PERIOD_ORDER[a.fiscal_period ?? ""] ?? 9) - (PERIOD_ORDER[b.fiscal_period ?? ""] ?? 9) ||
        a.statement_type.localeCompare(b.statement_type)
    )
    .slice(0, 36);

  if (rows.length === 0) {
    return (
      <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
        No statements on record for {ticker}. They appear here as filings are extracted and published.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-5 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        Each published statement with the unit it was read in and the basis it was reported on. Figures are
        echoed from the filing, never converted or estimated.
      </p>
      <Table variant="reader">
        <THead>
          <TR>
            <TH>Period</TH>
            <TH>Statement</TH>
            <TH>Units</TH>
            <TH>Basis</TH>
            <TH className="text-right">Source</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const units = typeof r.data?._units === "string" ? r.data._units : null;
            const basis = r.reporting_basis ?? (typeof r.data?._basis === "string" ? r.data._basis : null);
            const period = formatFinancialPeriod(`${r.fiscal_year ?? ""} ${r.fiscal_period ?? ""}`.trim()) ?? `${r.fiscal_year ?? ""} ${r.fiscal_period ?? ""}`;
            return (
              <TR key={`${r.statement_type}|${r.fiscal_year}|${r.fiscal_period}`}>
                <TD className="figure py-2 text-text-strong">{period}</TD>
                <TD className="py-2 text-text-muted">{STATEMENT_LABEL[r.statement_type] ?? r.statement_type.replace(/_/g, " ")}</TD>
                <TD className="py-2 text-text-muted">{units ?? "not stated"}</TD>
                <TD className="py-2 text-text-muted">{basis ?? "not stated"}</TD>
                <TD className="py-2 text-right">
                  {/* The link reads as what it is, a filing, not as the store's source token. */}
                  {r.source_url ? (
                    <a href={r.source_url} target="_blank" rel="noreferrer" className="text-text-strong hover:underline">
                      Source filing ↗
                    </a>
                  ) : (
                    <span className="text-text-faint">no link</span>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Technicals
// ---------------------------------------------------------------------------

/**
 * One sentence on where the price sits, shown outside the Price structure
 * fold so nobody has to open a chart to learn the one thing it says.
 */
export async function PriceStructureLine({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const technicals = await getTechnicals(supabase, ticker);
  return (
    <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
      {priceStructureReading({
        price: technicals.latestPrice,
        ma50: technicals.ma50,
        high52: technicals.fiftyTwoWeekHigh,
        low52: technicals.fiftyTwoWeekLow,
      })}
    </p>
  );
}

/**
 * Technicals: price structure, placed last in the Financials tab on purpose.
 *
 * The heading says it: for timing, not for forming the view. The chart is
 * here to answer "is this a reasonable moment to add", not to make the case
 * for owning the company, which is what the sections above it are for.
 */
export async function TechnicalsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const [technicals, { data: master }] = await Promise.all([
    getTechnicals(supabase, ticker),
    supabase.from("stock_master").select("sector").eq("ticker", ticker).maybeSingle(),
  ]);
  const hue = sectorColor(master?.sector);

  if (technicals.history.length === 0) {
    return (
      <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
        The exchange returned no daily history for {ticker}. That is normal for a newly listed, suspended or
        illiquid counter.
      </p>
    );
  }

  // Five years of closes, back-adjusted so a bonus or split does not draw as a
  // crash. The 60-session track in the page header is left raw on purpose: a
  // break that recent is worth seeing, and the rails it is drawn against come
  // from the same adjusted 52-week range as here.
  const usableHistory = technicals.history.filter((c) => Number.isFinite(Number(c.close)) && Number(c.close) > 0);
  const breaks = detectCorporateActionBreaks(usableHistory);
  const closes = adjustForCorporateActions(usableHistory).map((c) => Number(c.close));
  const price = technicals.latestPrice;
  const low52 = technicals.fiftyTwoWeekLow;
  const high52 = technicals.fiftyTwoWeekHigh;
  const hasRange = low52 !== null && high52 !== null && high52 > low52;
  const pos = hasRange && price !== null ? Math.min(100, Math.max(0, ((price - low52) / (high52 - low52)) * 100)) : null;

  const fmt = (v: number | null, digits = 2) => (v === null ? "—" : formatNumber(v, digits));
  const indicators: { label: string; value: string; tone?: "up" | "down" }[] = [
    { label: "20-session average", value: fmt(technicals.ma20), tone: price !== null && technicals.ma20 !== null ? (price >= technicals.ma20 ? "up" : "down") : undefined },
    { label: "50-session average", value: fmt(technicals.ma50), tone: price !== null && technicals.ma50 !== null ? (price >= technicals.ma50 ? "up" : "down") : undefined },
    { label: "100-session average", value: fmt(technicals.ma100), tone: price !== null && technicals.ma100 !== null ? (price >= technicals.ma100 ? "up" : "down") : undefined },
    { label: "200-session average", value: fmt(technicals.ma200), tone: price !== null && technicals.ma200 !== null ? (price >= technicals.ma200 ? "up" : "down") : undefined },
    { label: "RSI, 14 sessions", value: technicals.rsi === null ? "—" : technicals.rsi.toFixed(0) },
    { label: "Annualised volatility", value: technicals.volatility === null ? "—" : `${technicals.volatility.toFixed(1)}%` },
    { label: "Average volume, 30 sessions", value: technicals.averageVolume === null ? "—" : compactShares(technicals.averageVolume) },
  ];

  // Stated in words, so the reader is not left to compare four averages to a
  // price themselves. Only claims what the numbers actually support.
  const notes: string[] = [];
  if (price !== null && technicals.ma20 !== null && technicals.ma50 !== null) {
    const above = [technicals.ma20, technicals.ma50].filter((m) => price >= m).length;
    notes.push(
      above === 2 ? "Above the 20 and 50-session averages."
        : above === 0 ? "Below the 20 and 50-session averages."
          : "Between the 20 and 50-session averages."
    );
  }
  if (technicals.volume !== null && technicals.averageVolume) {
    notes.push(
      technicals.volume >= technicals.averageVolume
        ? "Volume is above its 30-session average."
        : "Volume is below its 30-session average."
    );
  }

  const W = 620, H = 240;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, closes.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * H;
  const line = `M${closes.map((c, i) => `${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(" L")}`;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="block overflow-visible" aria-hidden="true">
          <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={hue} fillOpacity="0.08" />
          <path d={line} fill="none" stroke={hue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {breaks.length > 0 && (
          <p className="mt-2 text-(length:--text-2xs) text-text-faint">Adjusted for bonus and split events</p>
        )}

        {hasRange && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between text-(length:--text-2xs) text-text-faint">
              <span className="figure">{formatNumber(low52)}</span>
              <span className="font-bold uppercase tracking-(--tracking-caps)">52-week range</span>
              <span className="figure">{formatNumber(high52)}</span>
            </div>
            <div className="relative mt-2 h-1.5 bg-surface-inset">
              <span className="absolute -top-1 bottom-[-0.25rem] w-0.5 bg-ink-1" style={{ left: `${pos}%` }} />
            </div>
          </div>
        )}

        {notes.length > 0 && (
          <p className="mt-6 max-w-(--measure) text-sm leading-relaxed text-text-muted">{notes.join(" ")}</p>
        )}
      </div>

      <div>
        <p className={SECTION_LABEL}>Indicators</p>
        {indicators.map((ind) => (
          <div key={ind.label} className="flex items-baseline justify-between gap-5 border-b border-rule py-2.5">
            <span className="text-sm text-text-muted">{ind.label}</span>
            <span className={cn("figure text-sm font-semibold", ind.tone === "up" ? "text-up" : ind.tone === "down" ? "text-down" : "text-text-strong")}>
              {ind.value}
            </span>
          </div>
        ))}
        <p className="mt-3.5 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
          A green figure means the last price sits above that average, not that the share is a buy. Averages
          describe where the price has been.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Filings
// ---------------------------------------------------------------------------

/**
 * Filings and news on one dated spine.
 *
 * The "one figure it moved" line is only drawn where it can be established from
 * our own records: a dividend announcement is matched to the payout row that
 * carries its per-share figure. A board meeting called to approve accounts is
 * known to have moved nothing yet, so it says that. Anything else says nothing,
 * because a line claiming to name the figure that moved is worthless the moment
 * it starts guessing.
 */
export async function NewsFilingsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [filings, newsRes, payoutsRes] = await Promise.all([
    getCompanyFilings(ticker, 30, { supabase }),
    supabase
      .from("news_articles")
      .select("title, url, source, published_at")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .eq("ignored", false)
      .order("published_at", { ascending: false })
      .limit(15),
    supabase
      .from("company_payouts")
      .select("dividend_per_share, kind, term, announcement_date")
      .eq("ticker", ticker)
      .limit(60),
  ]);

  const payouts = payoutsRes.data ?? [];

  /**
   * The payout this filing announced, when that can be established without
   * guessing.
   *
   * The two dates are not the same event: PSX dates the notice, while the
   * payout row carries the board's decision date, and they sit anywhere from a
   * few days to three weeks apart (Mari 11 days, OGDC 23). A tight window
   * matched almost nothing. So the nearest payout within a month wins, but only
   * if it is the only candidate in that month; two payouts in range means the
   * filing cannot be attributed to one of them, and nothing is claimed.
   */
  const WINDOW_DAYS = 32;
  function payoutNear(date: string | null) {
    if (!date) return null;
    const t = Date.parse(date);
    if (!Number.isFinite(t)) return null;
    const inRange = payouts
      .filter((p) => p.announcement_date && typeof p.dividend_per_share === "number")
      .map((p) => ({ p, gap: Math.abs(Date.parse(p.announcement_date as string) - t) / 86400000 }))
      .filter((x) => x.gap <= WINDOW_DAYS)
      .sort((a, b) => a.gap - b.gap);
    if (inRange.length !== 1) return null;
    return inRange[0].p;
  }

  const entries: SpineEntry[] = [
    ...filings.map((f) => {
      const payout = f.category === "dividend" ? payoutNear(f.date) : null;
      return {
        date: f.date,
        title: f.title,
        category: f.category,
        url: f.url,
        source: "PSX announcement",
        moved: payout
          ? `Dividend per share ${(payout.dividend_per_share as number).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${payout.term ? `, ${payout.term}` : ""}`
          : null,
        pending:
          f.category === "board_meeting" ? "Nothing filed yet. The figure arrives with the accounts." : null,
      };
    }),
    ...(newsRes.data ?? []).map((n) => ({
      date: (n.published_at as string | null)?.slice(0, 10) ?? null,
      title: n.title as string,
      category: "news",
      url: (n.url as string | null) ?? null,
      source: (n.source as string | null) ?? "Press",
      moved: null,
      pending: null,
    })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // Results, dividends, board meetings and material information from the last
  // four months: the handful of notices a holder should have seen. The full
  // spine stays a fold away, open only when there is nothing recent to show.
  const recent = recentFilings(filings);

  return (
    <div>
      <p className="eyebrow">Primary sources</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        What matters recently
      </h2>
      {recent.length === 0 ? (
        <p className="mb-7 mt-1 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No results, dividend, board meeting or material information notice in the last {RECENT_FILING_DAYS} days.
        </p>
      ) : (
        <ul className="mb-7 mt-4">
          {recent.map((f, i) => (
            <li key={`${f.date}-${i}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-4 border-b border-rule py-3 sm:grid-cols-[6.5rem_10rem_minmax(0,1fr)]">
              <span className="figure text-(length:--text-2xs) text-text-faint">{readableDate(f.date)}</span>
              <span className="text-sm font-semibold text-text-strong">{f.label}</span>
              <span className="col-span-2 min-w-0 sm:col-span-1">
                <span className="block text-sm text-text-muted">{f.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-3 text-(length:--text-2xs) text-text-faint">
                  <span>PSX filing</span>
                  {f.url && (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo transition-colors hover:underline">
                      Read the notice ↗
                    </a>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <MoreDetail title="Complete record" defaultOpen={recent.length === 0}>
        <p className="mb-7 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          Everything filed or reported, newest first. Where an entry moved a figure we hold, it names it, so an
          accounting event reads differently from an announcement that changed nothing.
        </p>
        {entries.length === 0 ? (
          <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
            No filings or coverage on file for {ticker}. Announcements appear here as the exchange publishes them.
          </p>
        ) : (
          <FilingsSpine entries={entries} />
        )}
      </MoreDetail>
    </div>
  );
}
