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
import { SectorChip } from "@/components/sector-chip";
import { ActionButton } from "@/components/action-button";
import { WatchlistButton } from "@/components/stock/watchlist-button";
import { CompanyAiActions } from "@/components/stock/company-ai-actions";
import { Markdown } from "@/components/markdown";
import { RatioSnapshotChart } from "@/components/charts-lazy";
import { StockPriceChart } from "@/components/stock/price-chart-lazy";
import { formatMoney, formatNumber, formatSignedPct, cn } from "@/lib/utils";
import {
  FileText, Sparkles, TrendingUp, Banknote, Calculator, Building2, Info,
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

  const [metadata, technicals, dividends, portfolio] = await Promise.all([
    getCompanyMetadata(supabase, ticker),
    getTechnicals(supabase, ticker),
    getCompanyDividends(supabase, user.id, ticker),
    getPortfolio(supabase, user.id),
  ]);
  const holding = portfolio.holdings.find((h) => h.ticker === ticker);
  const latestDiv = dividends[0];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Business overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {metadata.description ? (
              <p className="text-sm leading-relaxed">{metadata.description}</p>
            ) : companyEnrichmentEnabled ? (
              <div className="space-y-2">
                <Unavailable note="No company profile on file yet. Generate one from public knowledge (AI, cited as such)." />
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
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {metadata.sector && <SectorChip sector={metadata.sector} />}
              {metadata.industry && <Badge variant="outline">{metadata.industry}</Badge>}
              <Badge variant="secondary">PSX</Badge>
            </div>
            {metadata.businessLines.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Key business lines</p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {metadata.businessLines.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            )}
            <SectionMeta
              meta={metadata.meta}
              ticker={ticker}
              refreshSection={companyEnrichmentEnabled ? "description" : undefined}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Key snapshot</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              <Metric label="Price" value={num(technicals.latestPrice)} sub={technicals.asOfDate ? `as of ${technicals.asOfDate}` : undefined} />
              <Metric label="Day change" value={technicals.dayChangePct !== null ? formatSignedPct(technicals.dayChangePct) : "—"} tone={technicals.dayChangePct ? (technicals.dayChangePct > 0 ? "positive" : "negative") : undefined} />
              <Metric label="52-wk high" value={num(technicals.fiftyTwoWeekHigh)} />
              <Metric label="52-wk low" value={num(technicals.fiftyTwoWeekLow)} />
              <Metric label="50-day MA" value={num(technicals.ma50)} />
              <Metric label="200-day MA" value={num(technicals.ma200)} />
              <Metric label="RSI (14)" value={technicals.rsi !== null ? technicals.rsi.toFixed(0) : "—"} />
              <Metric label="Volatility" value={technicals.volatility !== null ? `${technicals.volatility.toFixed(1)}%` : "—"} sub="annualized" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Your position</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {holding ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric label="Quantity" value={formatNumber(holding.quantity, 0)} />
                  <Metric label="Avg cost" value={num(holding.avg_cost)} />
                  <Metric label="Market value" value={holding.market_value !== null ? formatMoney(holding.market_value) : "—"} />
                  <Metric label="Unrealized P/L" value={holding.unrealized_pl !== null ? formatMoney(holding.unrealized_pl) : "—"} tone={holding.unrealized_pl ? (holding.unrealized_pl > 0 ? "positive" : "negative") : undefined} />
                  <Metric label="Portfolio weight" value={holding.weight !== null ? `${holding.weight.toFixed(1)}%` : "—"} />
                  <Metric label="Dividends received" value={formatMoney(holding.dividend_income)} />
                </div>
                <Badge variant="green">In your portfolio</Badge>
              </>
            ) : (
              <div className="space-y-3 py-2">
                <p className="text-sm text-muted-foreground">Not currently held.</p>
                {!readOnly && <WatchlistButton ticker={ticker} initialWatched={false} />}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Latest dividend</CardTitle></CardHeader>
          <CardContent>
            {latestDiv ? (
              <div className="space-y-1 text-xs">
                <p><span className="font-semibold">{latestDiv.kind}</span> · {latestDiv.perShare !== null ? `${formatNumber(latestDiv.perShare)}/share` : "amount n/a"}</p>
                <p className="text-muted-foreground">Announced {latestDiv.announcementDate ?? "—"} · Ex {latestDiv.exDate ?? "—"} · Pay {latestDiv.payDate ?? "—"}</p>
              </div>
            ) : (
              <p className="py-2 text-xs text-muted-foreground">No dividends recorded for {ticker} yet.</p>
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

const LINE_LABELS: Record<string, string> = {
  revenue: "Revenue / sales", cost_of_sales: "Cost of sales", gross_profit: "Gross profit",
  operating_expenses: "Operating expenses", operating_profit: "Operating profit", finance_cost: "Finance cost",
  profit_before_tax: "Profit before tax", tax: "Tax", profit_after_tax: "Profit after tax", eps: "EPS (Rs)",
  total_assets: "Total assets", current_assets: "Current assets", cash_and_equivalents: "Cash & equivalents",
  inventory: "Inventory", receivables: "Receivables", total_liabilities: "Total liabilities",
  current_liabilities: "Current liabilities", borrowings: "Borrowings", equity: "Equity", retained_earnings: "Retained earnings",
  operating_cash_flow: "Operating cash flow", investing_cash_flow: "Investing cash flow",
  financing_cash_flow: "Financing cash flow", capex: "Capex", cash_balance: "Cash balance",
};

function FetchFinancialsButton({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  if (readOnly) return null;
  return (
    <ActionButton
      endpoint={`/api/stocks/${ticker}/refresh`}
      body={{ section: "financials" }}
      label={<><FileText className="h-3.5 w-3.5" /> Load from PSX company page</>}
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

  // Rank a period by how far through its fiscal year it runs, so the most
  // recent reporting period sorts first regardless of label (FY, 9M, H1, Q*).
  const PERIOD_END: Record<string, number> = { Q1: 1, Q2: 2, H1: 2, Q3: 3, "9M": 3, Q4: 4, FY: 4 };
  const periodRank = (p: FinancialRow) =>
    (p.fiscal_year ?? 0) * 10 + (PERIOD_END[(p.fiscal_period ?? "").toUpperCase()] ?? 0);

  // Annual periods compared year-over-year; interim periods kept separate so we
  // never put a full year next to a single quarter in the same row.
  const annualOf = (type: string) =>
    rows
      .filter((r) => r.statement_type === type && r.period_type === "annual")
      .sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0))
      .slice(0, 5);
  const interimOf = (type: string) =>
    rows
      .filter((r) => r.statement_type === type && r.period_type !== "annual")
      .sort((a, b) => periodRank(b) - periodRank(a))
      .slice(0, 5);

  const newest = [...rows].sort((a, b) =>
    String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
  )[0];
  const units = String(newest?.data?._units ?? "as reported");
  const hasUnreviewed = rows.some((r) => r.confidence !== null && r.confidence < 0.7);

  const periodTable = (periods: FinancialRow[], label: string) => {
    if (periods.length === 0) return null;
    const keys = [...new Set(periods.flatMap((p) => Object.keys(p.data ?? {})))].filter((k) => !k.startsWith("_"));
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Line item</TH>
                {periods.map((p, i) => (
                  <TH key={i} className="text-right">
                    {p.fiscal_year ?? ""} {p.fiscal_period ?? ""}
                    {p.confidence !== null && p.confidence < 0.7 && <span className="text-amber-500"> *</span>}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {keys.map((k) => (
                <TR key={k}>
                  <TD className="text-xs">{LINE_LABELS[k] ?? k.replace(/_/g, " ")}</TD>
                  {periods.map((p, i) => {
                    const v = p.data?.[k];
                    return <TD key={i} className="text-right text-xs tabular-nums">{typeof v === "number" ? num(v) : "—"}</TD>;
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Figures {units}; EPS in rupees. Sourced from the official PSX company page — open the source to verify.
        </p>
        <FetchFinancialsButton ticker={ticker} readOnly={readOnly} />
      </div>
      {["income_statement", "balance_sheet", "cash_flow"].map((type) => {
        const annual = annualOf(type);
        const interim = interimOf(type);
        if (annual.length === 0 && interim.length === 0) return null;
        const sourceUrl = (annual[0] ?? interim[0])?.source_url ?? null;
        return (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="capitalize">{type.replace(/_/g, " ")}</CardTitle>
              <CardDescription>
                Annual history and recent interim periods.
                {sourceUrl && (
                  <>
                    {" "}
                    <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                      View source on PSX
                    </a>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {periodTable(annual, "Annual")}
              {periodTable(interim, "Interim / quarterly")}
            </CardContent>
          </Card>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        Last loaded {newest?.updated_at ? String(newest.updated_at).slice(0, 10) : "—"} · Source: official PSX company page (figures echoed from PSX)
        {hasUnreviewed && <> · <span className="text-amber-500">*</span> needs review</>}
      </p>
    </div>
  );
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
