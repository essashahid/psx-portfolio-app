import { NextResponse } from "next/server";
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
 * Daily Stock Data Engine job (after PSX close). One composite run keeps us
 * within hosting cron limits:
 *  1. Universe sync (when older than 6 days)
 *  2. Quotes + technicals for the active set (holdings + watchlist)
 *  3. Quotes for a rotating universe slice (oldest-fetched first)
 *  4. Financial extraction queue (few tickers/run — Gemini is slow)
 *  5. Ratio recompute for tickers with financials
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const db = createAdminClient();
  const report: Record<string, unknown> = {};

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
  for (let i = 0; i < active.length; i += BATCH) {
    const batch = active.slice(i, i + BATCH);
    const [qs, ts] = await Promise.all([
      Promise.all(batch.map((t) => refreshQuote(t).catch(() => null))),
      Promise.all(batch.map((t) => refreshTechnicals(t).catch(() => null))),
    ]);
    quotesOk += qs.filter(Boolean).length;
    techOk += ts.filter((t) => t?.asOfDate).length;
  }
  report.activeSet = { tickers: active.length, quotes: quotesOk, technicals: techOk };

  // 3. Rotating universe slice (oldest quotes first), quotable instruments only
  try {
    const all = (await activeUniverseTickers(db, "quotable")).filter((t) => !active.includes(t));
    const { data: quotes } = await db.from("market_quotes").select("ticker, last_fetched_at");
    const fetchedAt = new Map((quotes ?? []).map((q) => [q.ticker as string, q.last_fetched_at as string]));
    const slice = all.sort((a, b) => (fetchedAt.get(a) ?? "").localeCompare(fetchedAt.get(b) ?? "")).slice(0, 40);
    let ok = 0;
    for (let i = 0; i < slice.length; i += BATCH) {
      const results = await Promise.all(slice.slice(i, i + BATCH).map((t) => refreshQuote(t).catch(() => null)));
      ok += results.filter(Boolean).length;
    }
    report.universeSlice = { attempted: slice.length, refreshed: ok };
  } catch (e) {
    report.universeSlice = { error: e instanceof Error ? e.message : String(e) };
  }

  // 4. Financials from the official PSX company page (one cheap HTTP request
  //    each, no LLM). Refresh the whole active set every run, then top up a
  //    rotating slice of the universe that has no financials yet.
  try {
    const { data: have } = await db.from("company_financials").select("ticker").eq("review_status", "published");
    const covered = new Set((have ?? []).map((r) => r.ticker as string));
    const topUp = (await activeUniverseTickers(db, "companies"))
      .filter((t) => !covered.has(t) && !active.includes(t))
      .slice(0, 30);
    const queue = [...new Set([...active, ...topUp])];
    let loaded = 0;
    for (let i = 0; i < queue.length; i += BATCH) {
      const results = await Promise.all(
        queue.slice(i, i + BATCH).map(async (t) => {
          const r = await populateFinancials(t).catch(() => null);
          if (r && r.saved > 0) await refreshRatios(db, t).catch(() => null);
          return r?.saved ?? 0;
        })
      );
      loaded += results.filter((n) => n > 0).length;
    }
    report.financials = { attempted: queue.length, loaded };
  } catch (e) {
    report.financials = { error: e instanceof Error ? e.message : String(e) };
  }

  // 5. Ratios for everything that has financials (cheap, pure reads + upsert)
  try {
    const { data: have } = await db.from("company_financials").select("ticker").eq("review_status", "published");
    const tickers = [...new Set((have ?? []).map((r) => r.ticker as string))];
    let ok = 0;
    for (const t of tickers.slice(0, 50)) {
      const r = await refreshRatios(db, t).catch(() => null);
      if (r) ok++;
    }
    report.ratios = { recomputed: ok };
  } catch (e) {
    report.ratios = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ ok: true, ...report });
}
