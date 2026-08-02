import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/shared/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshTechnicalsDetailed } from "@/lib/company/technicals";
import { populateCheapFundamentals, populateDeepFundamentals } from "@/lib/engine/fundamentals";
import { activeUniverseTickers, COMPANY_TYPES } from "@/lib/engine/universe";
import { ensureMarketSnapshot } from "@/lib/market/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Universe-wide data backfill — the job responsible for keeping high-quality
 * data on EVERY stock the screener shows.
 *
 * TIMING MATTERS. This runs at 12:05 UTC (17:05 PKT), which is after both the
 * 16:30 PKT close and the market-snapshot job at 11:40 UTC. Both orderings are
 * load-bearing: running before the close means the portal has no EOD bar for
 * today and every row lands a day stale, and running before the snapshot means
 * the working set below is yesterday's. It previously ran at 10:20 UTC, during
 * the session, and could never capture the same day's close.
 *
 * The working set is the union of today's traded stocks (latest market
 * snapshot) plus holdings and watchlists. Each run processes a rotating batch,
 * oldest-data-first, so coverage completes over a handful of runs and then
 * keeps refreshing the stalest rows. Technicals are the priority (they power
 * the screener sparklines, 52-week bars and flags); financials/ratios fill in a
 * smaller slice per run since each is a separate fetch.
 *
 *   ?task=technicals | financials | all   (default technicals)
 *   ?limit=<n>   technicals batch size (default 80)
 *   ?finlimit=<n> financials batch size (default 12)
 *   ?concurrency=<n> (default 6)
 */
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const db = createAdminClient();
  const task = url.searchParams.get("task") ?? "technicals";
  // The working set is ~500 symbols. The fetch layer paces itself now, so a
  // full sweep costs roughly a minute of wall clock and fits inside
  // maxDuration comfortably — there is no reason to leave the tail unrefreshed
  // for four days waiting on a rotating batch.
  const limit = Math.max(1, Math.min(700, Number(url.searchParams.get("limit") ?? 600)));
  const finLimit = Math.max(0, Math.min(60, Number(url.searchParams.get("finlimit") ?? 12)));
  const deepLimit = Math.max(0, Math.min(40, Number(url.searchParams.get("deeplimit") ?? 8)));
  const concurrency = Math.max(1, Math.min(10, Number(url.searchParams.get("concurrency") ?? 6)));
  const report: Record<string, unknown> = {};

  // The working set below is drawn from the latest market snapshot, so a
  // snapshot job that never fired silently costs this run a day as well: it
  // would refresh yesterday's traded set and record it as today's. Build the
  // snapshot first when it is missing; a no-op when the earlier job did land.
  try {
    const caught = await ensureMarketSnapshot(db);
    if (caught.built) report.snapshotCatchUp = { date: caught.date, items: caught.items, errors: caught.errors };
  } catch (e) {
    report.snapshotCatchUp = { error: e instanceof Error ? e.message : String(e) };
  }

  const universe = await workingSet(db);
  report.workingSet = universe.length;

  // Fundamentals/extraction only make sense for companies (equities and
  // modarabas) — the traded snapshot also carries bonds, ETFs and rights.
  const companies = await companyFilter(db, universe);

  if (task === "technicals" || task === "all") {
    const queue = await staleFirst(db, universe, "company_technicals", limit);
    let ok = 0;
    let withData = 0;
    // Counted by reason. "blocked" means the portal turned us away and the
    // ticker deserves another run; "empty" means it carries no EOD series at
    // all (TFCs, rights letters, some ETFs) and will never succeed. Collapsing
    // the two is what let a run that lost three quarters of its queue keep
    // reporting as a success.
    const failures: Record<string, number> = {};
    await runPool(queue, concurrency, async (ticker) => {
      try {
        const { technicals: t, failure } = await refreshTechnicalsDetailed(ticker);
        if (t.asOfDate) { ok++; if (t.history.length) withData++; }
        if (failure) failures[failure] = (failures[failure] ?? 0) + 1;
      } catch {
        failures.threw = (failures.threw ?? 0) + 1;
      }
    });
    report.technicals = { attempted: queue.length, refreshed: ok, withHistory: withData, failures };
  }

  // Cheap fundamentals (PSX page + payouts + ratios, no LLM) — run broadly so
  // ~13 of 18 ratios cover the universe fast.
  if (task === "fundamentals" || task === "financials" || task === "all") {
    // Held tickers first, in full, then the stale-first rotation fills the rest
    // of the budget with the wider universe.
    const companySet = new Set(companies);
    const held = (await heldTickers(db)).filter((t) => companySet.has(t));
    const heldSet = new Set(held);
    const rotation = await staleFirst(
      db,
      companies.filter((t) => !heldSet.has(t)),
      "company_payouts",
      finLimit * 3
    );
    const queue = [...held, ...rotation];
    let loaded = 0;
    let withPayouts = 0;
    await runPool(queue, Math.min(concurrency, 5), async (ticker) => {
      const r = await populateCheapFundamentals(ticker, db);
      if (r.pagePeriods > 0) loaded++;
      if (r.payouts > 0) withPayouts++;
    });
    report.fundamentals = { attempted: queue.length, held: held.length, rotation: rotation.length, loaded, withPayouts };
  }

  // Deep statement extraction (LLM, cached per filing) — narrow rotating slice,
  // prioritizing companies that still lack a balance sheet. Unlocks the
  // remaining margin / leverage / liquidity / coverage / FCF ratios.
  if (task === "extract" || task === "all") {
    const queue = await missingStatementFirst(db, companies, deepLimit);
    let extracted = 0;
    await runPool(queue, Math.min(concurrency, 3), async (ticker) => {
      const r = await populateDeepFundamentals(ticker, 2, db);
      if (r.extracted > 0) extracted++;
    });
    report.extract = { attempted: queue.length, extracted };
  }

  await db.from("data_fetch_logs").insert({
    ticker: null, section: "backfill", source: "psx-dps", status: "ok", rows: report.workingSet as number,
    detail: JSON.stringify({ technicals: report.technicals, fundamentals: report.fundamentals, extract: report.extract }).slice(0, 300),
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, ...report });
}

/** Union of today's traded stocks + holdings + watchlists (uppercased, unique). */
async function workingSet(db: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const [{ data: snap }, { data: holdings }, { data: watch }] = await Promise.all([
    db.from("market_snapshots").select("id").eq("market", "PSX").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
    db.from("holdings").select("ticker").gt("quantity", 0),
    db.from("stock_watchlist").select("ticker"),
  ]);
  const set = new Set<string>();
  for (const h of holdings ?? []) set.add((h.ticker as string).toUpperCase());
  for (const w of watch ?? []) set.add((w.ticker as string).toUpperCase());
  if (snap?.id) {
    const { data: items } = await db.from("market_snapshot_items").select("ticker").eq("snapshot_id", snap.id);
    for (const it of items ?? []) set.add((it.ticker as string).toUpperCase());
  }
  // Fallback to the universe directory if no snapshot has been built yet.
  if (set.size === 0) {
    for (const t of await activeUniverseTickers(db, "quotable")) set.add(t);
  }
  return [...set];
}

/**
 * Restrict a working set to companies (equity/modaraba) using the universe's
 * instrument classes. Tickers unknown to the universe (or all of them, before
 * migration 0030) are kept — being wrong costs one wasted fetch, being strict
 * costs coverage.
 */
async function companyFilter(db: ReturnType<typeof createAdminClient>, tickers: string[]): Promise<string[]> {
  const type = new Map<string, string>();
  for (let i = 0; i < tickers.length; i += 500) {
    const { data, error } = await db.from("stock_universe").select("ticker, instrument_type").in("ticker", tickers.slice(i, i + 500));
    if (error) return tickers; // column missing pre-migration — no filtering
    for (const r of data ?? []) type.set((r.ticker as string).toUpperCase(), (r.instrument_type as string) ?? "equity");
  }
  return tickers.filter((t) => {
    const kind = type.get(t);
    return kind === undefined || COMPANY_TYPES.includes(kind);
  });
}

/**
 * Order the working set so rows with NO cached record come first, then the
 * stalest by updated_at — giving full coverage before re-refreshing.
 */
async function staleFirst(db: ReturnType<typeof createAdminClient>, tickers: string[], table: string, limit: number): Promise<string[]> {
  if (limit === 0) return [];
  const updatedAt = new Map<string, string>();
  for (let i = 0; i < tickers.length; i += 500) {
    const chunk = tickers.slice(i, i + 500);
    const { data } = await db.from(table).select("ticker, updated_at").in("ticker", chunk);
    for (const r of data ?? []) updatedAt.set((r.ticker as string).toUpperCase(), (r.updated_at as string) ?? "");
  }
  return [...tickers]
    .sort((a, b) => {
      const ua = updatedAt.has(a) ? updatedAt.get(a)! : ""; // missing → "" sorts first
      const ub = updatedAt.has(b) ? updatedAt.get(b)! : "";
      return ua.localeCompare(ub);
    })
    .slice(0, limit);
}

/**
 * Every ticker some user actually holds.
 *
 * These deserve priority over the rest of the universe in the payout refresh.
 * The dividend forecaster projects the next payout from `company_payouts`, so a
 * held ticker whose calendar is three weeks stale — which is what the plain
 * stale-first rotation gave it across ~490 companies at 36 per run — can miss a
 * freshly declared payout the user is about to be paid. The held set is small
 * (tens of tickers, not hundreds), so putting it at the front of every run costs
 * almost nothing and is the difference between a current forecast and a guess.
 */
async function heldTickers(db: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("holdings").select("ticker").gt("quantity", 0).range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) if (r.ticker) seen.add(String(r.ticker).toUpperCase());
    if (data.length < 1000) break;
  }
  return [...seen];
}

/**
 * Order the working set for deep extraction: companies with NO balance sheet
 * stored come first (they have the most missing ratios), then rotate by oldest.
 */
async function missingStatementFirst(db: ReturnType<typeof createAdminClient>, tickers: string[], limit: number): Promise<string[]> {
  if (limit === 0) return [];
  const hasBalance = new Set<string>();
  for (let i = 0; i < tickers.length; i += 400) {
    const chunk = tickers.slice(i, i + 400);
    const { data } = await db
      .from("company_financials")
      .select("ticker")
      .eq("statement_type", "balance_sheet")
      .eq("review_status", "published")
      .in("ticker", chunk);
    for (const r of data ?? []) hasBalance.add((r.ticker as string).toUpperCase());
  }
  const missing = tickers.filter((t) => !hasBalance.has(t));
  const have = tickers.filter((t) => hasBalance.has(t));
  // Missing first; then a few of the existing to refresh on new filings.
  return [...missing, ...have].slice(0, limit);
}

/** Bounded-concurrency worker pool. */
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}
