import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshQuote } from "@/lib/engine/market-data";
import { refreshTechnicals } from "@/lib/company/technicals";
import { refreshRatios } from "@/lib/engine/ratios";
import { extractFinancials } from "@/lib/engine/financials";

export const maxDuration = 300;

const BATCH = 5;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  return provided === secret;
}

/**
 * Background refresh worker (cron-protected).
 *
 *   ?task=quotes      — refresh quotes for the active set (default) or
 *                       ?scope=universe&limit=N to walk the whole universe
 *   ?task=technicals  — recompute technicals for the active set
 *   ?task=financials  — extraction queue: process N tickers with stale/missing
 *                       financials (&limit=, default 3 — Gemini calls are slow)
 *   ?task=ratios      — recompute ratios for tickers that have financials
 *
 * "Active set" = every ticker in any user's holdings or watchlist — the
 * tickers people actually look at, refreshed most often.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const url = new URL(request.url);
  const task = url.searchParams.get("task") ?? "quotes";
  const scope = url.searchParams.get("scope") ?? "active";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
  const db = createAdminClient();

  const tickers = await resolveTickers(db, scope, limit);
  if (tickers.length === 0) return NextResponse.json({ ok: true, task, refreshed: 0, message: "No tickers in scope." });

  if (task === "quotes") {
    let ok = 0;
    const missed: string[] = [];
    for (let i = 0; i < tickers.length; i += BATCH) {
      const batch = tickers.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((t) => refreshQuote(t).catch(() => null)));
      results.forEach((r, j) => (r ? ok++ : missed.push(batch[j])));
    }
    return NextResponse.json({ ok: true, task, scope, refreshed: ok, missed: missed.slice(0, 30) });
  }

  if (task === "technicals") {
    let ok = 0;
    for (let i = 0; i < tickers.length; i += BATCH) {
      const batch = tickers.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((t) => refreshTechnicals(t).catch(() => null)));
      ok += results.filter((r) => r && r.asOfDate).length;
    }
    return NextResponse.json({ ok: true, task, scope, refreshed: ok, of: tickers.length });
  }

  if (task === "financials") {
    // Slow path: a few tickers per run, prioritizing those with no financials yet.
    const queueLimit = Math.min(Number(url.searchParams.get("limit") ?? 3), 10);
    const { data: have } = await db.from("company_financials").select("ticker");
    const covered = new Set((have ?? []).map((r) => r.ticker as string));
    const queue = tickers.filter((t) => !covered.has(t)).slice(0, queueLimit);
    const fallbackQueue = queue.length ? queue : tickers.slice(0, queueLimit); // re-check covered ones for new filings
    const results = [];
    for (const t of fallbackQueue) {
      const r = await extractFinancials(t, 2);
      if (r.saved > 0) await refreshRatios(db, t).catch(() => null);
      results.push({ ticker: t, saved: r.saved, errors: r.errors.slice(0, 2) });
    }
    return NextResponse.json({ ok: true, task, processed: results });
  }

  if (task === "ratios") {
    const { data: have } = await db.from("company_financials").select("ticker");
    const withFin = [...new Set((have ?? []).map((r) => r.ticker as string))].filter((t) => tickers.includes(t) || scope === "universe");
    let ok = 0;
    for (const t of withFin.slice(0, limit)) {
      const r = await refreshRatios(db, t).catch(() => null);
      if (r) ok++;
    }
    return NextResponse.json({ ok: true, task, refreshed: ok });
  }

  return NextResponse.json({ error: `Unknown task "${task}".` }, { status: 400 });
}

async function resolveTickers(db: ReturnType<typeof createAdminClient>, scope: string, limit: number): Promise<string[]> {
  if (scope === "universe") {
    // Walk the universe oldest-quote-first so repeated runs rotate coverage.
    const { data: universe } = await db.from("stock_universe").select("ticker").eq("listing_status", "active").limit(2000);
    const all = (universe ?? []).map((r) => r.ticker as string);
    const { data: quotes } = await db.from("market_quotes").select("ticker, last_fetched_at");
    const fetchedAt = new Map((quotes ?? []).map((q) => [q.ticker as string, q.last_fetched_at as string]));
    return all.sort((a, b) => (fetchedAt.get(a) ?? "").localeCompare(fetchedAt.get(b) ?? "")).slice(0, limit);
  }
  const [{ data: holdings }, { data: watch }] = await Promise.all([
    db.from("holdings").select("ticker").gt("quantity", 0),
    db.from("stock_watchlist").select("ticker"),
  ]);
  return [...new Set([...(holdings ?? []), ...(watch ?? [])].map((r) => (r.ticker as string).toUpperCase()))].slice(0, limit);
}
