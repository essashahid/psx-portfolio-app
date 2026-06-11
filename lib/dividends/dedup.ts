import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deduplication & reconciliation for the dividend engine.
 *
 *  - Reconciles "credited" PSX filings against the user's existing dividend
 *    ledger so an already-received payout is never also counted as upcoming.
 *  - Flags genuine duplicate dividend_events (same ticker, value, and dates, or
 *    the same source document) so totals are not double-counted.
 *
 * Both passes only touch engine-owned rows; user-confirmed/received/ignored
 * events are left exactly as the user left them.
 */

export interface DedupResult {
  reconciledWithLedger: number;
  duplicatesFlagged: number;
}

const DPS_TOLERANCE = 0.01;

function daysApart(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity;
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

interface EventRow {
  id: string;
  ticker: string;
  dividend_per_share: number | null;
  announcement_date: string | null;
  payment_date: string | null;
  source_url: string | null;
  gross_expected: number | null;
  status: string;
  event_type: string | null;
  eligibility_status: string | null;
  confidence_level: string;
  is_forecast: boolean;
  is_possible_duplicate: boolean;
  created_at: string;
}

interface LedgerRow {
  id: string;
  ticker: string | null;
  dividend_per_share: number | null;
  payment_date: string | null;
  pay_date: string | null;
  announcement_date: string | null;
}

const userTouched = (e: Pick<EventRow, "status" | "eligibility_status">) =>
  ["received", "ignored", "expected", "not_eligible"].includes(e.status) ||
  ["eligible", "not_eligible"].includes(e.eligibility_status ?? "");

export async function reconcileAndDedupe(
  supabase: SupabaseClient,
  userId: string
): Promise<DedupResult> {
  const [{ data: evRows }, { data: ledgerRows }] = await Promise.all([
    supabase
      .from("dividend_events")
      .select(
        "id, ticker, dividend_per_share, announcement_date, payment_date, source_url, gross_expected, status, event_type, eligibility_status, confidence_level, is_forecast, is_possible_duplicate, created_at"
      )
      .eq("user_id", userId)
      .eq("is_forecast", false),
    supabase
      .from("dividends")
      .select("id, ticker, dividend_per_share, payment_date, pay_date, announcement_date")
      .eq("user_id", userId)
      .eq("status", "received"),
  ]);

  const events = (evRows ?? []) as EventRow[];
  const ledger = (ledgerRows ?? []) as LedgerRow[];

  // --- Pass 1: reconcile credited filings against the received-dividend ledger
  let reconciledWithLedger = 0;
  for (const e of events) {
    if (e.event_type !== "credit") continue;
    if (userTouched(e) || e.dividend_per_share === null) continue;

    const match = ledger.find((d) => {
      if (d.ticker !== e.ticker || d.dividend_per_share === null) return false;
      if (Math.abs(Number(d.dividend_per_share) - Number(e.dividend_per_share)) > DPS_TOLERANCE) return false;
      const ledgerDate = d.payment_date ?? d.pay_date ?? d.announcement_date;
      // Same per-share value for the same ticker within a quarter is the same payout.
      return daysApart(ledgerDate, e.announcement_date) <= 120;
    });
    if (!match) continue;

    const { error } = await supabase
      .from("dividend_events")
      .update({
        status: "received",
        is_reconciled: true,
        reconciled_dividend_id: match.id,
        notes:
          "Matched to a dividend already in your ledger — counted once, not added to upcoming income.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", e.id)
      .eq("user_id", userId);
    if (!error) reconciledWithLedger++;
  }

  // --- Pass 2: flag duplicate events among themselves (same payout twice)
  let duplicatesFlagged = 0;
  const byTicker = new Map<string, EventRow[]>();
  for (const e of events) {
    if (e.status === "received") continue; // already settled above/by user
    if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, []);
    byTicker.get(e.ticker)!.push(e);
  }

  for (const group of byTicker.values()) {
    // Keep the strongest record (high confidence first, then earliest created).
    const rank = (e: EventRow) =>
      (e.confidence_level === "high" ? 0 : e.confidence_level === "medium" ? 1 : 2) * 1e13 +
      new Date(e.created_at).getTime();
    const sorted = [...group].sort((a, b) => rank(a) - rank(b));

    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      if (userTouched(cur) || cur.is_possible_duplicate) continue;
      const keeper = sorted.find((k, idx) => {
        if (idx >= i) return false;
        const sameValue =
          cur.dividend_per_share !== null &&
          k.dividend_per_share !== null &&
          Math.abs(Number(cur.dividend_per_share) - Number(k.dividend_per_share)) <= DPS_TOLERANCE;
        const closeDates = daysApart(cur.announcement_date, k.announcement_date) <= 3;
        const sameSource = !!cur.source_url && cur.source_url === k.source_url;
        return sameSource || (sameValue && closeDates);
      });
      if (!keeper) continue;

      const { error } = await supabase
        .from("dividend_events")
        .update({
          is_possible_duplicate: true,
          duplicate_of: keeper.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cur.id)
        .eq("user_id", userId);
      if (!error) duplicatesFlagged++;
    }
  }

  return { reconciledWithLedger, duplicatesFlagged };
}
