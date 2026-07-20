import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiAvailable, chatJson } from "@/lib/ai/openai";
import { visionConfigured, visionDisabled, visionPdf } from "@/lib/ai/vision";
import { splitPdfPages } from "@/lib/engine/pdf-chunks";
import { getCompanyFilings } from "@/lib/company/filings";
import { fetchPsxCompanyData, type PsxPeriodFigures } from "@/lib/company/psx-company-data";

/**
 * Financial-statement extraction pipeline.
 *
 * Source of truth is always the official PSX result filing (PDF). The LLM
 * is used strictly as a PARSER: it converts the filing text into structured
 * line items, echoing only numbers that literally appear in the document.
 * Every extraction stores the source URL + confidence; low confidence rows
 * are flagged needs-review, and nothing is written when the document can't
 * be read. The engine never invents a number.
 */

const REQUEST_TIMEOUT_MS = 60_000; // PSX result PDFs can be 8MB+ over a slow link
// Full annual reports (which carry the balance sheet + cash flow we most need)
// routinely run 25-30MB; keep a ceiling so a runaway download can't exhaust the
// serverless function's memory.
const MAX_PDF_BYTES = 35_000_000;
// Hard cap on text sent to the model. We don't send the whole 40-page report —
// focusStatements() trims to the financial-statements region first, which cuts
// input tokens ~5× (and cost with it) while keeping the actual statements.
const MAX_TEXT_CHARS = 90_000;

const STATEMENT_MARKER =
  /(statement of financial position|balance sheet|statement of profit|profit (?:or|and) loss|income statement|statement of comprehensive income|statement of cash flow|cash flow statement)/gi;

/**
 * Trim extracted PDF text to the financial-statements region so we send the
 * model ~15K tokens instead of the whole document.
 *
 * A brief quarterly notice is small enough to send whole. A full annual report,
 * though, runs 400+ pages: statement keywords appear first in the table of
 * contents and the directors' narrative (no numbers), and the actual statements
 * sit ~200 pages deep. Anchoring on the FIRST keyword and capping the window
 * therefore used to feed the model 90K chars of prose and it (correctly) found
 * no statements. So we instead locate the DENSEST cluster of statement
 * headings — where balance sheet, P&L, comprehensive income and cash flow
 * appear within a few pages of each other — and open the window on the first
 * balance-sheet heading in that cluster, capturing a full statement set.
 */
function statementWindows(text: string): string[] {
  if (text.length <= MAX_TEXT_CHARS) return [text];

  const hits: number[] = [];
  let m: RegExpExecArray | null;
  STATEMENT_MARKER.lastIndex = 0;
  while ((m = STATEMENT_MARKER.exec(text)) !== null) hits.push(m.index);
  if (hits.length === 0) return [text.slice(0, MAX_TEXT_CHARS)];

  const clusterCount = (h: number): number => hits.filter((x) => x >= h && x < h + MAX_TEXT_CHARS).length;

  // Open a window on the first primary balance-sheet heading near the cluster
  // so it starts at the top of a statement set rather than mid-table.
  const windowAt = (hit: number): { start: number; slice: string } => {
    const primary = /(statement of financial position|balance sheet)/gi;
    primary.lastIndex = Math.max(0, hit - 4_000);
    const pm = primary.exec(text);
    const anchor = pm && pm.index < hit + MAX_TEXT_CHARS ? pm.index : hit;
    const start = Math.max(0, anchor - 1_500);
    return { start, slice: text.slice(start, start + MAX_TEXT_CHARS) };
  };

  // Densest cluster: the hit that begins the window containing the most headings.
  let bestHit = hits[0];
  let bestCount = 0;
  for (const h of hits) {
    const c = clusterCount(h);
    if (c > bestCount) { bestCount = c; bestHit = h; }
  }
  const first = windowAt(bestHit);
  const windows = [first.slice];

  // Second-chance window: the densest cluster OUTSIDE the first window. Annual
  // reports carry two full statement sets (consolidated and unconsolidated)
  // plus hundreds of pages of notes; when the first window lands on a region
  // the model can extract nothing from (PPL's FY2025 annual report did exactly
  // this), the real statements usually sit in the other set.
  const outside = hits.filter((h) => h < first.start || h >= first.start + MAX_TEXT_CHARS);
  if (outside.length) {
    let secondHit = outside[0];
    let secondCount = 0;
    for (const h of outside) {
      const c = clusterCount(h);
      if (c > secondCount) { secondCount = c; secondHit = h; }
    }
    const second = windowAt(secondHit);
    if (second.slice !== first.slice) windows.push(second.slice);
  }
  return windows;
}

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
  /** Reporting basis as printed on the statement heading. */
  basis?: "unconsolidated" | "consolidated" | "unlabelled" | null;
  data: Record<string, number | null>;
  confidence: number;
}

/**
 * Canonical period_type derived from the specific fiscal_period label. Sources
 * only tell us "annual vs quarterly", so a nine-month or half-year cumulative
 * result gets bucketed under "annual" and then renders as a duplicate FY row.
 * Deriving the type from fiscal_period keeps interim statements out of the
 * annual series regardless of how the source grouped the column.
 */
export function canonicalPeriodType(
  fiscalPeriod: string | null,
  fallback: "annual" | "quarterly" | "cumulative"
): "annual" | "quarterly" | "cumulative" {
  const p = (fiscalPeriod ?? "").toUpperCase();
  if (p === "FY") return "annual";
  if (/^Q[1-4]$/.test(p)) return "quarterly";
  if (p === "H1" || p === "9M") return "cumulative";
  return fallback;
}

interface ExtractionResult {
  ticker: string;
  processed: number;
  saved: number;
  skipped: string[];
  errors: string[];
}

type ReportingBasis = "consolidated" | "unconsolidated" | "unlabelled" | "not_applicable";
type FinancialPeriodType = "annual" | "quarterly" | "cumulative";

interface FinancialStatementPayload {
  ticker: string;
  period_type: FinancialPeriodType;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: "income_statement" | "balance_sheet" | "cash_flow";
  reported_date: string | null;
  source_type: string;
  source_url: string | null;
  reporting_basis: ReportingBasis;
  data: Record<string, number | null | string>;
  confidence: number | null;
  updated_at: string;
  validation_flags?: string[];
}

interface ExistingFinancialRow {
  id: string;
  ticker: string;
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  reported_date: string | null;
  source_type: string;
  source_url: string | null;
  reporting_basis: ReportingBasis;
  confidence: number | null;
  data: Record<string, number | null | string>;
}

interface NumericDifference {
  field: string;
  existing: number;
  incoming: number;
  abs_delta: number;
  pct_delta: number | null;
}

const FINANCIAL_IDENTITY_CONFLICT =
  "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type";
const OBSERVATION_IDENTITY_CONFLICT =
  "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type,source_fingerprint";

export function normalizeReportingBasis(value: unknown): ReportingBasis {
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "consolidated" || v === "group") return "consolidated";
  if (v === "unconsolidated" || v === "standalone" || v === "separate" || v === "separate_financial_statements") {
    return "unconsolidated";
  }
  if (v === "not_applicable" || v === "n/a" || v === "na") return "not_applicable";
  return "unlabelled";
}

function numericDataDifferences(
  existing: Record<string, number | null | string>,
  incoming: Record<string, number | null | string>
): NumericDifference[] {
  const keys = new Set([...Object.keys(existing ?? {}), ...Object.keys(incoming ?? {})]);
  const diffs: NumericDifference[] = [];
  for (const key of keys) {
    if (key.startsWith("_")) continue;
    const a = existing?.[key];
    const b = incoming?.[key];
    if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const abs = Math.abs(a - b);
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    const minAbs = key === "eps" ? 0.01 : 1;
    const rel = abs / scale;
    if (abs > minAbs && rel > 0.005) {
      diffs.push({
        field: key,
        existing: a,
        incoming: b,
        abs_delta: abs,
        pct_delta: scale > 0 ? rel * 100 : null,
      });
    }
  }
  return diffs;
}

interface IdentityViolation {
  flag: string;
  message: string;
}

/**
 * Deterministic accounting-identity checks on a single statement's own figures.
 *
 * The cross-source and same-source conflict checks only fire when a prior
 * published row exists to disagree with — so a brand-new period (a quarter
 * never extracted before) with a transposed or magnitude-wrong digit would
 * otherwise sail straight to `published`. These identities need nothing but the
 * incoming row, so they catch that misread in isolation. Each fires only when
 * every input it needs is present (a partial statement is never penalised for a
 * missing field), and shares the freshness audit's 2% tolerance.
 *
 * Only DEFINITIONAL identities that hold for every real statement are enforced:
 *   - the balance sheet must balance (assets = liabilities + equity)
 *   - gross profit is revenue minus cost of sales
 * The tempting "profit before tax − tax = profit after tax" check is NOT here:
 * associate/JV income booked after tax, non-controlling-interest splits, and
 * discontinued operations legitimately break it (NML's PAT exceeds its PBT
 * because of MCB-scale associate income), so enforcing it would quarantine
 * correct data on exactly the holding-heavy blue chips that matter most.
 */
export function statementIdentityViolations(row: {
  statement_type: FinancialStatementPayload["statement_type"];
  data: Record<string, number | null | string>;
}): IdentityViolation[] {
  const d = row.data;
  const n = (k: string): number | null => {
    const v = d[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  // Relative error with a denominator floor so a legitimately-zero expected
  // value can't blow the ratio up and flag good data.
  const off = (actual: number, expected: number): number => Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
  const TOL = 0.02;
  const out: IdentityViolation[] = [];

  if (row.statement_type === "balance_sheet") {
    const assets = n("total_assets"), liabilities = n("total_liabilities"), equity = n("equity");
    if (assets !== null && liabilities !== null && equity !== null && off(assets, liabilities + equity) > TOL) {
      out.push({ flag: "identity:balance_sheet", message: `total assets ${assets} ≠ liabilities + equity ${liabilities + equity}` });
    }
  }

  if (row.statement_type === "income_statement") {
    const revenue = n("revenue"), cogs = n("cost_of_sales"), grossProfit = n("gross_profit");
    if (revenue !== null && cogs !== null && grossProfit !== null && off(grossProfit, revenue - Math.abs(cogs)) > TOL) {
      out.push({ flag: "identity:gross_profit", message: `gross profit ${grossProfit} ≠ revenue − cost of sales ${revenue - Math.abs(cogs)}` });
    }
  }

  return out;
}

function financialSourceFingerprint(row: FinancialStatementPayload): string {
  if (row.source_url?.trim()) return row.source_url.trim();
  const raw = JSON.stringify({
    ticker: row.ticker,
    period_type: row.period_type,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    statement_type: row.statement_type,
    reporting_basis: row.reporting_basis,
    source_type: row.source_type,
    data: row.data,
  });
  return `generated:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function extractorFromData(data: Record<string, number | null | string>): string | null {
  const extractor = data._extractor;
  return typeof extractor === "string" && extractor.trim() ? extractor.trim() : null;
}

async function upsertFinancialObservation(
  db: SupabaseClient,
  row: FinancialStatementPayload
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await db
    .from("financial_statement_observations")
    .upsert(
      {
        ticker: row.ticker,
        period_type: row.period_type,
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
        statement_type: row.statement_type,
        reporting_basis: row.reporting_basis,
        source_type: row.source_type,
        source_url: row.source_url,
        source_fingerprint: financialSourceFingerprint(row),
        reported_date: row.reported_date,
        data: row.data,
        confidence: row.confidence,
        extractor: extractorFromData(row.data),
        validation_flags: row.validation_flags ?? [],
        observed_at: row.updated_at,
      },
      { onConflict: OBSERVATION_IDENTITY_CONFLICT }
    )
    .select("id")
    .maybeSingle();
  if (error) return { id: null, error: error.message };
  return { id: (data?.id as string | undefined) ?? null };
}

interface FinancialRowsQuery extends PromiseLike<{ data: ExistingFinancialRow[] | null; error: { message: string } | null }> {
  eq(column: string, value: unknown): FinancialRowsQuery;
  is(column: string, value: null): FinancialRowsQuery;
  limit(count: number): FinancialRowsQuery;
}

function withNullableIdentity(
  query: FinancialRowsQuery,
  row: FinancialStatementPayload
): FinancialRowsQuery {
  let q = query
    .eq("ticker", row.ticker)
    .eq("period_type", row.period_type)
    .eq("statement_type", row.statement_type)
    .eq("reporting_basis", row.reporting_basis);
  q = row.fiscal_year === null ? q.is("fiscal_year", null) : q.eq("fiscal_year", row.fiscal_year);
  q = row.fiscal_period === null ? q.is("fiscal_period", null) : q.eq("fiscal_period", row.fiscal_period);
  return q;
}

async function readPublishedFinancialCandidates(
  db: SupabaseClient,
  row: FinancialStatementPayload
): Promise<{ rows: ExistingFinancialRow[]; error?: string }> {
  const financials = db.from("company_financials") as unknown as { select(columns: string): FinancialRowsQuery };
  const query = withNullableIdentity(
    financials
      .select("id, ticker, period_type, fiscal_year, fiscal_period, statement_type, reported_date, source_type, source_url, reporting_basis, confidence, data")
      .eq("review_status", "published")
      .limit(20),
    row
  );
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as ExistingFinancialRow[] };
}

function conflictDedupeKey(
  row: FinancialStatementPayload,
  existing: ExistingFinancialRow,
  conflictType: string,
  differences: NumericDifference[]
): string {
  const raw = JSON.stringify({
    ticker: row.ticker,
    period_type: row.period_type,
    fiscal_year: row.fiscal_year,
    fiscal_period: row.fiscal_period,
    statement_type: row.statement_type,
    reporting_basis: row.reporting_basis,
    new_source_type: row.source_type,
    existing_source_type: existing.source_type,
    new_source_url: row.source_url,
    existing_source_url: existing.source_url,
    conflictType,
    fields: differences.map((d) => d.field).sort(),
  });
  return createHash("sha256").update(raw).digest("hex");
}

async function stageFinancialConflict(
  db: SupabaseClient,
  row: FinancialStatementPayload,
  existing: ExistingFinancialRow,
  conflictType: "same_source_revision" | "cross_source_mismatch",
  differences: NumericDifference[]
): Promise<string | null> {
  const severity = conflictType === "same_source_revision" ? "high" : "medium";
  const fields = differences.map((d) => d.field).join(", ");
  const message =
    conflictType === "same_source_revision"
      ? `Incoming ${row.source_type} ${row.statement_type} changes published ${fields}; observation kept for review.`
      : `Incoming ${row.source_type} ${row.statement_type} disagrees with published ${existing.source_type} values for ${fields}.`;
  const { error } = await db
    .from("financial_statement_conflicts")
    .upsert(
      {
        dedupe_key: conflictDedupeKey(row, existing, conflictType, differences),
        ticker: row.ticker,
        period_type: row.period_type,
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
        statement_type: row.statement_type,
        reporting_basis: row.reporting_basis,
        new_source_type: row.source_type,
        existing_source_type: existing.source_type,
        new_source_url: row.source_url,
        existing_source_url: existing.source_url,
        conflict_type: conflictType,
        severity,
        status: "open",
        differences,
        observed_row: row,
        existing_row: existing,
        message,
      },
      { onConflict: "dedupe_key" }
    );
  return error?.message ?? null;
}

/**
 * Stage a self-consistency failure in the same conflicts queue reviewers
 * already use for cross-source disagreements. No prior row is involved, so the
 * existing-* columns are left null and the dedupe key is built from the
 * identity plus the violated checks.
 */
async function stageIdentityConflict(
  db: SupabaseClient,
  row: FinancialStatementPayload,
  violations: IdentityViolation[]
): Promise<string | null> {
  const dedupe = createHash("sha256")
    .update(
      JSON.stringify({
        ticker: row.ticker,
        period_type: row.period_type,
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
        statement_type: row.statement_type,
        reporting_basis: row.reporting_basis,
        source_type: row.source_type,
        conflictType: "identity_violation",
        flags: violations.map((v) => v.flag).sort(),
      })
    )
    .digest("hex");
  const { error } = await db.from("financial_statement_conflicts").upsert(
    {
      dedupe_key: dedupe,
      ticker: row.ticker,
      period_type: row.period_type,
      fiscal_year: row.fiscal_year,
      fiscal_period: row.fiscal_period,
      statement_type: row.statement_type,
      reporting_basis: row.reporting_basis,
      new_source_type: row.source_type,
      existing_source_type: null,
      new_source_url: row.source_url,
      existing_source_url: null,
      conflict_type: "identity_violation",
      severity: "high",
      status: "open",
      differences: violations,
      observed_row: row,
      existing_row: null,
      message: `${row.source_type} ${row.statement_type} fails accounting identities: ${violations.map((v) => v.message).join("; ")}.`,
    },
    { onConflict: "dedupe_key" }
  );
  return error?.message ?? null;
}

async function persistFinancialStatement(
  db: SupabaseClient,
  row: FinancialStatementPayload
): Promise<{ saved: boolean; conflict: boolean; error?: string }> {
  // Self-consistency first, so the flags travel onto the raw observation too
  // and a brand-new period with a bad figure is caught even when there is no
  // prior row to conflict against.
  const identityViolations = statementIdentityViolations(row);
  const validationFlags = new Set([...(row.validation_flags ?? []), ...identityViolations.map((v) => v.flag)]);

  const observation = await upsertFinancialObservation(db, { ...row, validation_flags: [...validationFlags] });
  if (observation.error) return { saved: false, conflict: false, error: `observation: ${observation.error}` };

  const { rows: existingRows, error: readError } = await readPublishedFinancialCandidates(db, row);
  if (readError) return { saved: false, conflict: false, error: `conflict-read: ${readError}` };

  let shouldHoldForReview = false;
  let reviewStatus: "published" | "needs_review" = "published";

  // A row that fails its own accounting identities must not feed ratios or the
  // Copilot — hold it for review and surface it in the conflicts queue.
  if (identityViolations.length > 0) {
    reviewStatus = "needs_review";
    const conflictError = await stageIdentityConflict(db, row, identityViolations);
    if (conflictError) return { saved: false, conflict: false, error: `identity-conflict: ${conflictError}` };
  }

  for (const existing of existingRows) {
    const differences = numericDataDifferences(existing.data, row.data);
    if (differences.length === 0) continue;
    const sameSource = existing.source_type === row.source_type;
    const conflictType = sameSource ? "same_source_revision" : "cross_source_mismatch";
    const conflictError = await stageFinancialConflict(db, row, existing, conflictType, differences);
    if (conflictError) return { saved: false, conflict: false, error: `conflict: ${conflictError}` };
    if (sameSource) shouldHoldForReview = true;
    else {
      reviewStatus = "needs_review";
      validationFlags.add("cross_source_mismatch");
    }
  }

  if (shouldHoldForReview) {
    return { saved: false, conflict: true };
  }

  const { error } = await db.from("company_financials").upsert(
    {
      ...row,
      source_type: row.source_type || "unknown",
      review_status: reviewStatus,
      selected_observation_id: observation.id,
      validation_flags: [...validationFlags],
    },
    { onConflict: FINANCIAL_IDENTITY_CONFLICT }
  );
  if (error) return { saved: false, conflict: false, error: error.message };
  return { saved: reviewStatus === "published", conflict: reviewStatus !== "published" };
}

/**
 * Persist statements read by hand (a human, or Claude reading the PDF pages
 * directly in a session) through the exact same validated write path as the
 * automated extractor: basis normalization, the raw-observation ledger,
 * accounting-identity checks, cross-source conflict detection, and the review
 * gate. No LLM/API call is made here — the caller supplies already-transcribed
 * figures — so it is a zero-marginal-cost way to fill high-priority gaps
 * without the OCR provider. Rows still land as `needs_review` if they fail
 * their own identities or disagree with a published source.
 */
export interface ManualStatementInput {
  fiscal_year: number | null;
  fiscal_period: string | null; // FY | Q1..Q4 | H1 | 9M
  statement_type: "income_statement" | "balance_sheet" | "cash_flow";
  basis: string | null; // "unconsolidated" | "consolidated" | ...
  data: Record<string, number | null>;
  confidence?: number;
}

export async function saveManualStatements(
  ticker: string,
  source: { url: string | null; date: string | null; sourceType?: string; extractor?: string },
  statements: ManualStatementInput[]
): Promise<{ saved: number; needsReview: number; skipped: number; errors: string[] }> {
  const db = createAdminClient();
  const out = { saved: 0, needsReview: 0, skipped: 0, errors: [] as string[] };
  const now = new Date().toISOString();
  for (const s of statements) {
    const reportingBasis = normalizeReportingBasis(s.basis);
    const result = await persistFinancialStatement(db, {
      ticker: ticker.toUpperCase(),
      period_type: canonicalPeriodType(s.fiscal_period, "quarterly"),
      fiscal_year: s.fiscal_year,
      fiscal_period: s.fiscal_period,
      statement_type: s.statement_type,
      reported_date: source.date,
      source_type: source.sourceType ?? "psx-filing",
      source_url: source.url,
      reporting_basis: reportingBasis,
      data: { ...s.data, _units: "PKR thousands", _basis: reportingBasis, _extractor: source.extractor ?? "claude-code-manual" },
      confidence: s.confidence ?? 0.9,
      updated_at: now,
    });
    if (result.error) out.errors.push(`${s.fiscal_year} ${s.fiscal_period} ${s.statement_type}: ${result.error}`);
    else if (result.saved) out.saved++;
    else if (result.conflict) out.needsReview++;
    else out.skipped++;
  }
  return out;
}

type PdfFetchResult = { buf: Buffer } | { error: string };
type PdfTextResult = { text: string } | { error: string };

/**
 * Download a PSX filing PDF. Returns the bytes on success or a specific reason
 * on failure (HTTP status, oversize, timeout) so the caller can log exactly
 * what went wrong instead of a blanket "could not read PDF".
 */
async function fetchPdf(url: string): Promise<PdfFetchResult> {
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
  return { buf };
}

/** Extract the text layer from downloaded PDF bytes. */
async function parsePdfText(buf: Buffer): Promise<PdfTextResult> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    await parser.destroy();
    const text = (result.text ?? "").replace(/[ \t]+/g, " ").trim();
    // Many PSX quarterly filings are scanned image PDFs: pdf-parse returns the
    // page skeleton ("-- 1 of 41 --") plus a cover blurb but no statement text,
    // typically well under ~2.5K chars for a multi-MB file. Reject these
    // explicitly so the caller logs "scanned/image PDF" and moves to the next
    // candidate (usually the full annual report, which carries a text layer).
    if (text.length < 2_500 && !STATEMENT_MARKER.test(text)) {
      STATEMENT_MARKER.lastIndex = 0;
      return { error: `no text layer (${text.length} chars) — scanned/image PDF, needs OCR` };
    }
    STATEMENT_MARKER.lastIndex = 0;
    return { text };
  } catch (err) {
    return { error: `PDF parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const EXTRACTION_PROMPT = `You convert a Pakistan Stock Exchange financial-result filing into structured JSON.

STRICT RULES:
- Echo ONLY numbers that literally appear in the document text. Never compute, estimate, or fill in missing values — use null.
- The ENTIRE filing uses ONE monetary unit. Read the statement headers ("Rupees in '000", "Rupees in million", "(Rupees)", etc.) and report it ONCE as document_units: one of "thousands" | "millions" | "billions" | "rupees". Do NOT convert any figure — echo them exactly as printed.
- EPS is in rupees per share (never scaled). Percentages stay as printed.
- fiscal_year_end_month is the calendar month (1-12) in which this company's financial year ENDS. Read it from the balance sheet's audited comparative column heading, which always states the year-end date ("Audited 30 June 2025" -> 6; "Audited December 31, 2025" -> 12; "Audited 31 March 2026" -> 3). Report it once for the document. This is the same fact you use to derive fiscal_year below, so state it explicitly rather than leaving it implicit.
- A filing may print an UNCONSOLIDATED (standalone) set and a CONSOLIDATED (group) set. Extract BOTH when both are present, and set "basis" correctly on every object. They are different facts about different reporting entities, and for a group holding company the consolidated figure is the one the market quotes, so discarding it loses the number that matters.
- Read the two sets INDEPENDENTLY and never mix a figure from one into the other. Within a single set, emit at most one object per (period, statement_type): if you find yourself producing two objects with the same basis, period and statement type, you have read the same column twice — emit one.
- If a set's basis is not stated in the heading, use "unlabelled" rather than guessing. Do not label a set "unconsolidated" merely because it appears first.
- Within that chosen set, emit EVERY period column it prints, each as its own object in "statements", including the comparative prior-year columns. Do not discard the comparative: it is the prior-year leg of the trailing-twelve-month calculation and is often available nowhere else.
  An interim profit-or-loss typically prints four columns, so emit four objects:
    "Nine months ended 31 March 2026"  -> fiscal_year 2026, fiscal_period "9M"
    "Nine months ended 31 March 2025"  -> fiscal_year 2025, fiscal_period "9M"
    "Quarter ended 31 March 2026"      -> fiscal_year 2026, fiscal_period "Q3"
    "Quarter ended 31 March 2025"      -> fiscal_year 2025, fiscal_period "Q3"
  A balance sheet prints two columns (current unaudited, prior audited year end); emit both.
  Read each column independently. Never carry a figure across columns, and never emit the same figures twice under different years — if a line is blank in one column, that column's value is null.
  If a comparative column is marked "Restated", still emit it: the restated figure is the correct comparative.
- If only one set of statements exists, extract it and set basis from its heading.
- basis: "unconsolidated" | "consolidated" | "unlabelled" — read it from the statement heading (e.g. "Condensed Interim Unconsolidated Statement of Profit or Loss").
- fiscal_year is the calendar year in which the company's FISCAL YEAR ENDS. It is NOT the calendar year of the period-end date. Derive it in three steps:
    1. Find the company's year end. The comparative balance sheet column states it ("Audited 30 June 2025" means a June year end; "Audited December 31, 2025" means a December year end).
    2. Find the period-end date of the statements you are reading.
    3. fiscal_year = the calendar year of the FIRST year end that falls ON or AFTER that period-end date.
  Worked examples for a JUNE year end (fiscal year runs 1 July to 30 June):
    quarter ended 30 September 2025 -> next June end is June 2026 -> fiscal_year 2026, fiscal_period "Q1"
    quarter ended 31 December 2025  -> next June end is June 2026 -> fiscal_year 2026, fiscal_period "Q2"
    half year ended 31 December 2025 -> next June end is June 2026 -> fiscal_year 2026, fiscal_period "H1"
    nine months ended 31 March 2026 -> next June end is June 2026 -> fiscal_year 2026, fiscal_period "9M"
  Note that the first three all end in calendar 2025 but belong to fiscal_year 2026. Taking the calendar year of the period end would label them 2025 and is WRONG.
  Worked examples for a DECEMBER year end (fiscal year runs 1 January to 31 December):
    quarter ended 31 March 2026 -> next December end is December 2026 -> fiscal_year 2026, fiscal_period "Q1"
    half year ended 30 June 2026 -> fiscal_year 2026, fiscal_period "H1"
- Comparative columns get their OWN fiscal_year by the same rule, normally one year less than the current column. Never emit a comparative under the current period's fiscal_year.
- If you cannot confidently identify a value, use null.
- confidence: 0-1, how certain you are the numbers are correctly read from the document.

Return JSON:
{"document_units": "thousands" | "millions" | "billions" | "rupees",
 "fiscal_year_end_month": 1-12,
 "statements": [{
  "period_type": "annual" | "quarterly",
  "fiscal_year": 2025,
  "fiscal_period": "FY" | "Q1" | "Q2" | "Q3" | "Q4" | "H1" | "9M",
  "statement_type": "income_statement" | "balance_sheet" | "cash_flow",
  "units": "PKR thousands",
  "basis": "unconsolidated" | "consolidated" | "unlabelled",
  "confidence": 0.0,
  "data": {
    // income_statement keys (use exactly these, null when absent):
    // revenue, cost_of_sales, gross_profit, operating_expenses, operating_profit,
    // finance_cost, profit_before_tax, tax, profit_after_tax, eps
    // BANK income_statement extra keys (only for banks/DFIs, else null):
    //   markup_earned (interest/markup/return earned), markup_expensed (interest expense),
    //   net_markup_income (markup earned − expensed, "net markup/interest income"),
    //   non_markup_income (fee/commission/FX/dividend/other non-markup income - total),
    //   provisions (provisions/credit loss/reversal against advances & investments - as printed, negative if a charge)
    // balance_sheet keys:
    // total_assets, current_assets, cash_and_equivalents, inventory, receivables,
    // total_liabilities, current_liabilities, borrowings, equity, retained_earnings
    // BANK balance_sheet extra keys (only for banks/DFIs, else null):
    //   deposits (deposits and other accounts), advances (net advances/financing),
    //   gross_advances (gross advances before provision, from the advances note if on the face),
    //   non_performing_loans (non-performing advances/loans, from the advances note if shown),
    //   investments (total investments)
    // cash_flow keys:
    // operating_cash_flow, investing_cash_flow, financing_cash_flow, capex, cash_balance
  }
}]}

Include a statement object only when the document actually contains that statement. Banks: treat markup/interest income as revenue. If the document is not a financial result (e.g. a notice), return {"statements": []}.`;

// Chunked vision extraction: large filings are split into consecutive
// page-range sub-PDFs and read in order until every statement type has been
// found. Annual reports put the standalone statements roughly two-thirds in
// (after the directors' review and before the notes), so early-stop usually
// means a handful of chunks, not 400 pages.
const VISION_CHUNK_PAGES = 25;
const VISION_MAX_CHUNKS = 24; // hard ceiling: 600 pages per filing

type VisionResult = { statements: ExtractedStatement[]; document_units?: string; fiscal_year_end_month?: number; model: string } | { error: string };

function parseStatementsJson(text: string): { statements?: ExtractedStatement[]; document_units?: string; fiscal_year_end_month?: number } | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { statements?: ExtractedStatement[]; document_units?: string; fiscal_year_end_month?: number };
  } catch {
    return null;
  }
}

/**
 * OCR fallback: many PSX filings are scanned image PDFs with no text layer —
 * including recent PPL quarterly transmissions, where the statement tables
 * (pages 30-44) are pure images. The configured vision model (OpenRouter by
 * default, Claude fallback — see lib/ai/vision.ts) reads the PDF pages
 * directly under the same strict echo-only extraction prompt. Used only when
 * the text-layer path yields nothing or misses the deep statements.
 */
async function extractViaVision(buf: Buffer, filingTitle: string, filingDate: string | null, ticker: string): Promise<VisionResult> {
  if (visionDisabled()) return { error: "vision extraction disabled (VISION_DISABLED)" };
  if (!visionConfigured()) return { error: "no vision provider configured (set OPENROUTER_API_KEY / VISION_API_KEY or CLAUDE_API_KEY)" };

  let chunks;
  try {
    chunks = await splitPdfPages(buf, VISION_CHUNK_PAGES);
  } catch (err) {
    return { error: `PDF split failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (chunks.length > VISION_MAX_CHUNKS) chunks = chunks.slice(0, VISION_MAX_CHUNKS);

  const merged: ExtractedStatement[] = [];
  const seen = new Set<string>();
  let documentUnits: string | undefined;
  let model = "";
  const errors: string[] = [];

  const totalPages = chunks[chunks.length - 1]?.lastPage ?? 0;
  for (const chunk of chunks) {
    const rangeNote =
      chunks.length > 1
        ? `\nThis attachment is pages ${chunk.firstPage} to ${chunk.lastPage} of a ${totalPages}-page filing. Extract only statements whose tables are fully visible in these pages; if none are, return {"statements": []}.`
        : "";
    const result = await visionPdf(
      chunk.buf,
      EXTRACTION_PROMPT,
      `Filing title: ${filingTitle}\nFiling date: ${filingDate ?? "unknown"}\nTicker: ${ticker}\n\nThe document is attached. Some or all statement pages may be scanned images — read the tables from the page images.${rangeNote}\nReturn ONLY the JSON object, no prose.`,
    );
    if ("error" in result) {
      errors.push(`pages ${chunk.firstPage}-${chunk.lastPage}: ${result.error}`);
      // Provider-level failures (auth, credits, timeouts) won't heal on the
      // next chunk — bail instead of repeating the same failure 20 times.
      if (/HTTP 4|credit|unauthor|not configured|disabled/i.test(result.error)) break;
      continue;
    }
    model = result.model;
    const parsed = parseStatementsJson(result.text);
    if (!parsed) {
      errors.push(`pages ${chunk.firstPage}-${chunk.lastPage}: no JSON in reply`);
      continue;
    }
    documentUnits ??= parsed.document_units;
    for (const s of parsed.statements ?? []) {
      const key = `${s.fiscal_year}-${s.fiscal_period}-${s.statement_type}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    }
    // Early stop: one full statement set is what a filing carries.
    const types = new Set(merged.map((s) => s.statement_type));
    if (types.has("income_statement") && types.has("balance_sheet") && types.has("cash_flow")) break;
  }

  if (merged.length === 0) {
    return { error: errors.length ? errors.join("; ").slice(0, 400) : "no statements found in any chunk" };
  }
  return { statements: merged, document_units: documentUnits, model };
}

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
export async function extractFinancials(ticker: string, maxFilings = 2, force = false): Promise<ExtractionResult> {
  const t = ticker.toUpperCase();
  const out: ExtractionResult = { ticker: t, processed: 0, saved: 0, skipped: [], errors: [] };

  if (!aiAvailable()) {
    out.errors.push("AI provider is not configured — extraction unavailable.");
    return out;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    out.errors.push("SUPABASE_SERVICE_ROLE_KEY missing — cannot persist extractions.");
    return out;
  }
  const db = createAdminClient();

  // Only true financial-report PDFs carry statements. The "result" category is
  // loose (it also tags Shariah disclosures, video recordings and briefing
  // notices that merely mention "half year"), so require a report/accounts
  // title AND exclude the known non-statement document types. Ranked so full
  // reports (which contain all three statements) are tried before brief
  // results notices.
  const isReport = (title: string): boolean => {
    const x = title.toLowerCase();
    if (/shariah|video|briefing|presentation|clarification|notice of|proxy|agm|egm|book closure|circular|postal ballot|auditor|pattern of shareholding/.test(x)) return false;
    return /transmission|quarterly report|half[\s-]?year|annual report|annual account|financial result|financial statement|accounts for|condensed interim|un-?audited|audited/.test(x);
  };
  // Operationally newsy companies (frequent director disclosures, discoveries,
  // corporate notices — E&P names especially) can push the annual report,
  // the one filing with a full cash-flow statement, past the most recent 40
  // announcements. Widen the search only when nothing carrying "annual
  // report/account" turns up in that window, so quiet companies still pay the
  // cheap 40-item fetch.
  let filings = await getCompanyFilings(t, 40);
  if (!filings.some((f) => isReport(f.title) && /annual report|annual account/i.test(f.title))) {
    filings = await getCompanyFilings(t, 200);
  }
  // Annual reports first: they carry the full balance sheet AND cash flow, and
  // (unlike many scanned quarterly notices) reliably have a real text layer.
  // Quarterly/half-year transmissions next (condensed interim BS + CF), then
  // brief "Financial Results" notices — which are usually just the P&L — last.
  const rank = (title: string): number => {
    const x = title.toLowerCase();
    if (/annual report|annual account/.test(x)) return 0;
    if (/transmission|quarterly report|half[\s-]?year|condensed interim/.test(x)) return 1;
    return 2;
  };
  // Filing dates are human strings ("Apr 30, 2026"); Date.parse handles them and
  // gives a chronological sort (localeCompare would order them alphabetically,
  // e.g. putting "Sep 2025" ahead of "Oct 2025").
  const dateMs = (d: string | null): number => {
    const n = d ? Date.parse(d) : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  const resultPdfs = filings
    .filter((f) => f.url.toLowerCase().includes(".pdf") && isReport(f.title))
    .sort((a, b) => rank(a.title) - rank(b.title) || dateMs(b.date) - dateMs(a.date))
    .slice(0, maxFilings * 3); // candidates; we stop after maxFilings successful extractions

  if (resultPdfs.length === 0) {
    out.errors.push("No result filings with PDF documents found on the PSX portal.");
    return out;
  }

  // Which statement types each filing has already yielded. A filing used to be
  // skipped forever once ANY row carried its URL — so a quarterly report whose
  // income statement extracted but whose balance sheet and cash flow didn't
  // was frozen at income-only for good. Full reports are only "done" once the
  // balance sheet and cash flow have both landed; brief results notices are
  // usually just the P&L, so any extraction completes them.
  const { data: existing } = await db
    .from("company_financials")
    .select("source_url, statement_type")
    .eq("ticker", t)
    .eq("source_type", "psx-filing")
    .eq("review_status", "published");
  const typesByUrl = new Map<string, Set<string>>();
  for (const r of existing ?? []) {
    const url = r.source_url as string | null;
    if (!url) continue;
    if (!typesByUrl.has(url)) typesByUrl.set(url, new Set());
    typesByUrl.get(url)!.add(r.statement_type as string);
  }
  const fullyExtracted = (filing: { url: string; title: string }): boolean => {
    const types = typesByUrl.get(filing.url);
    if (!types || types.size === 0) return false;
    if (rank(filing.title) === 2) return true;
    return types.has("balance_sheet") && types.has("cash_flow");
  };

  for (const filing of resultPdfs) {
    if (out.processed >= maxFilings) break;
    // force=true re-reads filings whose statements are already saved — needed
    // after a schema extension (e.g. the bank line items) so existing rows get
    // enriched with the new fields. Matching values upsert cleanly; differing
    // values still stage for review, so a bad re-read cannot clobber good data.
    if (!force && fullyExtracted(filing)) {
      out.skipped.push(`already extracted: ${filing.title}`);
      continue;
    }

    const pdf = await fetchPdf(filing.url);
    if ("error" in pdf) {
      out.errors.push(`${filing.title}: ${pdf.error}`);
      continue;
    }
    out.processed++;

    try {
      // Each statement is normalized to PKR thousands by its own source's
      // reported unit before merging, so text-path and vision-path rows can be
      // combined without a shared multiplier double-scaling either set.
      type SourcedStatement = ExtractedStatement & { _extractor: string };
      let statements: SourcedStatement[] = [];

      // Text-layer path first (cheap): try each candidate statement window
      // until one yields statements — large annual reports carry consolidated +
      // unconsolidated sets, and the first window can land on an unparseable
      // region.
      // The company's fiscal year end, read off the balance sheet's audited
      // comparative heading. Stored because it cannot be reliably inferred
      // afterwards: comparative rows inherit the current filing's date, so a
      // March close filed in June looks identical to a June close filed in
      // June. Knowing it makes period labelling checkable rather than guessed.
      let yearEndMonth: number | null = null;
      const parsed = await parsePdfText(pdf.buf);
      if ("text" in parsed) {
        for (const window of statementWindows(parsed.text)) {
          const { data } = await chatJson<{ statements: ExtractedStatement[]; document_units?: string; fiscal_year_end_month?: number }>(
            EXTRACTION_PROMPT,
            `Filing title: ${filing.title}\nFiling date: ${filing.date ?? "unknown"}\nTicker: ${t}\n\n--- DOCUMENT TEXT ---\n${window}`,
            12_000,
          );
          const found = (data.statements ?? []).filter(validStatement);
          if (found.length > 0) {
            const mult = toThousandsMultiplier(data.document_units ?? found[0]?.units);
            found.forEach((s) => normalizeUnits(s, mult));
            statements = found.map((s) => ({ ...s, _extractor: "text+deepseek" }));
            yearEndMonth ??= data.fiscal_year_end_month ?? null;
            break;
          }
        }
      }

      // Vision fallback: the filing is a scanned image PDF (no text layer), or
      // has a partial text layer whose statement tables are images — the common
      // shape for PSX transmissions, where the notes carry text but the actual
      // statement pages don't. Also runs when a full report's text extraction
      // came back without a balance sheet or cash flow: those tables are the
      // ones most often left as images while the P&L survives in the notes.
      const missingDeepStatements =
        rank(filing.title) <= 1 &&
        !statements.some((s) => s.statement_type === "balance_sheet" || s.statement_type === "cash_flow");
      if (statements.length === 0 || missingDeepStatements) {
        const vision = await extractViaVision(pdf.buf, filing.title, filing.date, t);
        if ("error" in vision) {
          if (statements.length === 0) {
            const textNote = "error" in parsed ? parsed.error : "no extractable statements in text layer";
            out.errors.push(`${filing.title}: ${textNote}; ${vision.error}`);
            continue;
          }
          // Keep the text-path statements; just record why vision added nothing.
          out.errors.push(`${filing.title}: vision top-up failed: ${vision.error}`);
        } else {
          yearEndMonth ??= vision.fiscal_year_end_month ?? null;
          const found = vision.statements.filter(validStatement);
          const mult = toThousandsMultiplier(vision.document_units ?? found[0]?.units);
          found.forEach((s) => normalizeUnits(s, mult));
          const seen = new Set(statements.map((s) => `${s.fiscal_year}-${s.fiscal_period}-${s.statement_type}`));
          statements = [
            ...statements,
            ...found
              .filter((s) => !seen.has(`${s.fiscal_year}-${s.fiscal_period}-${s.statement_type}`))
              .map((s) => ({ ...s, _extractor: `vision+${vision.model}` })),
          ];
        }
      }

      if (statements.length === 0) {
        out.skipped.push(`no extractable statements (text and vision): ${filing.title}`);
        continue;
      }

      if (yearEndMonth !== null && yearEndMonth >= 1 && yearEndMonth <= 12) {
        await db
          .from("company_metadata")
          .upsert({ ticker: t, fiscal_year_end_month: yearEndMonth, last_updated: new Date().toISOString() }, { onConflict: "ticker" })
          .then(({ error }) => {
            if (error) out.errors.push(`year-end: ${error.message}`);
          });
      }

      for (const s of statements) {
        const fiscalPeriod = s.fiscal_period ?? (s.period_type === "annual" ? "FY" : null);
        const reportingBasis = normalizeReportingBasis(s.basis);
        const result = await persistFinancialStatement(db, {
          ticker: t,
          period_type: canonicalPeriodType(fiscalPeriod, s.period_type),
          fiscal_year: s.fiscal_year,
          fiscal_period: fiscalPeriod,
          statement_type: s.statement_type,
          reported_date: filing.date,
          source_type: "psx-filing",
          source_url: filing.url,
          reporting_basis: reportingBasis,
          data: { ...s.data, _units: "PKR thousands", _basis: reportingBasis, _extractor: s._extractor },
          confidence: Math.max(0, Math.min(1, s.confidence ?? 0)),
          updated_at: new Date().toISOString(),
        });
        if (result.error) out.errors.push(`db: ${result.error}`);
        else if (result.saved) out.saved++;
        else if (result.conflict) out.skipped.push(`staged for review: ${filing.title} ${s.fiscal_year ?? "?"} ${fiscalPeriod ?? "?"} ${s.statement_type}`);
      }
    } catch (err) {
      out.errors.push(`extraction failed for "${filing.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    await db.from("data_fetch_logs").insert({
      ticker: t,
      section: "financials",
      source: "psx-filing+deepseek",
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
function statementData(p: PsxPeriodFigures, reportingBasis: ReportingBasis): Record<string, number | null | string> {
  const data: Record<string, number | null | string> = {
    revenue: p.sales,
    eps: p.eps,
    _units: "PKR thousands",
    _source: "psx-portal",
    _basis: reportingBasis,
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
 * financials path; the PDF extractor above remains available only as an
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
    const fiscalPeriod = p.fiscalPeriod ?? (period_type === "annual" ? "FY" : null);
    const reportingBasis = normalizeReportingBasis(null);
    const result = await persistFinancialStatement(db, {
      ticker: t,
      period_type: canonicalPeriodType(fiscalPeriod, period_type),
      fiscal_year: p.fiscalYear,
      fiscal_period: fiscalPeriod,
      statement_type: "income_statement",
      reported_date: null,
      source_type: "psx-portal",
      source_url: data.sourceUrl,
      reporting_basis: reportingBasis,
      data: statementData(p, reportingBasis),
      confidence: 1, // official PSX figures, read verbatim
      updated_at: now,
    });
    if (result.error) out.errors.push(`db: ${result.error}`);
    else if (result.saved) out.saved++;
    else if (result.conflict) out.skipped.push(`staged for review: ${p.fiscalYear ?? "?"} ${fiscalPeriod ?? "?"} income_statement`);
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
