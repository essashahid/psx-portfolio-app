import type { SupabaseClient } from "@supabase/supabase-js";
import { getStockMasterMap } from "@/lib/stock-master";
import { getCompanyAnnouncements, type PsxAnnouncement } from "@/lib/news/psx-announcements";
import { getTaxSettings } from "@/lib/dividends/tax";
import { extractDividendDetailsFromPdf, type PdfDividendDetails } from "@/lib/dividends/pdf-extract";
import {
  computeAmounts,
  deriveDps,
  estimatePaymentWindow,
  type EligibilityStatus,
} from "@/lib/dividends/engine";

const ANNOUNCEMENTS_PER_TICKER = 10;
const BATCH_SIZE = 4;
const PDF_BATCH_SIZE = 4;
const MAX_PDF_FETCHES = 16;

export interface DetectResult {
  checkedTickers: number;
  staged: number;
  upgraded: number;
  skippedDuplicates: number;
  lowConfidence: number;
  pdfsRead: number;
  errors: string[];
}

interface ParsedAnnouncement {
  dividendType: "cash" | "bonus" | "right" | "other";
  percentage: number | null;
  rupeesPerShare: number | null;
  isFinal: boolean | null;
}

/**
 * Parse PSX announcement titles, e.g.:
 *  "Declaration of Interim Cash Dividend @ 50% i.e. Rs. 5/- per share"
 *  "Final Cash Dividend = 175% (Rs. 17.5/- per share)"
 *  "Bonus Issue = 10%"
 * Many titles carry no value at all ("Credit of Interim Cash Dividend") — the
 * PDF body is read separately to fill the gap.
 */
export function parseDividendTitle(title: string): ParsedAnnouncement | null {
  const t = title.toLowerCase();
  const mentionsDividend = /\b(dividend|payout|bonus|right|entitlement)\b/.test(t);
  if (!mentionsDividend) return null;
  const dividendType: ParsedAnnouncement["dividendType"] = /\bbonus\b/.test(t)
    ? "bonus"
    : /\bright\b/.test(t)
      ? "right"
      : /\b(cash dividend|dividend)\b/.test(t)
        ? "cash"
        : "other";

  const pctMatch = t.match(/(?:@|=)?\s*(\d{1,4}(?:\.\d{1,2})?)\s*%/);
  const rsMatch = t.match(/rs\.?\s*(\d{1,4}(?:\.\d{1,4})?)\s*\/?-?\s*(?:per share)?/);

  return {
    dividendType,
    percentage: pctMatch ? parseFloat(pctMatch[1]) : null,
    rupeesPerShare: rsMatch ? parseFloat(rsMatch[1]) : null,
    isFinal: /\bfinal\b/.test(t) ? true : /\binterim\b/.test(t) ? false : null,
  };
}

function psxDateToIso(d: string): string | null {
  const parsed = new Date(`${d} GMT+0500`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

interface Candidate {
  holding: { ticker: string; company_name: string | null; quantity: number };
  ann: PsxAnnouncement;
  parsed: ParsedAnnouncement;
  announcementDate: string | null;
  /** Needs a PDF read because the title gave us no per-share / percentage. */
  needsPdf: boolean;
}

/**
 * "Check upcoming dividends": scans official PSX company announcements for every
 * holding, parses dividend declarations (reading the PDF body when the title has
 * no value), computes expected gross/tax/net with the user's filer tax profile,
 * and stages dividend_events for review. Existing untouched low-confidence events
 * are upgraded in place once the PDF yields a per-share figure. Never overwrites
 * a user-edited event.
 */
export async function checkUpcomingDividends(
  supabase: SupabaseClient,
  userId: string
): Promise<DetectResult> {
  const tax = await getTaxSettings(supabase, userId);
  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  const [{ data: holdings }, masterMap] = await Promise.all([
    supabase
      .from("holdings")
      .select("ticker, company_name, quantity")
      .eq("user_id", userId)
      .eq("hidden", false)
      .gt("quantity", 0),
    getStockMasterMap(),
  ]);
  const faceValues = new Map(
    [...masterMap.values()].map((m) => [m.ticker, m.face_value !== null ? Number(m.face_value) : null])
  );
  const list = (holdings ?? []).map((h) => ({
    ticker: String(h.ticker),
    company_name: h.company_name as string | null,
    quantity: Number(h.quantity),
  }));
  if (list.length === 0)
    return { checkedTickers: 0, staged: 0, upgraded: 0, skippedDuplicates: 0, lowConfidence: 0, pdfsRead: 0, errors };

  // Earliest buy per ticker for eligibility checks
  const { data: txns } = await supabase
    .from("transactions")
    .select("ticker, trade_date, type")
    .eq("user_id", userId)
    .eq("type", "buy")
    .order("trade_date", { ascending: true });
  const firstBuy = new Map<string, string>();
  for (const t of txns ?? []) if (!firstBuy.has(t.ticker)) firstBuy.set(t.ticker, t.trade_date);

  // 1. Fetch announcements for every holding
  const announcementsByTicker = new Map<string, PsxAnnouncement[]>();
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (h) => {
        try {
          return { ticker: h.ticker, rows: await getCompanyAnnouncements(h.ticker, ANNOUNCEMENTS_PER_TICKER) };
        } catch (err) {
          errors.push(`${h.ticker}: ${err instanceof Error ? err.message : String(err)}`);
          return { ticker: h.ticker, rows: [] as PsxAnnouncement[] };
        }
      })
    );
    for (const r of results) announcementsByTicker.set(r.ticker, r.rows);
  }

  // 2. Build candidates (dividend announcements that are receivable-relevant)
  const candidates: Candidate[] = [];
  for (const h of list) {
    for (const ann of announcementsByTicker.get(h.ticker) ?? []) {
      const parsed = parseDividendTitle(ann.title);
      if (!parsed || parsed.dividendType === "right") continue; // rights issues are not receivables
      candidates.push({
        holding: h,
        ann,
        parsed,
        announcementDate: psxDateToIso(ann.date),
        needsPdf: parsed.rupeesPerShare === null && parsed.percentage === null,
      });
    }
  }

  // 3. Read PDFs to recover the per-share value the titles lack (capped per run)
  const pdfByUrl = new Map<string, PdfDividendDetails>();
  const pdfTargets = candidates
    .filter((c) => c.needsPdf && /\.pdf(\?|$)/i.test(c.ann.url))
    .slice(0, MAX_PDF_FETCHES);
  for (let i = 0; i < pdfTargets.length; i += PDF_BATCH_SIZE) {
    const batch = pdfTargets.slice(i, i + PDF_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (c) => ({ url: c.ann.url, details: await extractDividendDetailsFromPdf(c.ann.url) }))
    );
    for (const r of results) pdfByUrl.set(r.url, r.details);
  }
  const pdfsRead = [...pdfByUrl.values()].filter((d) => d.parsed).length;

  // 4. Existing events keyed by dedupe_key, so we can upgrade untouched ones
  const dedupeKeys = candidates.map(
    (c) => `psx:${c.holding.ticker}:${c.announcementDate ?? "nodate"}:${simpleHash(c.ann.title)}`
  );
  const { data: existingRows } = await supabase
    .from("dividend_events")
    .select("id, dedupe_key, status, dividend_per_share, eligibility_status")
    .eq("user_id", userId)
    .in("dedupe_key", dedupeKeys.length > 0 ? dedupeKeys : ["__none__"]);
  const existingByKey = new Map((existingRows ?? []).map((r) => [String(r.dedupe_key), r]));

  // An event is "engine-owned" (safe to recompute) until the user acts on it.
  const userTouched = (e: { status: string; eligibility_status: string | null }) =>
    ["received", "ignored", "expected", "not_eligible"].includes(e.status) ||
    ["eligible", "not_eligible"].includes(e.eligibility_status ?? "");

  // 5. Build records, splitting into new inserts and in-place upgrades
  const inserts: Record<string, unknown>[] = [];
  const upgrades: { id: string; patch: Record<string, unknown> }[] = [];
  let lowConfidence = 0;

  for (const c of candidates) {
    const { holding: h, ann, parsed, announcementDate } = c;
    const pdf = pdfByUrl.get(ann.url) ?? null;

    const rupeesPerShare = parsed.rupeesPerShare ?? pdf?.dpsFromPdf ?? null;
    const percentage = parsed.percentage ?? pdf?.percentageFromPdf ?? null;
    const tickerFace = faceValues.get(h.ticker) ?? null;
    const { dps, faceValueUsed, faceValueAssumed } = deriveDps({
      dividend_per_share: rupeesPerShare,
      dividend_percentage: percentage,
      face_value: tickerFace,
      default_face_value: tax.default_face_value,
    });

    // Eligibility: transactions are authoritative when present
    let eligibility: EligibilityStatus = "needs_confirmation";
    let eligibilityNotes =
      "Eligibility assumed from current holding. Confirm whether you held this stock before the ex-date/book closure date.";
    const buyDate = firstBuy.get(h.ticker);
    if (buyDate && announcementDate && buyDate <= announcementDate) {
      eligibility = "likely_eligible";
      eligibilityNotes = `First recorded buy ${buyDate} predates the announcement. Confirm holding through the book closure date.`;
    }

    const credited = pdf?.isCredited ?? /\bcredit(?:ed)?\b/i.test(ann.title);
    // Credited filings are already paid — give them no forward payment window so
    // they are never treated as outstanding/overdue receivables.
    const window = credited
      ? { start: null, end: null, exact: false }
      : estimatePaymentWindow(
          {
            payment_date: pdf?.paymentDate ?? null,
            book_closure_end: pdf?.bookClosureEnd ?? null,
            book_closure_start: pdf?.bookClosureStart ?? null,
            ex_date: null,
            announcement_date: announcementDate,
          },
          tax.default_payment_window_days
        );

    const amounts = computeAmounts(h.quantity, dps, tax);
    const valueParsed = dps !== null;
    const isCash = parsed.dividendType === "cash";
    const confidence: "high" | "medium" | "low" = valueParsed && isCash ? "high" : valueParsed ? "medium" : "low";
    if (confidence === "low") lowConfidence++;

    // Status: a value-less filing still needs review; a credited filing with a
    // value is a confirmed payout the user can log; a new declaration is upcoming.
    const autoConfirm = tax.auto_create_confirmed && confidence === "high";
    const status = !valueParsed ? "needs_review" : credited ? "announced" : autoConfirm ? "announced" : "needs_review";

    const noteParts: string[] = [];
    if (faceValueAssumed && percentage !== null)
      noteParts.push("Face value not confirmed. Calculation uses default face value.");
    if (credited && valueParsed)
      noteParts.push("PSX filing indicates this dividend has already been credited — mark received to log the actual amount.");
    if (pdf?.parsed && parsed.rupeesPerShare === null && pdf.dpsFromPdf !== null)
      noteParts.push("Per-share value read from the official announcement PDF.");

    const dedupeKey = `psx:${h.ticker}:${announcementDate ?? "nodate"}:${simpleHash(ann.title)}`;
    const existing = existingByKey.get(dedupeKey);

    const calcFields = {
      dividend_type: parsed.dividendType,
      dividend_percentage: percentage,
      face_value: faceValueUsed,
      face_value_assumed: faceValueAssumed,
      dividend_per_share: dps,
      book_closure_start: pdf?.bookClosureStart ?? null,
      book_closure_end: pdf?.bookClosureEnd ?? null,
      payment_date: credited ? pdf?.paymentDate ?? null : null,
      estimated_payment_start: window.start,
      estimated_payment_end: window.end,
      eligible_quantity: h.quantity,
      gross_expected: amounts.gross,
      estimated_tax: amounts.estimatedTax,
      net_expected: amounts.net,
      taxpayer_status: tax.taxpayer_status,
      tax_rate: tax.dividend_tax_rate,
      tax_rate_configured: tax.dividend_tax_rate !== null,
      needs_tax_review: !isCash,
      confidence_level: confidence,
      event_type: credited ? "credit" : "announcement",
      notes: noteParts.length > 0 ? noteParts.join(" ") : null,
      last_checked_at: new Date().toISOString(),
    };

    if (!existing) {
      inserts.push({
        user_id: userId,
        ticker: h.ticker,
        company_name: ann.companyName || h.company_name,
        source_type: "psx-announcement",
        source_url: ann.url,
        source_title: ann.title,
        source_quality: "high",
        announcement_date: announcementDate,
        announced_value_raw: pdf?.excerpt ?? ann.title,
        quantity_basis: buyDate ? "transactions" : "current_holding",
        eligibility_status: eligibility,
        eligibility_notes: eligibilityNotes,
        status,
        is_forecast: false,
        is_confirmed: autoConfirm,
        dedupe_key: dedupeKey,
        ...calcFields,
      });
    } else if (!userTouched(existing)) {
      // Recompute engine-owned events so detection is idempotent and self-healing
      // (fixes stale values, bad windows, and mis-flagged overdue/credited rows).
      upgrades.push({
        id: String(existing.id),
        patch: {
          ...calcFields,
          status,
          eligibility_status: eligibility,
          eligibility_notes: eligibilityNotes,
          announced_value_raw: pdf?.excerpt ?? ann.title,
          updated_at: new Date().toISOString(),
        },
      });
    }
  }

  // 6. Persist
  let staged = 0;
  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from("dividend_events")
      .upsert(inserts, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) errors.push(error.message);
    staged = data?.length ?? 0;
  }
  let upgraded = 0;
  for (const u of upgrades) {
    const { error } = await supabase.from("dividend_events").update(u.patch).eq("id", u.id).eq("user_id", userId);
    if (!error) upgraded++;
    else errors.push(error.message);
  }

  // 7. Refresh overdue flags on outstanding (non-credited) open events
  await supabase
    .from("dividend_events")
    .update({ status: "overdue", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("status", ["announced", "expected"])
    .neq("event_type", "credit")
    .lt("estimated_payment_end", today)
    .is("received_date", null);

  return {
    checkedTickers: list.length,
    staged,
    upgraded,
    skippedDuplicates: inserts.length - staged,
    lowConfidence,
    pdfsRead,
    errors,
  };
}
