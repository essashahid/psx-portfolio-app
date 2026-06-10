import type { SupabaseClient } from "@supabase/supabase-js";
import { getTaxSettings } from "@/lib/dividends/tax";
import { round2 } from "@/lib/dividends/engine";

export interface ForecastResult {
  generated: number;
  skippedExisting: number;
  insufficientHistory: string[];
}

interface HistoryPoint {
  date: string; // payment date
  gross: number;
  dps: number | null;
}

const DAY_MS = 86_400_000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * "Generate dividend forecasts": projects the next payout per holding from the
 * user's own dividend history (payment cadence + recent per-share values).
 * Every generated event is is_forecast=true, status "forecasted", and labeled
 * "Forecast only — not announced". Existing confirmed events in the same
 * window suppress the forecast.
 */
export async function generateDividendForecasts(
  supabase: SupabaseClient,
  userId: string
): Promise<ForecastResult> {
  const tax = await getTaxSettings(supabase, userId);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: holdings }, { data: history }, { data: openEvents }] = await Promise.all([
    supabase.from("holdings").select("ticker, company_name, quantity").eq("user_id", userId).gt("quantity", 0),
    supabase
      .from("dividends")
      .select("ticker, payment_date, pay_date, amount, dividend_per_share, status")
      .eq("user_id", userId)
      .eq("status", "received"),
    supabase
      .from("dividend_events")
      .select("ticker, estimated_payment_start, estimated_payment_end, is_forecast, status")
      .eq("user_id", userId)
      .in("status", ["announced", "expected", "needs_review"]),
  ]);

  const byTicker = new Map<string, HistoryPoint[]>();
  for (const d of history ?? []) {
    const date = d.payment_date ?? d.pay_date;
    if (!d.ticker || !date) continue;
    const list = byTicker.get(d.ticker) ?? [];
    list.push({
      date: String(date),
      gross: Number(d.amount ?? 0),
      dps: d.dividend_per_share !== null && d.dividend_per_share !== undefined ? Number(d.dividend_per_share) : null,
    });
    byTicker.set(d.ticker, list);
  }

  const insufficientHistory: string[] = [];
  const records: Record<string, unknown>[] = [];

  for (const h of holdings ?? []) {
    const points = (byTicker.get(h.ticker) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (points.length < 2) {
      insufficientHistory.push(h.ticker);
      continue;
    }

    // Cadence: median gap between consecutive payments
    const gaps: number[] = [];
    for (let i = 1; i < points.length; i++) {
      gaps.push((Date.parse(points[i].date) - Date.parse(points[i - 1].date)) / DAY_MS);
    }
    const cadenceDays = Math.max(60, Math.min(370, median(gaps)));
    const last = points[points.length - 1];
    let nextCenter = Date.parse(last.date) + cadenceDays * DAY_MS;
    // Roll forward until the window is in the future
    while (nextCenter + 21 * DAY_MS < Date.now()) nextCenter += cadenceDays * DAY_MS;
    const windowStart = new Date(nextCenter - 21 * DAY_MS).toISOString().slice(0, 10);
    const windowEnd = new Date(nextCenter + 21 * DAY_MS).toISOString().slice(0, 10);
    const announceStart = new Date(nextCenter - 45 * DAY_MS).toISOString().slice(0, 10);

    // A confirmed/staged announcement near this window makes the forecast redundant
    const hasConfirmed = (openEvents ?? []).some(
      (e) =>
        e.ticker === h.ticker &&
        !e.is_forecast &&
        e.estimated_payment_end !== null &&
        e.estimated_payment_end >= announceStart
    );
    if (hasConfirmed) continue;

    // Per-share range from recent history (last 4 payouts with DPS); fall back to gross amounts
    const recent = points.slice(-4);
    const dpsValues = recent.map((p) => p.dps).filter((v): v is number => v !== null && v > 0);
    const quantity = Number(h.quantity);
    let dpsLow: number | null = null;
    let dpsHigh: number | null = null;
    let grossLow: number;
    let grossHigh: number;
    if (dpsValues.length >= 2) {
      dpsLow = Math.min(...dpsValues);
      dpsHigh = Math.max(...dpsValues);
      grossLow = round2(quantity * dpsLow);
      grossHigh = round2(quantity * dpsHigh);
    } else {
      const grossValues = recent.map((p) => p.gross).filter((g) => g > 0);
      grossLow = round2(Math.min(...grossValues));
      grossHigh = round2(Math.max(...grossValues));
    }
    const rate = tax.dividend_tax_rate;
    const netLow = rate !== null ? round2(grossLow * (1 - rate)) : null;
    const netHigh = rate !== null ? round2(grossHigh * (1 - rate)) : null;

    const confidence = points.length >= 4 ? "medium" : "low";
    const basis = `${points.length} received payout(s) since ${points[0].date}; ~${Math.round(cadenceDays)}-day cycle; last payment ${last.date}${dpsValues.length >= 2 ? `; recent DPS Rs ${dpsLow}–${dpsHigh}` : " (range from past gross amounts — share count may differ)"}`;

    records.push({
      user_id: userId,
      ticker: h.ticker,
      company_name: h.company_name,
      event_type: "forecast",
      source_type: "history",
      source_quality: "medium",
      estimated_payment_start: windowStart,
      estimated_payment_end: windowEnd,
      dividend_type: "cash",
      quantity_basis: "current_holding",
      eligible_quantity: quantity,
      eligibility_status: "unknown",
      eligibility_notes: "Forecast only — eligibility depends on holding the stock at a future, unannounced ex-date.",
      taxpayer_status: tax.taxpayer_status,
      tax_rate: rate,
      tax_rate_configured: rate !== null,
      dps_low: dpsLow,
      dps_high: dpsHigh,
      gross_low: grossLow,
      gross_high: grossHigh,
      net_low: netLow,
      net_high: netHigh,
      status: "forecasted",
      confidence_level: confidence,
      forecast_basis: basis,
      is_forecast: true,
      is_confirmed: false,
      notes: "Forecast only — not announced.",
      dedupe_key: `forecast:${h.ticker}:${windowStart.slice(0, 7)}`,
      last_checked_at: new Date().toISOString(),
    });
  }

  let generated = 0;
  if (records.length > 0) {
    const { data, error } = await supabase
      .from("dividend_events")
      .upsert(records, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    generated = data?.length ?? 0;
  }

  // Expire forecasts whose window has fully passed
  await supabase
    .from("dividend_events")
    .update({ status: "ignored", notes: "Forecast window passed without an announcement." })
    .eq("user_id", userId)
    .eq("status", "forecasted")
    .lt("estimated_payment_end", today);

  return { generated, skippedExisting: records.length - generated, insufficientHistory };
}
