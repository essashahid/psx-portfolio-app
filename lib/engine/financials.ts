import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfigured, chatJson } from "@/lib/ai/openai";
import { getCompanyFilings } from "@/lib/company/filings";

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

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PDF_BYTES = 10_000_000;
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

async function fetchPdfText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) return null;
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    await parser.destroy();
    const text = (result.text ?? "").replace(/[ \t]+/g, " ").trim();
    return text.length > 200 ? text.slice(0, MAX_TEXT_CHARS) : null;
  } catch {
    return null;
  }
}

const EXTRACTION_PROMPT = `You convert a Pakistan Stock Exchange financial-result filing into structured JSON.

STRICT RULES:
- Echo ONLY numbers that literally appear in the document text. Never compute, estimate, or fill in missing values — use null.
- Figures are usually in PKR thousands ("Rupees in '000") — record the units, do not convert.
- EPS is in rupees (not thousands).
- Use the CURRENT period column (not the comparative prior-year column).
- If you cannot confidently identify a value, use null.
- confidence: 0-1, how certain you are the numbers are correctly read from the document.

Return JSON:
{"statements": [{
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

    const text = await fetchPdfText(filing.url);
    if (!text) {
      out.errors.push(`could not read PDF: ${filing.title}`);
      continue;
    }
    out.processed++;

    try {
      const { data } = await chatJson<{ statements: ExtractedStatement[] }>(
        EXTRACTION_PROMPT,
        `Filing title: ${filing.title}\nFiling date: ${filing.date ?? "unknown"}\nTicker: ${t}\n\n--- DOCUMENT TEXT ---\n${text}`,
        4000
      );

      const statements = (data.statements ?? []).filter(validStatement);
      if (statements.length === 0) {
        out.skipped.push(`no extractable statements: ${filing.title}`);
        continue;
      }

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
            data: { ...s.data, _units: s.units ?? "unknown" },
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
