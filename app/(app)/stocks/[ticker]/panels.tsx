import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { computeSignals, findSwings, detectSupportResistanceZones, toCanonicalOHLCV } from "@/lib/market/technicals";
import { getCompanyDividends } from "@/lib/company/dividends";
import { getCompanyFilings } from "@/lib/company/filings";
import { getFundamentals } from "@/lib/company/fundamentals";
import { sectorColor } from "@/lib/shared/sector-colors";
import { computeRatios, type RatioRow } from "@/lib/engine/ratios";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionButton } from "@/components/ui/action-button";
import { TechnicalWorkstation } from "@/components/features/technicals/workstation";
import { FundamentalsGrid } from "@/components/features/stocks/fundamentals-grid";
import type { FinancialWorkspaceRow } from "@/components/features/stocks/financials-workspace";
import { EarningsWorkspace } from "@/components/features/stocks/earnings-workspace";
import { formatNumber, formatFinancialPeriod } from "@/lib/shared/format";
import {
  Banknote, FileText, TrendingUp,
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
