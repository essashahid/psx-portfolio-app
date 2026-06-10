import type { TaxSettings } from "@/lib/dividends/tax";

export type EligibilityStatus =
  | "eligible"
  | "likely_eligible"
  | "not_eligible"
  | "unknown"
  | "needs_confirmation";

export type DividendEventStatus =
  | "announced"
  | "expected"
  | "received"
  | "overdue"
  | "not_eligible"
  | "ignored"
  | "needs_review"
  | "forecasted";

export interface DividendEvent {
  id: string;
  ticker: string;
  company_name: string | null;
  event_type: string;
  source_type: string | null;
  source_url: string | null;
  source_title: string | null;
  source_quality: string | null;
  announcement_date: string | null;
  board_meeting_date: string | null;
  ex_date: string | null;
  book_closure_start: string | null;
  book_closure_end: string | null;
  payment_date: string | null;
  estimated_payment_start: string | null;
  estimated_payment_end: string | null;
  dividend_type: string;
  announced_value_raw: string | null;
  dividend_percentage: number | null;
  face_value: number | null;
  face_value_assumed: boolean;
  dividend_per_share: number | null;
  quantity_basis: string | null;
  eligible_quantity: number | null;
  eligibility_status: EligibilityStatus;
  eligibility_notes: string | null;
  gross_expected: number | null;
  taxpayer_status: string | null;
  tax_rate: number | null;
  tax_rate_configured: boolean;
  needs_tax_review: boolean;
  estimated_tax: number | null;
  net_expected: number | null;
  received_date: string | null;
  gross_received: number | null;
  tax_deducted_actual: number | null;
  actual_tax_rate: number | null;
  net_received: number | null;
  variance_amount: number | null;
  status: DividendEventStatus;
  confidence_level: "high" | "medium" | "low";
  forecast_basis: string | null;
  dps_low: number | null;
  dps_high: number | null;
  gross_low: number | null;
  gross_high: number | null;
  net_low: number | null;
  net_high: number | null;
  is_forecast: boolean;
  is_confirmed: boolean;
  is_reconciled: boolean;
  notes: string | null;
  dedupe_key: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function normalizeEvent(row: Record<string, unknown>): DividendEvent {
  return {
    id: String(row.id),
    ticker: String(row.ticker),
    company_name: str(row.company_name),
    event_type: String(row.event_type ?? "announcement"),
    source_type: str(row.source_type),
    source_url: str(row.source_url),
    source_title: str(row.source_title),
    source_quality: str(row.source_quality),
    announcement_date: str(row.announcement_date),
    board_meeting_date: str(row.board_meeting_date),
    ex_date: str(row.ex_date),
    book_closure_start: str(row.book_closure_start),
    book_closure_end: str(row.book_closure_end),
    payment_date: str(row.payment_date),
    estimated_payment_start: str(row.estimated_payment_start),
    estimated_payment_end: str(row.estimated_payment_end),
    dividend_type: String(row.dividend_type ?? "cash"),
    announced_value_raw: str(row.announced_value_raw),
    dividend_percentage: num(row.dividend_percentage),
    face_value: num(row.face_value),
    face_value_assumed: Boolean(row.face_value_assumed),
    dividend_per_share: num(row.dividend_per_share),
    quantity_basis: str(row.quantity_basis),
    eligible_quantity: num(row.eligible_quantity),
    eligibility_status: (row.eligibility_status as EligibilityStatus) ?? "unknown",
    eligibility_notes: str(row.eligibility_notes),
    gross_expected: num(row.gross_expected),
    taxpayer_status: str(row.taxpayer_status),
    tax_rate: num(row.tax_rate),
    tax_rate_configured: Boolean(row.tax_rate_configured ?? true),
    needs_tax_review: Boolean(row.needs_tax_review),
    estimated_tax: num(row.estimated_tax),
    net_expected: num(row.net_expected),
    received_date: str(row.received_date),
    gross_received: num(row.gross_received),
    tax_deducted_actual: num(row.tax_deducted_actual),
    actual_tax_rate: num(row.actual_tax_rate),
    net_received: num(row.net_received),
    variance_amount: num(row.variance_amount),
    status: (row.status as DividendEventStatus) ?? "announced",
    confidence_level: (row.confidence_level as "high" | "medium" | "low") ?? "medium",
    forecast_basis: str(row.forecast_basis),
    dps_low: num(row.dps_low),
    dps_high: num(row.dps_high),
    gross_low: num(row.gross_low),
    gross_high: num(row.gross_high),
    net_low: num(row.net_low),
    net_high: num(row.net_high),
    is_forecast: Boolean(row.is_forecast),
    is_confirmed: Boolean(row.is_confirmed),
    is_reconciled: Boolean(row.is_reconciled),
    notes: str(row.notes),
    dedupe_key: String(row.dedupe_key),
    last_checked_at: str(row.last_checked_at),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Derive per-share value: explicit DPS wins; otherwise percentage × face value.
 * Returns the face value actually used and whether it was assumed.
 */
export function deriveDps(input: {
  dividend_per_share: number | null;
  dividend_percentage: number | null;
  face_value: number | null;
  default_face_value: number;
}): { dps: number | null; faceValueUsed: number | null; faceValueAssumed: boolean } {
  if (input.dividend_per_share !== null && input.dividend_per_share > 0) {
    return { dps: input.dividend_per_share, faceValueUsed: input.face_value, faceValueAssumed: false };
  }
  if (input.dividend_percentage !== null && input.dividend_percentage > 0) {
    const assumed = input.face_value === null;
    const fv = input.face_value ?? input.default_face_value;
    return { dps: round2((fv * input.dividend_percentage) / 100), faceValueUsed: fv, faceValueAssumed: assumed };
  }
  return { dps: null, faceValueUsed: input.face_value, faceValueAssumed: false };
}

/** Gross = eligible qty × DPS; tax = gross × configured rate; net = gross − tax. */
export function computeAmounts(
  eligibleQuantity: number | null,
  dps: number | null,
  tax: TaxSettings
): { gross: number | null; estimatedTax: number | null; net: number | null } {
  if (eligibleQuantity === null || dps === null) return { gross: null, estimatedTax: null, net: null };
  const gross = round2(eligibleQuantity * dps);
  if (tax.dividend_tax_rate === null) return { gross, estimatedTax: null, net: null };
  const estimatedTax = round2(gross * tax.dividend_tax_rate);
  return { gross, estimatedTax, net: round2(gross - estimatedTax) };
}

/** Adds N working days (Mon–Fri) to a date. */
export function addWorkingDays(fromDate: string, days: number): string {
  const d = new Date(`${fromDate}T00:00:00Z`);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Payment window: exact date if known; otherwise estimated from book closure
 * end (preferred) or announcement date plus the configured working-day window.
 */
export function estimatePaymentWindow(
  event: Pick<
    DividendEvent,
    "payment_date" | "book_closure_end" | "book_closure_start" | "ex_date" | "announcement_date"
  >,
  windowDays: number
): { start: string | null; end: string | null; exact: boolean } {
  if (event.payment_date) return { start: event.payment_date, end: event.payment_date, exact: true };
  const anchor = event.book_closure_end ?? event.book_closure_start ?? event.ex_date ?? event.announcement_date;
  if (!anchor) return { start: null, end: null, exact: false };
  return { start: addWorkingDays(anchor, 5), end: addWorkingDays(anchor, windowDays), exact: false };
}

/** An expected/announced event whose payment window has fully passed is overdue. */
export function isOverdue(event: DividendEvent, today: string): boolean {
  if (event.status !== "announced" && event.status !== "expected") return false;
  const windowEnd = event.payment_date ?? event.estimated_payment_end;
  return windowEnd !== null && windowEnd < today;
}

/** Reconcile actuals against expectations. "Reasonable" = within 5% or Rs 50. */
export function reconcile(
  expected: { gross: number | null; net: number | null },
  actual: { gross: number; tax: number; net: number }
): { variance: number; reconciled: boolean; actualRate: number | null } {
  const expectedNet = expected.net ?? expected.gross ?? actual.net;
  const variance = round2(actual.net - expectedNet);
  const tolerance = Math.max(50, expectedNet * 0.05);
  const actualRate = actual.gross > 0 ? round2((actual.tax / actual.gross) * 10000) / 10000 : null;
  return { variance, reconciled: Math.abs(variance) <= tolerance, actualRate };
}
