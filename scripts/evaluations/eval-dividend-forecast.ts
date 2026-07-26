/**
 * How accurate is the upcoming-dividend forecaster?
 *
 * Walk-forward backtest on the real declared payout calendar. For every company
 * with enough history, hide its most recent payout, forecast from what remains,
 * then score the prediction against the payout we hid:
 *
 *   - timing: signed error in days between the predicted book-closure anchor and
 *     the actual one, plus whether the actual landed inside the quoted window
 *   - amount: whether the actual DPS landed inside the quoted Rs range
 *
 * Two baselines, because a model that cannot beat a one-line rule is not a
 * model (see the naive-rule discipline the outlook engine follows):
 *
 *   naive-anniversary: the last payout's date plus 365 days
 *   naive-cadence:     the last payout plus the median gap between payouts
 *
 * The seasonal model must beat both on median absolute timing error to justify
 * its complexity.
 *
 *   npx tsx scripts/evaluations/eval-dividend-forecast.ts
 */
import { loadEnvLocal } from "../lib/load-env";

loadEnvLocal();

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
const PAYMENT_WINDOW_DAYS = 35;
const PAYMENT_LAG_DAYS = 21;

interface Payout {
  anchor: number;
  dps: number | null;
}

/** The shipped seasonal model, reduced to its timing decision. */
function seasonalAnchor(history: Payout[], asOf: number): number | null {
  if (history.length < 2) return null;
  const dated = [...history].sort((a, b) => a.anchor - b.anchor);
  if (dated[dated.length - 1].anchor - dated[0].anchor < 300 * DAY_MS) return null;
  const projected = dated
    .map((p) => p.anchor + Math.max(1, Math.ceil((asOf - p.anchor) / YEAR_MS)) * YEAR_MS)
    .filter((t) => t >= asOf - 10 * DAY_MS)
    .sort((a, b) => a - b);
  return projected[0] ?? null;
}

/**
 * Candidate: project only slots the company has actually REPEATED.
 *
 * The shipped rule takes the earliest future anniversary of any historical
 * payout, so a one-off special dividend creates a phantom annual slot and the
 * forecast fires weeks early. Requiring a slot to appear in at least two
 * distinct years before it is projected should remove that bias.
 */
function recurringSlotAnchor(history: Payout[], asOf: number): number | null {
  if (history.length < 2) return null;
  const dated = [...history].sort((a, b) => a.anchor - b.anchor);
  if (dated[dated.length - 1].anchor - dated[0].anchor < 300 * DAY_MS) return null;
  const dayOf = (t: number) => { const d = new Date(t); return d.getUTCMonth() * 30 + d.getUTCDate(); };
  const yearOf = (t: number) => new Date(t).getUTCFullYear();
  const repeated = dated.filter((p) => {
    const years = new Set(
      dated.filter((q) => {
        const diff = Math.abs(dayOf(q.anchor) - dayOf(p.anchor));
        return Math.min(diff, 360 - diff) <= 45;
      }).map((q) => yearOf(q.anchor))
    );
    return years.size >= 2;
  });
  const pool = repeated.length ? repeated : dated;
  const projected = pool
    .map((p) => p.anchor + Math.max(1, Math.ceil((asOf - p.anchor) / YEAR_MS)) * YEAR_MS)
    .filter((t) => t >= asOf - 10 * DAY_MS)
    .sort((a, b) => a - b);
  return projected[0] ?? null;
}

/** Baseline: last payout plus one calendar year. */
function naiveAnniversary(history: Payout[]): number | null {
  if (!history.length) return null;
  return Math.max(...history.map((p) => p.anchor)) + 365 * DAY_MS;
}

/** Baseline: last payout plus the median gap. */
function naiveCadence(history: Payout[]): number | null {
  const dated = [...history].sort((a, b) => a.anchor - b.anchor);
  if (dated.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dated.length; i++) gaps.push(dated[i].anchor - dated[i - 1].anchor);
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return dated[dated.length - 1].anchor + median;
}

/** Shipped amount range: min/max DPS over the last four payouts, any slot. */
function lastFourRange(history: Payout[]): [number, number] | null {
  const vals = [...history]
    .sort((a, b) => a.anchor - b.anchor)
    .slice(-4)
    .map((p) => p.dps)
    .filter((v): v is number => v !== null && v > 0);
  return vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
}

/**
 * Candidate amount range: DPS from the SAME fiscal slot in prior years.
 * A company paying a large final and a small interim gets a tight per-slot
 * range instead of one band spanning both.
 */
function sameSlotRange(history: Payout[], predictedAnchor: number): [number, number] | null {
  const target = new Date(predictedAnchor);
  const targetDay = target.getUTCMonth() * 30 + target.getUTCDate();
  const near = history.filter((p) => {
    if (p.dps === null || p.dps <= 0) return false;
    const d = new Date(p.anchor);
    const day = d.getUTCMonth() * 30 + d.getUTCDate();
    const diff = Math.min(Math.abs(day - targetDay), 360 - Math.abs(day - targetDay));
    return diff <= 45;
  });
  const vals = near.map((p) => p.dps as number);
  return vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
}

function stats(values: number[]) {
  if (!values.length) return { n: 0, median: NaN, mean: NaN, within14: NaN, within30: NaN };
  const abs = values.map(Math.abs).sort((a, b) => a - b);
  const mid = Math.floor(abs.length / 2);
  return {
    n: abs.length,
    median: abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2,
    mean: abs.reduce((s, v) => s + v, 0) / abs.length,
    within14: abs.filter((v) => v <= 14).length / abs.length,
    within30: abs.filter((v) => v <= 30).length / abs.length,
  };
}

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  // Paginated: the payout table is well past the PostgREST 1000-row response cap.
  const rows: { ticker: string; dps: number | null; anchor: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("company_payouts")
      .select("ticker, dividend_per_share, announcement_date, book_closure_start, book_closure_end")
      .eq("kind", "cash")
      .order("ticker")
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      const anchor = r.book_closure_end ?? r.book_closure_start ?? r.announcement_date;
      if (anchor) rows.push({ ticker: r.ticker, dps: r.dividend_per_share, anchor });
    }
    if (data.length < 1000) break;
  }

  const byTicker = new Map<string, Payout[]>();
  for (const r of rows) {
    const anchor = Date.parse(r.anchor);
    if (!Number.isFinite(anchor)) continue;
    const list = byTicker.get(r.ticker) ?? [];
    list.push({ anchor, dps: r.dps !== null ? Number(r.dps) : null });
    byTicker.set(r.ticker, list);
  }

  const seasonalErr: number[] = [];
  const anniversaryErr: number[] = [];
  const cadenceErr: number[] = [];
  const recurringErr: number[] = [];
  let recurWindowHits = 0;
  let windowHits = 0;
  let windowTotal = 0;
  let lastFourHits = 0;
  let lastFourTotal = 0;
  let sameSlotHits = 0;
  let sameSlotTotal = 0;
  let lastFourWidth = 0;
  let sameSlotWidth = 0;
  let noForecast = 0;

  for (const [, payouts] of byTicker) {
    const dated = payouts.sort((a, b) => a.anchor - b.anchor);
    if (dated.length < 3) continue;
    const held = dated[dated.length - 1];
    const history = dated.slice(0, -1);
    // Forecast as of the day after the last retained payout, the position the
    // engine is really in: it knows everything up to then and nothing after.
    const asOf = history[history.length - 1].anchor + DAY_MS;

    const s = seasonalAnchor(history, asOf);
    if (s === null) {
      noForecast++;
      continue;
    }
    seasonalErr.push((s - held.anchor) / DAY_MS);

    const a = naiveAnniversary(history);
    if (a !== null) anniversaryErr.push((a - held.anchor) / DAY_MS);
    const c = naiveCadence(history);
    if (c !== null) cadenceErr.push((c - held.anchor) / DAY_MS);
    const rr = recurringSlotAnchor(history, asOf);
    if (rr !== null) {
      recurringErr.push((rr - held.anchor) / DAY_MS);
      const ip = held.anchor + PAYMENT_LAG_DAYS * DAY_MS;
      if (ip >= rr && ip <= rr + PAYMENT_WINDOW_DAYS * DAY_MS) recurWindowHits++;
    }

    // The quoted window is a PAYMENT window: [anchor, anchor+35], with payment
    // expected ~21 days after book closure. company_payouts carries no actual
    // payment date, so the fair test is whether the implied real payment
    // (actual anchor + the same 21-day lag) falls inside the quoted window.
    windowTotal++;
    const impliedPayment = held.anchor + PAYMENT_LAG_DAYS * DAY_MS;
    if (impliedPayment >= s && impliedPayment <= s + PAYMENT_WINDOW_DAYS * DAY_MS) windowHits++;

    if (held.dps !== null && held.dps > 0) {
      const l4 = lastFourRange(history);
      if (l4) {
        lastFourTotal++;
        if (held.dps >= l4[0] * 0.95 && held.dps <= l4[1] * 1.05) lastFourHits++;
        lastFourWidth += l4[1] - l4[0];
      }
      const ss = sameSlotRange(history, s);
      if (ss) {
        sameSlotTotal++;
        if (held.dps >= ss[0] * 0.95 && held.dps <= ss[1] * 1.05) sameSlotHits++;
        sameSlotWidth += ss[1] - ss[0];
      }
    }
  }

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const d = (v: number) => `${v.toFixed(1)}d`;

  console.log(`companies with a payout calendar: ${byTicker.size}`);
  console.log(`scored (>=3 payouts, model produced a forecast): ${seasonalErr.length}`);
  console.log(`skipped (too little history for the seasonal model): ${noForecast}\n`);

  console.log("TIMING — absolute error against the held-out payout");
  for (const [name, errs] of [
    ["seasonal (shipped)", seasonalErr],
    ["recurring slots   ", recurringErr],
    ["naive anniversary ", anniversaryErr],
    ["naive cadence     ", cadenceErr],
  ] as const) {
    const st = stats(errs);
    console.log(
      `  ${name}  n=${String(st.n).padStart(4)}  median ${d(st.median).padStart(7)}  mean ${d(st.mean).padStart(7)}  within 14d ${pct(st.within14)}  within 30d ${pct(st.within30)}`
    );
  }

  console.log(`\nWINDOW — actual payout landed inside the quoted ${PAYMENT_WINDOW_DAYS}-day window`);
  console.log(`  recurring-slot variant: ${recurWindowHits} of ${windowTotal}  (${pct(windowTotal ? recurWindowHits / windowTotal : 0)})`);
  console.log(`  ${windowHits} of ${windowTotal}  (${pct(windowTotal ? windowHits / windowTotal : 0)})`);

  console.log("\nAMOUNT — actual DPS landed inside the quoted range (5% tolerance)");
  console.log(
    `  last-four (shipped)  ${lastFourHits} of ${lastFourTotal}  (${pct(lastFourTotal ? lastFourHits / lastFourTotal : 0)})  mean width Rs ${(lastFourTotal ? lastFourWidth / lastFourTotal : 0).toFixed(2)}`
  );
  console.log(
    `  same fiscal slot     ${sameSlotHits} of ${sameSlotTotal}  (${pct(sameSlotTotal ? sameSlotHits / sameSlotTotal : 0)})  mean width Rs ${(sameSlotTotal ? sameSlotWidth / sameSlotTotal : 0).toFixed(2)}`
  );

  const signed = [...seasonalErr].sort((a, b) => a - b);
  const q = (f: number) => signed[Math.min(signed.length - 1, Math.floor(f * signed.length))];
  console.log("\nTIMING — signed error (positive = forecast is LATE, actual came first)");
  console.log(`  p10 ${d(q(0.1))}  p25 ${d(q(0.25))}  median ${d(q(0.5))}  p75 ${d(q(0.75))}  p90 ${d(q(0.9))}`);
  console.log(`  early (forecast before actual): ${signed.filter((v) => v < 0).length} of ${signed.length}`);

  const seasonal = stats(seasonalErr);
  const best = Math.min(stats(anniversaryErr).median, stats(cadenceErr).median);
  console.log(
    `\nVERDICT: seasonal median ${d(seasonal.median)} vs best naive ${d(best)} — ${seasonal.median < best ? "seasonal wins" : "SEASONAL DOES NOT BEAT THE NAIVE RULE"}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
