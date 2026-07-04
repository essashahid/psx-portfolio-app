import type { SupabaseClient } from "@supabase/supabase-js";
import { getTaxSettings } from "@/lib/dividends/tax";
import { round2 } from "@/lib/dividends/engine";

export interface ForecastResult {
  generated: number;
  skippedExisting: number;
  insufficientHistory: string[];
}

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
/** A declared payout older than this with no successor implies the company may have stopped paying. */
const STALE_AFTER_DAYS = 500;
/** Payment usually lands within this many days after book closure. */
const PAYMENT_LAG_DAYS = 21;
const PAYMENT_WINDOW_DAYS = 35;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --- Seasonal model (preferred): built on the company's real declared payout calendar ---

interface DeclaredPayout {
  anchor: number; // ms — book-closure end (eligibility deadline), best available proxy for timing
  announced: string; // ISO announcement date, for the basis text
  dps: number | null;
}

interface SeasonalForecast {
  windowStart: string;
  windowEnd: string;
  expectAround: string;
  dpsLow: number | null;
  dpsHigh: number | null;
  confidence: "medium" | "low";
  basis: string;
  slotCount: number;
}

/**
 * Predict the next payout from the company's own declared history using
 * SEASONALITY, not a naive fixed cadence. PSX dividends recur on the fiscal
 * calendar (e.g. a bank paying Feb-final / Apr-interim / Aug / Oct), and the
 * gaps between those slots are uneven — a median-cadence model mistimes them
 * badly (it was what put MEBL's next payout in July when the real slot is
 * August). Instead we project each historical payout forward to its next
 * anniversary and take the earliest one still in the future: that lands the
 * forecast in the same fiscal window the company has actually used before.
 */
function seasonalForecast(payouts: DeclaredPayout[], today: number): SeasonalForecast | null {
  const dated = payouts.filter((p) => Number.isFinite(p.anchor)).sort((a, b) => a.anchor - b.anchor);
  if (dated.length < 2) return null;

  const first = dated[0].anchor;
  const last = dated[dated.length - 1].anchor;
  const span = last - first;
  // Need roughly a fiscal year of history for a seasonal signal.
  if (span < 300 * DAY_MS) return null;
  // If the newest declaration is very old with nothing since, treat the payer as
  // dormant rather than forecasting a payout it has stopped making.
  if (today - last > STALE_AFTER_DAYS * DAY_MS) return null;

  // Project every historical slot to its next occurrence at/after today.
  const projected = dated
    .map((p) => {
      const k = Math.max(1, Math.ceil((today - p.anchor) / YEAR_MS));
      return p.anchor + k * YEAR_MS;
    })
    .filter((t) => t >= today - 10 * DAY_MS)
    .sort((a, b) => a - b);
  if (projected.length === 0) return null;

  const nextAnchor = projected[0];
  const windowStart = new Date(nextAnchor).toISOString().slice(0, 10);
  const windowEnd = new Date(nextAnchor + PAYMENT_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const expectAround = new Date(nextAnchor + PAYMENT_LAG_DAYS * DAY_MS).toISOString().slice(0, 10);

  // Amount range from the most recent declared per-share values.
  const recentDps = dated
    .slice(-4)
    .map((p) => p.dps)
    .filter((v): v is number => v !== null && v > 0);
  const dpsLow = recentDps.length ? Math.min(...recentDps) : null;
  const dpsHigh = recentDps.length ? Math.max(...recentDps) : null;

  // "Medium" once we have seen the fiscal slots recur across at least one full
  // year with a real rhythm (>= 4 declared payouts); thinner history stays "low".
  // Forecasts never reach "high" — that tier is reserved for actual announcements.
  const confidence: "medium" | "low" = span >= 350 * DAY_MS && dated.length >= 4 ? "medium" : "low";

  const recentDates = dated.slice(-3).map((p) => p.announced).filter(Boolean);
  const dpsText =
    dpsLow !== null ? `; recent declared DPS Rs ${dpsLow}${dpsHigh !== dpsLow ? `–${dpsHigh}` : ""}` : "";
  const basis =
    `${dated.length} declared cash payout(s), latest ${recentDates[recentDates.length - 1] ?? "n/a"}${dpsText}. ` +
    `Projected from the company's declared payout calendar (same fiscal slot as prior years), not an announcement.`;

  return { windowStart, windowEnd, expectAround, dpsLow, dpsHigh, confidence, basis, slotCount: dated.length };
}

// --- Fallback model: cadence from the user's own received-dividend dates ---

interface HistoryPoint {
  date: string;
  gross: number;
  dps: number | null;
}

interface CadenceForecast {
  windowStart: string;
  windowEnd: string;
  announceStart: string;
  dpsLow: number | null;
  dpsHigh: number | null;
  grossLow: number;
  grossHigh: number;
  confidence: "medium" | "low";
  basis: string;
}

/** Legacy cadence extrapolation, used only when we hold no declared history for the ticker. */
function cadenceForecast(points: HistoryPoint[], quantity: number): CadenceForecast | null {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / DAY_MS);
  }
  const cadenceDays = Math.max(60, Math.min(370, median(gaps)));
  const last = sorted[sorted.length - 1];
  let nextCenter = Date.parse(last.date) + cadenceDays * DAY_MS;
  while (nextCenter + 21 * DAY_MS < Date.now()) nextCenter += cadenceDays * DAY_MS;
  const windowStart = new Date(nextCenter - 21 * DAY_MS).toISOString().slice(0, 10);
  const windowEnd = new Date(nextCenter + 21 * DAY_MS).toISOString().slice(0, 10);
  const announceStart = new Date(nextCenter - 45 * DAY_MS).toISOString().slice(0, 10);

  const recent = sorted.slice(-4);
  const dpsValues = recent.map((p) => p.dps).filter((v): v is number => v !== null && v > 0);
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

  const confidence: "medium" | "low" = sorted.length >= 4 ? "medium" : "low";
  const basis =
    `${sorted.length} received payout(s) since ${sorted[0].date}; ~${Math.round(cadenceDays)}-day cycle; ` +
    `last payment ${last.date}${dpsValues.length >= 2 ? `; recent DPS Rs ${dpsLow}–${dpsHigh}` : " (range from past gross amounts — share count may differ)"}. ` +
    `No declared calendar on file — projected from your own payment history.`;

  return { windowStart, windowEnd, announceStart, dpsLow, dpsHigh, grossLow, grossHigh, confidence, basis };
}

/**
 * "Generate dividend forecasts": projects each holding's next payout. Prefers the
 * company's real declared payout calendar (`company_payouts`) with a seasonal
 * model, falling back to the user's own received-dividend cadence only when no
 * declared history is on file. Every generated event is is_forecast=true, status
 * "forecasted", and labeled as a projection — never an announcement. A confirmed
 * announcement near the same window suppresses the forecast.
 */
export async function generateDividendForecasts(
  supabase: SupabaseClient,
  userId: string
): Promise<ForecastResult> {
  const tax = await getTaxSettings(supabase, userId);
  const today = new Date().toISOString().slice(0, 10);
  const todayMs = Date.now();

  const { data: holdings } = await supabase
    .from("holdings")
    .select("ticker, company_name, quantity")
    .eq("user_id", userId)
    .gt("quantity", 0);
  const holdingList = holdings ?? [];
  const tickers = holdingList.map((h) => String(h.ticker));

  const [{ data: history }, { data: openEvents }, { data: declared }] = await Promise.all([
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
    tickers.length > 0
      ? supabase
          .from("company_payouts")
          .select("ticker, kind, dividend_per_share, announcement_date, book_closure_start, book_closure_end")
          .in("ticker", tickers)
          .eq("kind", "cash")
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  // Personal received history (fallback source), grouped by ticker.
  const personalByTicker = new Map<string, HistoryPoint[]>();
  for (const d of history ?? []) {
    const date = d.payment_date ?? d.pay_date;
    if (!d.ticker || !date) continue;
    const list = personalByTicker.get(d.ticker) ?? [];
    list.push({
      date: String(date),
      gross: Number(d.amount ?? 0),
      dps: d.dividend_per_share != null ? Number(d.dividend_per_share) : null,
    });
    personalByTicker.set(d.ticker, list);
  }

  // Declared payout calendar (preferred source), grouped by ticker.
  const declaredByTicker = new Map<string, DeclaredPayout[]>();
  for (const p of declared ?? []) {
    const row = p as {
      ticker: string;
      dividend_per_share: number | null;
      announcement_date: string | null;
      book_closure_start: string | null;
      book_closure_end: string | null;
    };
    const anchorStr = row.book_closure_end ?? row.book_closure_start ?? row.announcement_date;
    if (!row.ticker || !anchorStr) continue;
    const anchor = Date.parse(anchorStr);
    if (!Number.isFinite(anchor)) continue;
    const list = declaredByTicker.get(row.ticker) ?? [];
    list.push({
      anchor,
      announced: row.announcement_date ?? anchorStr,
      dps: row.dividend_per_share != null ? Number(row.dividend_per_share) : null,
    });
    declaredByTicker.set(row.ticker, list);
  }

  const rate = tax.dividend_tax_rate;
  const insufficientHistory: string[] = [];
  const records: Record<string, unknown>[] = [];

  for (const h of holdingList) {
    const ticker = String(h.ticker);
    const quantity = Number(h.quantity);

    let windowStart: string;
    let windowEnd: string;
    let announceStart: string;
    let dpsLow: number | null;
    let dpsHigh: number | null;
    let grossLow: number;
    let grossHigh: number;
    let confidence: "medium" | "low";
    let basis: string;
    let sourceType: string;
    let sourceQuality: string;

    const seasonal = seasonalForecast(declaredByTicker.get(ticker) ?? [], todayMs);
    if (seasonal) {
      windowStart = seasonal.windowStart;
      windowEnd = seasonal.windowEnd;
      // Give the "already announced?" suppression check a lead window before the slot.
      announceStart = new Date(Date.parse(seasonal.windowStart) - 45 * DAY_MS).toISOString().slice(0, 10);
      dpsLow = seasonal.dpsLow;
      dpsHigh = seasonal.dpsHigh;
      grossLow = dpsLow !== null ? round2(quantity * dpsLow) : 0;
      grossHigh = dpsHigh !== null ? round2(quantity * dpsHigh) : 0;
      confidence = seasonal.confidence;
      basis = seasonal.basis;
      sourceType = "declared-calendar";
      sourceQuality = "high";
    } else {
      const cadence = cadenceForecast(personalByTicker.get(ticker) ?? [], quantity);
      if (!cadence) {
        insufficientHistory.push(ticker);
        continue;
      }
      windowStart = cadence.windowStart;
      windowEnd = cadence.windowEnd;
      announceStart = cadence.announceStart;
      dpsLow = cadence.dpsLow;
      dpsHigh = cadence.dpsHigh;
      grossLow = cadence.grossLow;
      grossHigh = cadence.grossHigh;
      confidence = cadence.confidence;
      basis = cadence.basis;
      sourceType = "history";
      sourceQuality = "medium";
    }

    // A confirmed/staged announcement near this window makes the forecast redundant.
    const hasConfirmed = (openEvents ?? []).some(
      (e) =>
        e.ticker === ticker &&
        !e.is_forecast &&
        e.estimated_payment_end !== null &&
        e.estimated_payment_end >= announceStart
    );
    if (hasConfirmed) continue;

    const netLow = rate !== null ? round2(grossLow * (1 - rate)) : null;
    const netHigh = rate !== null ? round2(grossHigh * (1 - rate)) : null;

    records.push({
      user_id: userId,
      ticker,
      company_name: h.company_name,
      event_type: "forecast",
      source_type: sourceType,
      source_quality: sourceQuality,
      estimated_payment_start: windowStart,
      estimated_payment_end: windowEnd,
      dividend_type: "cash",
      quantity_basis: "current_holding",
      eligible_quantity: quantity,
      eligibility_status: "unknown",
      eligibility_notes:
        "Forecast only — eligibility depends on holding the stock at a future, unannounced ex-date.",
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
      notes: "Forecast only — not announced. Timing is seasonal and approximate.",
      dedupe_key: `forecast:${ticker}:${windowStart.slice(0, 7)}`,
      last_checked_at: new Date().toISOString(),
    });
  }

  // Clear engine-owned forecasts for held tickers before regenerating, so a
  // changed projection (new data, or the model itself) fully replaces the stale
  // one instead of leaving both. Only status "forecasted" rows are removed —
  // once a user acts on a forecast its status changes and it is left untouched.
  if (tickers.length > 0) {
    await supabase
      .from("dividend_events")
      .delete()
      .eq("user_id", userId)
      .eq("is_forecast", true)
      .eq("status", "forecasted")
      .in("ticker", tickers);
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

  // Expire any remaining forecasts (e.g. for no-longer-held tickers) whose window has passed.
  await supabase
    .from("dividend_events")
    .update({ status: "ignored", notes: "Forecast window passed without an announcement." })
    .eq("user_id", userId)
    .eq("status", "forecasted")
    .lt("estimated_payment_end", today);

  return { generated, skippedExisting: records.length - generated, insufficientHistory };
}
