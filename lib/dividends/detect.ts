import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyAnnouncements, type PsxAnnouncement } from "@/lib/news/psx-announcements";
import { getTaxSettings } from "@/lib/dividends/tax";
import {
  computeAmounts,
  deriveDps,
  estimatePaymentWindow,
  type EligibilityStatus,
} from "@/lib/dividends/engine";

const ANNOUNCEMENTS_PER_TICKER = 10;
const BATCH_SIZE = 4;

export interface DetectResult {
  checkedTickers: number;
  staged: number;
  skippedDuplicates: number;
  lowConfidence: number;
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
 */
export function parseDividendTitle(title: string): ParsedAnnouncement | null {
  const t = title.toLowerCase();
  const mentionsDividend = /\b(dividend|payout|bonus|right)\b/.test(t);
  if (!mentionsDividend) return null;
  // Exclude pure scheduling notices with no value (still useful, but value-less)
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

/**
 * "Check upcoming dividends": scans official PSX company announcements for
 * every holding, parses dividend declarations, computes expected gross/tax/net
 * with the user's filer tax profile, and stages dividend_events for review.
 * Never overwrites user-edited events (upsert ignores dedupe-key conflicts).
 */
export async function checkUpcomingDividends(
  supabase: SupabaseClient,
  userId: string
): Promise<DetectResult> {
  const tax = await getTaxSettings(supabase, userId);
  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  const [{ data: holdings }, { data: masters }] = await Promise.all([
    supabase
      .from("holdings")
      .select("ticker, company_name, quantity")
      .eq("user_id", userId)
      .gt("quantity", 0),
    supabase.from("stock_master").select("ticker, face_value"),
  ]);
  const faceValues = new Map((masters ?? []).map((m) => [String(m.ticker), m.face_value !== null ? Number(m.face_value) : null]));
  const list = holdings ?? [];
  if (list.length === 0) return { checkedTickers: 0, staged: 0, skippedDuplicates: 0, lowConfidence: 0, errors };

  // Earliest buy per ticker for eligibility checks
  const { data: txns } = await supabase
    .from("transactions")
    .select("ticker, trade_date, type")
    .eq("user_id", userId)
    .eq("type", "buy")
    .order("trade_date", { ascending: true });
  const firstBuy = new Map<string, string>();
  for (const t of txns ?? []) {
    if (!firstBuy.has(t.ticker)) firstBuy.set(t.ticker, t.trade_date);
  }

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

  const records: Record<string, unknown>[] = [];
  let lowConfidence = 0;

  for (const h of list) {
    const quantity = Number(h.quantity);
    for (const ann of announcementsByTicker.get(h.ticker) ?? []) {
      const parsed = parseDividendTitle(ann.title);
      if (!parsed || parsed.dividendType === "right") continue; // rights issues are not receivables
      const announcementDate = psxDateToIso(ann.date);

      const tickerFace = faceValues.get(h.ticker) ?? null;
      const { dps, faceValueUsed, faceValueAssumed } = deriveDps({
        dividend_per_share: parsed.rupeesPerShare,
        dividend_percentage: parsed.percentage,
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

      const window = estimatePaymentWindow(
        {
          payment_date: null,
          book_closure_end: null,
          book_closure_start: null,
          ex_date: null,
          announcement_date: announcementDate,
        },
        tax.default_payment_window_days
      );

      const amounts = computeAmounts(quantity, dps, tax);
      const valueParsed = dps !== null;
      const isCash = parsed.dividendType === "cash";
      const confidence = valueParsed && isCash ? "high" : valueParsed ? "medium" : "low";
      if (confidence === "low") lowConfidence++;

      const autoConfirm = tax.auto_create_confirmed && confidence === "high";
      records.push({
        user_id: userId,
        ticker: h.ticker,
        company_name: ann.companyName || h.company_name,
        event_type: "announcement",
        source_type: "psx-announcement",
        source_url: ann.url,
        source_title: ann.title,
        source_quality: "high",
        announcement_date: announcementDate,
        estimated_payment_start: window.start,
        estimated_payment_end: window.end,
        dividend_type: parsed.dividendType,
        announced_value_raw: ann.title,
        dividend_percentage: parsed.percentage,
        face_value: faceValueUsed,
        face_value_assumed: faceValueAssumed,
        dividend_per_share: dps,
        quantity_basis: buyDate ? "transactions" : "current_holding",
        eligible_quantity: quantity,
        eligibility_status: eligibility,
        eligibility_notes: eligibilityNotes,
        gross_expected: amounts.gross,
        taxpayer_status: tax.taxpayer_status,
        tax_rate: tax.dividend_tax_rate,
        tax_rate_configured: tax.dividend_tax_rate !== null,
        needs_tax_review: !isCash, // bonus/other categories can have different treatment
        estimated_tax: amounts.estimatedTax,
        net_expected: amounts.net,
        status: autoConfirm ? "announced" : "needs_review",
        confidence_level: confidence,
        is_forecast: false,
        is_confirmed: autoConfirm,
        notes: faceValueAssumed && parsed.percentage !== null
          ? "Face value not confirmed. Calculation uses default face value."
          : null,
        dedupe_key: `psx:${h.ticker}:${announcementDate ?? "nodate"}:${simpleHash(ann.title)}`,
        last_checked_at: new Date().toISOString(),
      });
    }
  }

  let staged = 0;
  if (records.length > 0) {
    const { data, error } = await supabase
      .from("dividend_events")
      .upsert(records, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) errors.push(error.message);
    staged = data?.length ?? 0;
  }

  // Refresh last_checked_at + overdue flags on existing open events
  await supabase
    .from("dividend_events")
    .update({ status: "overdue", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("status", ["announced", "expected"])
    .lt("estimated_payment_end", today)
    .is("received_date", null);

  return {
    checkedTickers: list.length,
    staged,
    skippedDuplicates: records.length - staged,
    lowConfidence,
    errors,
  };
}
