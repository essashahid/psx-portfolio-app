import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { computeSignals, findSwings, detectSupportResistanceZones, toCanonicalOHLCV } from "@/lib/market/technicals";
import { getCompanyFilings } from "@/lib/company/filings";
import { getFundamentals } from "@/lib/company/fundamentals";
import { sectorColor } from "@/lib/shared/sector-colors";
import { computeRatios, type RatioRow } from "@/lib/engine/ratios";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionButton } from "@/components/ui/action-button";
import { TechnicalWorkstation } from "@/components/features/technicals/workstation";
import { FundamentalsGrid } from "@/components/features/stocks/fundamentals-grid";
import { FilingsSpine, type SpineEntry } from "@/components/features/stocks/filings-spine";
import type { FinancialWorkspaceRow } from "@/components/features/stocks/financials-workspace";
import { EarningsWorkspace } from "@/components/features/stocks/earnings-workspace";
import { formatNumber, formatFinancialPeriod } from "@/lib/shared/format";
import {
  FileText, TrendingUp,
} from "lucide-react";

function shortDescription(description: string | null): string | null {
  if (!description) return null;
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 300) return cleaned;
  // Prefer a clean sentence boundary (as close to the limit as possible); otherwise truncate on a word boundary
  const firstSentence = cleaned.match(/^.{40,300}[.!?](?=\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length < cleaned.length) {
    return `${firstSentence}…`;
  }
  if (firstSentence) return firstSentence;
  const slice = cleaned.slice(0, 290);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 80 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

function isOfficialPsxProfileSource(source: string | null | undefined): boolean {
  return source === "psx-company-page" || source === "psx-portal";
}

function ratioByName(rows: RatioRow[], name: string): RatioRow | null {
  return rows.find((r) => r.ratio_name === name) ?? null;
}

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------

export async function OverviewPanel({
  ticker,
}: {
  ticker: string;
  companyEnrichmentEnabled?: boolean;
  readOnly?: boolean;
}) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [metadata, technicals, ratios, fundamentals] = await Promise.all([
    getCompanyMetadata(supabase, ticker),
    getTechnicals(supabase, ticker),
    computeRatios(supabase, ticker),
    getFundamentals(supabase, ticker),
  ]);

  // Only the official PSX profile is quoted as the business description. An
  // inferred summary would read as fact in the one place on the page that is
  // prose rather than a figure.
  const officialDescription = isOfficialPsxProfileSource(metadata.meta.source) ? metadata.description : null;
  const summary = shortDescription(officialDescription);

  const peRow = ratioByName(ratios, "P/E");
  const pe = peRow?.ratio_value ?? null;
  const divYield = ratioByName(ratios, "Dividend yield (TTM)")?.ratio_value ?? null;
  const sectorPe = fundamentals.sectorPe;

  const price = technicals.latestPrice ?? null;
  const high52 = technicals.fiftyTwoWeekHigh ?? null;
  const fromHigh = price !== null && high52 ? ((price - high52) / high52) * 100 : null;

  const closes = (technicals.history ?? []).map((c) => Number(c.close)).filter((c) => Number.isFinite(c) && c > 0);
  const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

  const signals: { label: string; sub: string; value: string }[] = [];

  signals.push({
    label: "Valuation against the sector",
    sub: peRow?.source_period ? `P/E, ${formatFinancialPeriod(peRow.source_period)}` : "P/E",
    value:
      pe === null
        ? // The engine withholds a multiple on a loss and says why; that reason
          // belongs here rather than a bare dash.
            peRow?.missing?.startsWith("Loss-making")
            ? "No multiple — loss-making period"
            : "Not enough filed data"
        : sectorPe.median !== null
          ? `${pe.toFixed(1)}x against ${sectorPe.median.toFixed(1)}x`
          : `${pe.toFixed(1)}x · only ${sectorPe.contributors} peer${sectorPe.contributors === 1 ? "" : "s"} priced`,
  });

  signals.push({
    label: "Distance from the 52-week high",
    sub: high52 !== null ? `high ${formatNumber(high52)}` : "no 52-week high on file",
    value: fromHigh === null ? "—" : `${fromHigh >= 0 ? "+" : "−"}${Math.abs(fromHigh).toFixed(1)}%`,
  });

  signals.push({
    label: "Momentum",
    sub: ma50 !== null ? `50-session ${formatNumber(ma50)}` : "fewer than 50 sessions on file",
    value:
      ma50 === null || price === null
        ? "Not enough sessions"
        : price >= ma50
          ? "Above the 50-session average"
          : "Below the 50-session average",
  });

  signals.push({
    label: "Payout",
    sub: "trailing twelve months",
    value: divYield === null ? "No verified dividend per share" : `${divYield.toFixed(2)}% on the current price`,
  });

  return (
    <div>
      <p className="eyebrow">The business</p>
      <p className="mt-3 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        {summary ??
          `No description on file. PSX company data carries no business summary for ${ticker} yet, so nothing is shown rather than inferred.`}
      </p>

      <div className="mt-8">
        <p className="border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
          Key signals
        </p>
        {signals.map((s) => (
          <div key={s.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-5 border-b border-rule py-3">
            <span>
              <span className="block text-sm text-text-strong">{s.label}</span>
              <span className="figure mt-0.5 block text-(length:--text-2xs) text-text-faint">{s.sub}</span>
            </span>
            <span className="figure text-right text-sm font-semibold text-text-strong">{s.value}</span>
          </div>
        ))}
      </div>
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
 * The old statement browser is gone. The design asks for a reading of how the
 * business earns, against its own history and its sector, rather than a table
 * of every line item ever extracted.
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
              ? `Last fetch attempt: ${String(lastLog.created_at).slice(0, 16).replace("T", " ")} via ${lastLog.source} — ${lastLog.status}${lastLog.detail ? ` (${lastLog.detail})` : ""}. The engine reads the official PSX company page; numbers are echoed from PSX, never invented.`
              : `No data has been loaded for ${ticker} yet. The engine reads the official PSX company page (sales, EPS, margins) — numbers are echoed from PSX, never invented.`
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
      <p className="eyebrow">Filed years</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        How the business earns
      </h2>
      <p className="mt-1 mb-7 max-w-(--measure) text-sm leading-relaxed text-text-muted">
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

export async function EarningsPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();
  const [filings, { data: finData }] = await Promise.all([
    getCompanyFilings(ticker, 120),
    supabase
      .from("company_financials")
      .select("period_type, fiscal_year, fiscal_period, statement_type, data, reported_date, source_type, source_url, reporting_basis, review_status")
      .eq("ticker", ticker)
      .eq("statement_type", "income_statement")
      .eq("review_status", "published")
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

  const swings = findSwings(technicals.history);
  const zones = detectSupportResistanceZones(technicals.history, swings, signals.lastClose ?? 0);
  const ohlcvData = toCanonicalOHLCV(ticker, technicals.history);

  return (
    <TechnicalWorkstation
      ticker={ticker}
      ohlcvData={ohlcvData}
      signals={signals}
      supportResistanceZones={zones}
      changePct={technicals.dayChangePct}
      volatility={technicals.volatility}
    />
  );
}

// ---------------------------------------------------------------------------
// 6. Dividends
// ---------------------------------------------------------------------------

/**
 * Dividends: what the company declared.
 *
 * Reads the announcement feed, not the user's own dividend receipts — the
 * design is explicit that this is the company's record and that what you were
 * actually paid is reconciled on the Dividends page. The two disagree often
 * enough (timing, withholding, partial holdings) that showing receipts here
 * would quietly answer a different question than the one asked.
 *
 * PSX publishes a book-closure window rather than an ex-date, and no pay date
 * at all, so those columns say what they are instead of borrowing the names of
 * fields we do not have.
 */
export async function DividendsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("company_payouts")
    .select("kind, term, percentage, dividend_per_share, announcement_date, book_closure_start, book_closure_end")
    .eq("ticker", ticker)
    .order("announcement_date", { ascending: false })
    .limit(40);
  const rows = data ?? [];

  return (
    <div>
      <p className="eyebrow">Announced payouts</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        What the company declared
      </h2>

      {rows.length === 0 ? (
        <p className="mt-6 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No payout announcements on file for {ticker}. They appear here as the exchange publishes them.
        </p>
      ) : (
        <>
          <div className="mt-7 overflow-x-auto">
            <div className="min-w-[38rem]">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)_9rem_7rem_6rem] gap-4 border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
                <span>Announced</span>
                <span>Kind</span>
                <span>Book closure</span>
                <span className="text-right">Per share</span>
                <span className="text-right">Of face</span>
              </div>
              {rows.map((r, i) => (
                <div
                  key={`${r.announcement_date}-${i}`}
                  className="grid grid-cols-[7rem_minmax(0,1fr)_9rem_7rem_6rem] items-baseline gap-4 border-b border-rule py-3"
                >
                  <span className="figure text-sm text-text-strong">{r.announcement_date ?? "—"}</span>
                  <span className="text-sm text-text-muted">
                    {[r.term, r.kind].filter(Boolean).join(" ") || "cash"}
                  </span>
                  <span className="figure text-sm text-text-muted">
                    {r.book_closure_start
                      ? r.book_closure_end && r.book_closure_end !== r.book_closure_start
                        ? `${r.book_closure_start} to ${r.book_closure_end}`
                        : r.book_closure_start
                      : "—"}
                  </span>
                  <span className="figure text-right text-sm font-semibold text-text-strong">
                    {typeof r.dividend_per_share === "number" ? formatNumber(r.dividend_per_share) : "—"}
                  </span>
                  <span className="figure text-right text-sm text-text-muted">
                    {typeof r.percentage === "number" ? `${formatNumber(r.percentage, 0)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-5 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
            Company announcements, not your receipts. Dividends you were actually paid are reconciled on the
            Dividends page. PSX publishes a book-closure window rather than an ex-date, and does not publish a
            pay date.
          </p>
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// 7. News & Filings
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
    getCompanyFilings(ticker, 30),
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
   * few days to three weeks apart — Mari 11 days, OGDC 23. A tight window
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
          ? `Dividend per share ${(payout.dividend_per_share as number).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${payout.term ? ` · ${payout.term}` : ""}`
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

  return (
    <div>
      <p className="eyebrow">Primary sources</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        Everything filed or reported
      </h2>
      <p className="mb-7 mt-1 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        In date order, newest first. Where an entry moved a figure we hold, it names it, so an accounting event
        reads differently from an announcement that changed nothing.
      </p>

      {entries.length === 0 ? (
        <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No filings or coverage on file for {ticker}. Announcements appear here as the exchange publishes them.
        </p>
      ) : (
        <FilingsSpine entries={entries} />
      )}
    </div>
  );
}
