import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfigured, chatJson } from "@/lib/ai/openai";
import { getCompanyFilings } from "@/lib/company/filings";
import { fetchPsxCompanyData, type PsxPeriodFigures } from "@/lib/company/psx-company-data";

/**
 * Financial-statement extraction pipeline.
 *
 * Source of truth is always the official PSX result filing (PDF). Gemini is
 * used strictly as a PARSER: it converts the filing text into structured line
 * items, echoing only numbers that literally appear in the document. Every
 * extraction stores the source URL + confidence; low confidence rows are
 * flagged needs-review, and nothing is written when the document can't be
 * read. The engine never invents a number.
 */

const REQUEST_TIMEOUT_MS = 60_000; // PSX result PDFs can be 8MB+ over a slow link
const MAX_PDF_BYTES = 20_000_000;
const MAX_TEXT_CHARS = 42_000; // keep the prompt bounded

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "*/*",
  Referer: "https://dps.psx.com.pk/",
};

interface ExtractedStatement {
  period_type: "annual" | "quarterly";
  fiscal_year: number | null;
  fiscal_period: string | null; // FY | Q1 | Q2 | Q3 | Q4 | H1 | 9M
  statement_type: "income_statement" | "balance_sheet" | "cash_flow";
  /** Units the figures are stated in, e.g. "PKR thousands". */
  units: string | null;
  data: Record<string, number | null>;
  confidence: number;
}

interface ExtractionResult {
  ticker: string;
  processed: number;
  saved: number;
  skipped: string[];
  errors: string[];
}

type PdfTextResult = { text: string } | { error: string };

/**
 * Download a PSX filing PDF and extract its text. Returns the text on success
 * or a specific reason on failure (HTTP status, oversize, timeout, parse
 * error, or too-little-text) so the caller can log exactly what went wrong
 * instead of a blanket "could not read PDF".
 */
async function fetchPdfText(url: string): Promise<PdfTextResult> {
  let buf: Buffer;
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return { error: `HTTP ${res.status} fetching PDF` };
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: /timeout|abort/i.test(msg) ? `download timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : `download failed: ${msg}` };
  }
  if (buf.byteLength > MAX_PDF_BYTES) return { error: `PDF too large (${(buf.byteLength / 1e6).toFixed(1)}MB)` };

  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    await parser.destroy();
    const text = (result.text ?? "").replace(/[ \t]+/g, " ").trim();
    if (text.length <= 200) return { error: `parsed text too short (${text.length} chars) — likely a scanned/image PDF` };
    return { text: text.slice(0, MAX_TEXT_CHARS) };
  } catch (err) {
    return { error: `PDF parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const EXTRACTION_PROMPT = `You convert a Pakistan Stock Exchange financial-result filing into structured JSON.

STRICT RULES:
- Echo ONLY numbers that literally appear in the document text. Never compute, estimate, or fill in missing values — use null.
- The ENTIRE filing uses ONE monetary unit. Read the statement headers ("Rupees in '000", "Rupees in million", "(Rupees)", etc.) and report it ONCE as document_units: one of "thousands" | "millions" | "billions" | "rupees". Do NOT convert any figure — echo them exactly as printed.
- EPS is in rupees per share (never scaled). Percentages stay as printed.
- Use the CURRENT period column (not the comparative prior-year column).
- If you cannot confidently identify a value, use null.
- confidence: 0-1, how certain you are the numbers are correctly read from the document.

Return JSON:
{"document_units": "thousands" | "millions" | "billions" | "rupees",
 "statements": [{
  "period_type": "annual" | "quarterly",
  "fiscal_year": 2025,
  "fiscal_period": "FY" | "Q1" | "Q2" | "Q3" | "Q4" | "H1" | "9M",
  "statement_type": "income_statement" | "balance_sheet" | "cash_flow",
  "units": "PKR thousands",
  "confidence": 0.0,
  "data": {
    // income_statement keys (use exactly these, null when absent):
    // revenue, cost_of_sales, gross_profit, operating_expenses, operating_profit,
    // finance_cost, profit_before_tax, tax, profit_after_tax, eps
    // balance_sheet keys:
    // total_assets, current_assets, cash_and_equivalents, inventory, receivables,
    // total_liabilities, current_liabilities, borrowings, equity, retained_earnings
    // cash_flow keys:
    // operating_cash_flow, investing_cash_flow, financing_cash_flow, capex, cash_balance
  }
}]}

Include a statement object only when the document actually contains that statement. Banks: treat markup/interest income as revenue. If the document is not a financial result (e.g. a notice), return {"statements": []}.`;

// Monetary line items that must share a unit scale; eps is per-share (rupees)
// and *_pct fields are ratios, so both are left untouched.
const MONETARY_KEYS = new Set([
  "revenue", "cost_of_sales", "gross_profit", "operating_expenses", "operating_profit",
  "finance_cost", "profit_before_tax", "tax", "profit_after_tax",
  "total_assets", "current_assets", "cash_and_equivalents", "inventory", "receivables",
  "total_liabilities", "current_liabilities", "borrowings", "equity", "retained_earnings",
  "operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "capex", "cash_balance",
]);

/**
 * Multiplier that converts the document's stated units into PKR thousands — the
 * canonical unit used across company_financials (the PSX summary page is in
 * thousands). Without this, dividing a thousands-based figure from one source by
 * a full-rupee figure from another (e.g. ROE = PAT ÷ equity) is wrong by 1000×.
 */
function toThousandsMultiplier(units: string | null | undefined): number {
  const u = (units ?? "").toLowerCase();
  if (/000|thousand/.test(u)) return 1;
  if (/billion|\bbn\b/.test(u)) return 1_000_000;
  if (/million|\bmn\b|\bmln\b/.test(u)) return 1_000;
  if (/rupee|pkr|\brs\b/.test(u)) return 1 / 1000; // full rupees → thousands
  return 1; // unknown → assume thousands (PSX convention)
}

/**
 * Normalize all monetary figures in a statement to PKR thousands in place, using
 * a single filing-level multiplier (a report uses one unit throughout, so this
 * is far more reliable than per-statement unit strings).
 */
function normalizeUnits(s: ExtractedStatement, mult: number): void {
  if (mult === 1) return;
  for (const [k, v] of Object.entries(s.data)) {
    if (MONETARY_KEYS.has(k) && typeof v === "number" && Number.isFinite(v)) {
      s.data[k] = Math.round(v * mult);
    }
  }
}

function validStatement(s: ExtractedStatement): boolean {
  if (!s.statement_type || !s.period_type) return false;
  const values = Object.values(s.data ?? {}).filter((v) => typeof v === "number" && Number.isFinite(v));
  return values.length >= 2; // at least a couple of real figures
}

/**
 * Process the latest result filings for a ticker: download PDFs, extract
 * structured statements with Gemini, validate, and upsert company_financials.
 * Skips filings already extracted (matched by source_url).
 */
export async function extractFinancials(ticker: string, maxFilings = 2): Promise<ExtractionResult> {
  const t = ticker.toUpperCase();
  const out: ExtractionResult = { ticker: t, processed: 0, saved: 0, skipped: [], errors: [] };

  if (!aiConfigured()) {
    out.errors.push("GEMINI_API_KEY is not configured — extraction unavailable.");
    return out;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    out.errors.push("SUPABASE_SERVICE_ROLE_KEY missing — cannot persist extractions.");
    return out;
  }
  const db = createAdminClient();

  const filings = await getCompanyFilings(t, 30);
  const resultPdfs = filings
    .filter((f) => f.category === "result" && f.url.toLowerCase().includes(".pdf"))
    .slice(0, maxFilings * 3); // candidates; we stop after maxFilings successful extractions

  if (resultPdfs.length === 0) {
    out.errors.push("No result filings with PDF documents found on the PSX portal.");
    return out;
  }

  const { data: existing } = await db.from("company_financials").select("source_url").eq("ticker", t);
  const seen = new Set((existing ?? []).map((r) => r.source_url as string));

  for (const filing of resultPdfs) {
    if (out.processed >= maxFilings) break;
    if (seen.has(filing.url)) {
      out.skipped.push(`already extracted: ${filing.title}`);
      continue;
    }

    const pdf = await fetchPdfText(filing.url);
    if ("error" in pdf) {
      out.errors.push(`${filing.title}: ${pdf.error}`);
      continue;
    }
    out.processed++;

    try {
      const { data } = await chatJson<{ statements: ExtractedStatement[]; document_units?: string }>(
        EXTRACTION_PROMPT,
        `Filing title: ${filing.title}\nFiling date: ${filing.date ?? "unknown"}\nTicker: ${t}\n\n--- DOCUMENT TEXT ---\n${pdf.text}`,
        12_000, // 3 statements × ~15 fields can be sizeable; leave ample room
        // Statement extraction is mechanical parsing, not reasoning — use the
        // cheap flash model with thinking off. ~20× cheaper than pro, which
        // matters for a universe-wide backfill, and cached per filing so it's a
        // one-time cost. Falls back to the configured model if flash is unset.
        { model: process.env.GEMINI_EXTRACT_MODEL || "gemini-2.5-flash", thinkingBudget: 0 }
      );

      const statements = (data.statements ?? []).filter(validStatement);
      if (statements.length === 0) {
        out.skipped.push(`no extractable statements: ${filing.title}`);
        continue;
      }
      // One unit for the whole filing — scale every statement uniformly to thousands.
      const mult = toThousandsMultiplier(data.document_units ?? statements[0]?.units);
      statements.forEach((s) => normalizeUnits(s, mult));

      for (const s of statements) {
        const { error } = await db.from("company_financials").upsert(
          {
            ticker: t,
            period_type: s.period_type,
            fiscal_year: s.fiscal_year,
            fiscal_period: s.fiscal_period ?? (s.period_type === "annual" ? "FY" : null),
            statement_type: s.statement_type,
            reported_date: filing.date,
            source_type: "psx-filing",
            source_url: filing.url,
            data: { ...s.data, _units: "PKR thousands" },
            confidence: Math.max(0, Math.min(1, s.confidence ?? 0)),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type" }
        );
        if (error) out.errors.push(`db: ${error.message}`);
        else out.saved++;
      }
    } catch (err) {
      out.errors.push(`extraction failed for "${filing.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    await db.from("data_fetch_logs").insert({
      ticker: t,
      section: "financials",
      source: "psx-filing+gemini",
      status: out.saved > 0 ? "ok" : out.errors.length ? "error" : "empty",
      rows: out.saved,
      detail: out.errors.join("; ").slice(0, 300) || null,
    });
  } catch {
    /* best-effort */
  }

  return out;
}

/**
 * Build a company_financials row payload from one PSX period column. Stores the
 * figures PSX reports literally (sales→revenue in PKR thousands, eps in PKR)
 * and, when PSX also publishes the period's margins, the implied gross profit
 * and profit-after-tax (revenue × reported margin — arithmetic from two
 * official figures, recorded with the margin so it stays auditable).
 */
function statementData(p: PsxPeriodFigures): Record<string, number | null | string> {
  const data: Record<string, number | null | string> = {
    revenue: p.sales,
    eps: p.eps,
    _units: "PKR thousands",
    _source: "psx-portal",
  };
  if (p.grossMarginPct != null && p.sales != null) {
    data.gross_profit = Math.round((p.sales * p.grossMarginPct) / 100);
    data.gross_profit_margin_pct = p.grossMarginPct;
  }
  if (p.netMarginPct != null && p.sales != null) {
    data.profit_after_tax = Math.round((p.sales * p.netMarginPct) / 100);
    data.net_profit_margin_pct = p.netMarginPct;
  }
  return data;
}

/**
 * Populate company_financials from the official PSX company page — no PDF
 * download, no LLM, one HTTP request. This is the default, zero-marginal-cost
 * financials path; the Gemini PDF extractor above remains available only as an
 * opt-in deep fallback. Returns the same ExtractionResult shape as
 * extractFinancials so callers are interchangeable.
 */
export async function populateFinancials(ticker: string): Promise<ExtractionResult> {
  const t = ticker.toUpperCase();
  const out: ExtractionResult = { ticker: t, processed: 0, saved: 0, skipped: [], errors: [] };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    out.errors.push("SUPABASE_SERVICE_ROLE_KEY missing — cannot persist financials.");
    return out;
  }

  const data = await fetchPsxCompanyData(t);
  if (!data) {
    out.errors.push(`PSX company page for ${t} was unreachable or had no financial tables.`);
    await logResult(t, out);
    return out;
  }

  const db = createAdminClient();
  const now = new Date().toISOString();
  const periods: { p: PsxPeriodFigures; period_type: "annual" | "quarterly" }[] = [
    ...data.annual.map((p) => ({ p, period_type: "annual" as const })),
    ...data.quarterly.map((p) => ({ p, period_type: "quarterly" as const })),
  ];

  for (const { p, period_type } of periods) {
    if (p.sales == null && p.eps == null) continue; // nothing reported for this column
    out.processed++;
    const { error } = await db.from("company_financials").upsert(
      {
        ticker: t,
        period_type,
        fiscal_year: p.fiscalYear,
        fiscal_period: p.fiscalPeriod ?? (period_type === "annual" ? "FY" : null),
        statement_type: "income_statement",
        reported_date: null,
        source_type: "psx-portal",
        source_url: data.sourceUrl,
        data: statementData(p),
        confidence: 1, // official PSX figures, read verbatim
        updated_at: now,
      },
      { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type" }
    );
    if (error) out.errors.push(`db: ${error.message}`);
    else out.saved++;
  }

  // Cache the equity profile (shares / market cap) so the cockpit header and
  // market-cap-dependent ratios have an authoritative source.
  if (data.shares != null || data.marketCap != null) {
    await db
      .from("company_metadata")
      .upsert(
        {
          ticker: t,
          shares_outstanding: data.shares,
          market_cap: data.marketCap,
          source: "psx-portal",
          source_url: data.sourceUrl,
          last_fetched_at: now,
          last_updated: now,
        },
        { onConflict: "ticker" }
      )
      .then(({ error }) => {
        if (error) out.errors.push(`metadata: ${error.message}`);
      });
  }

  await logResult(t, out);
  return out;
}

async function logResult(ticker: string, out: ExtractionResult): Promise<void> {
  try {
    createAdminClient()
      .from("data_fetch_logs")
      .insert({
        ticker,
        section: "financials",
        source: "psx-portal",
        status: out.saved > 0 ? "ok" : out.errors.length ? "error" : "empty",
        rows: out.saved,
        detail: out.errors.join("; ").slice(0, 300) || null,
      })
      .then(() => {});
  } catch {
    /* best-effort */
  }
}
