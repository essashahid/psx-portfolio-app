import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/shared/cron-auth";
import { runCron } from "@/lib/ops/job-runs";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshQuote } from "@/lib/engine/market-data";
import { refreshTechnicals } from "@/lib/company/technicals";
import { populateFinancials } from "@/lib/engine/financials";
import { refreshRatios } from "@/lib/engine/ratios";
import { syncUniverseDirectory, reconcileListingStatus, activeUniverseTickers } from "@/lib/engine/universe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 5;

/**
 * Wall-clock budget, comfortably inside maxDuration.
 *
 * The five stages below grew past what fits in one invocation, and the run was
 * being killed by the platform partway through with a 504: whatever stage the
 * axe happened to fall on was left half done and the report that would have
 * said so never came back. Stopping ourselves a little early instead means the
 * earlier stages always finish, the later ones degrade to "skipped", and the
 * response says which — the stages are already ordered by how much the app
 * depends on them, prices first.
 */
const TIME_BUDGET_MS = 250_000;

/**
 * Daily Stock Data Engine job (after PSX close). One composite run keeps us
 * within hosting cron limits:
 *  1. Universe sync (when older than 6 days)
 *  2. Quotes + technicals for the active set (holdings + watchlist)
 *  3. Quotes for a rotating universe slice (oldest-fetched first)
 *  4. Financial extraction queue (few tickers/run — Gemini is slow)
 *  5. Ratio recompute for tickers with financials
 */
async function handler(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const db = createAdminClient();
  const report: Record<string, unknown> = {};
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

  // 1. Universe sync (weekly cadence) + listing-status reconciliation (every
  //    run — it's two cheap reads and keeps dead counters out of rotations).
  try {
    const { data: newest } = await db
      .from("stock_universe")
      .select("last_updated")
      .order("last_updated", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ageDays = newest ? (Date.now() - new Date(newest.last_updated).getTime()) / 86400_000 : Infinity;
    if (ageDays > 6) {
      const result = await syncUniverseDirectory(db);
      report.universe = result;
    } else {
      report.universe = { skipped: `synced ${ageDays.toFixed(1)}d ago` };
    }
    report.listingStatus = await reconcileListingStatus(db);
  } catch (e) {
    report.universe = { error: e instanceof Error ? e.message : String(e) };
  }

  // 2. Active set: quotes + technicals
  const [{ data: holdings }, { data: watch }] = await Promise.all([
    db.from("holdings").select("ticker").gt("quantity", 0),
    db.from("stock_watchlist").select("ticker"),
  ]);
  const active = [...new Set([...(holdings ?? []), ...(watch ?? [])].map((r) => (r.ticker as string).toUpperCase()))];

  let quotesOk = 0;
  let techOk = 0;
  let attempted = 0;
  for (let i = 0; i < active.length; i += BATCH) {
    if (outOfTime()) break;
    const batch = active.slice(i, i + BATCH);
    const [qs, ts] = await Promise.all([
      Promise.all(batch.map((t) => refreshQuote(t).catch(() => null))),
      Promise.all(batch.map((t) => refreshTechnicals(t).catch(() => null))),
    ]);
    attempted += batch.length;
    quotesOk += qs.filter(Boolean).length;
    techOk += ts.filter((t) => t?.asOfDate).length;
  }
  report.activeSet = { tickers: active.length, attempted, quotes: quotesOk, technicals: techOk };

  // 3. Rotating universe slice (oldest quotes first), quotable instruments only
  if (outOfTime()) report.universeSlice = { skipped: "time budget" };
  else try {
    const all = (await activeUniverseTickers(db, "quotable")).filter((t) => !active.includes(t));
    const { data: quotes } = await db.from("market_quotes").select("ticker, last_fetched_at");
    const fetchedAt = new Map((quotes ?? []).map((q) => [q.ticker as string, q.last_fetched_at as string]));
    const slice = all.sort((a, b) => (fetchedAt.get(a) ?? "").localeCompare(fetchedAt.get(b) ?? "")).slice(0, 40);
    let ok = 0;
    let tried = 0;
    for (let i = 0; i < slice.length; i += BATCH) {
      if (outOfTime()) break;
      const chunk = slice.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map((t) => refreshQuote(t).catch(() => null)));
      tried += chunk.length;
      ok += results.filter(Boolean).length;
    }
    report.universeSlice = { attempted: tried, refreshed: ok };
  } catch (e) {
    report.universeSlice = { error: e instanceof Error ? e.message : String(e) };
  }

  // 4. Financials from the official PSX company page (one cheap HTTP request
  //    each, no LLM). Refresh the whole active set every run, then top up a
  //    rotating slice of the universe that has no financials yet.
  if (outOfTime()) report.financials = { skipped: "time budget" };
  else try {
    const { data: have } = await db.from("company_financials").select("ticker").eq("review_status", "published");
    const covered = new Set((have ?? []).map((r) => r.ticker as string));
    const topUp = (await activeUniverseTickers(db, "companies"))
      .filter((t) => !covered.has(t) && !active.includes(t))
      .slice(0, 30);
    const queue = [...new Set([...active, ...topUp])];
    let loaded = 0;
    let tried = 0;
    for (let i = 0; i < queue.length; i += BATCH) {
      if (outOfTime()) break;
      tried += Math.min(BATCH, queue.length - i);
      const results = await Promise.all(
        queue.slice(i, i + BATCH).map(async (t) => {
          const r = await populateFinancials(t).catch(() => null);
          if (r && r.saved > 0) await refreshRatios(db, t).catch(() => null);
          return r?.saved ?? 0;
        })
      );
      loaded += results.filter((n) => n > 0).length;
    }
    report.financials = { attempted: tried, loaded };
  } catch (e) {
    report.financials = { error: e instanceof Error ? e.message : String(e) };
  }

  // 5. Discrete quarters from the cumulative rows.
  //
  //    PSX companies file 3M, 6M and 9M, then a full year, and never file Q2,
  //    Q3 or Q4 standalone, so three of every four quarters have to be
  //    differenced out of the cumulative series. Without this step a new set of
  //    results lands as another cumulative row and the quarterly history simply
  //    stops growing — the five-year backfill would decay from the day it ran.
  //
  //    Cheap: pure reads and upserts, no LLM and no PDF. Runs for the active
  //    set only, since that is where new filings actually arrive; the wider
  //    universe is handled by the backfill script.
  if (outOfTime()) report.quarters = { skipped: "time budget" };
  else try {
    const { deriveQuarters } = await import("@/lib/engine/quarterly-derivation");
    let written = 0;
    let repaired = 0;
    let flagged = 0;
    let ran = 0;
    for (const t of active) {
      if (outOfTime()) break;
      const r = await deriveQuarters(db, t).catch(() => null);
      if (!r) continue;
      ran++;
      written += r.written;
      repaired += r.bleedRepaired + r.bleedQuarantined;
      flagged += r.crossChecks.filter((c) => c.material).length;
    }
    report.quarters = { companies: ran, derived: written, bleedHandled: repaired, crossChecksFlagged: flagged };
  } catch (e) {
    report.quarters = { error: e instanceof Error ? e.message : String(e) };
  }

  // 6. Ratios for everything that has financials (cheap, pure reads + upsert)
  if (outOfTime()) report.ratios = { skipped: "time budget" };
  else try {
    const { data: have } = await db.from("company_financials").select("ticker").eq("review_status", "published");
    const tickers = [...new Set((have ?? []).map((r) => r.ticker as string))];
    let ok = 0;
    for (const t of tickers.slice(0, 50)) {
      if (outOfTime()) break;
      const r = await refreshRatios(db, t).catch(() => null);
      if (r) ok++;
    }
    report.ratios = { recomputed: ok };
  } catch (e) {
    report.ratios = { error: e instanceof Error ? e.message : String(e) };
  }

  // 7. Dated ratios per fiscal period, for the active set.
  //
  //    Step 6 keeps the current snapshot fresh. This keeps the SERIES fresh,
  //    which is a different thing: when a new filing lands, that period gains
  //    its own margins, returns and period-end valuation rather than only
  //    shifting what "latest" points at. Same reasoning as the quarters above —
  //    a history that only a manual script maintains stops being a history.
  //
  //    Reads and upserts only, no LLM.
  if (outOfTime()) report.ratioHistory = { skipped: "time budget" };
  else try {
    const { computeRatioHistory } = await import("@/lib/engine/ratio-history");
    let periods = 0;
    let ran = 0;
    for (const t of active) {
      if (outOfTime()) break;
      const r = await computeRatioHistory(db, t).catch(() => null);
      if (!r) continue;
      ran++;
      periods += r.periods;
    }
    report.ratioHistory = { companies: ran, periods };
  } catch (e) {
    report.ratioHistory = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ ok: true, elapsedMs: Date.now() - startedAt, ranOutOfTime: outOfTime(), ...report });
}

export const GET = (request: Request) => runCron("engine", request, handler);
