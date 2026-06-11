import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshTechnicals } from "@/lib/company/technicals";
import { populateCheapFundamentals, populateDeepFundamentals } from "@/lib/engine/fundamentals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Universe-wide data backfill — the job responsible for keeping high-quality
 * data on EVERY stock the screener shows.
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
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const db = createAdminClient();
  const task = url.searchParams.get("task") ?? "technicals";
  const limit = Math.max(1, Math.min(300, Number(url.searchParams.get("limit") ?? 80)));
  const finLimit = Math.max(0, Math.min(60, Number(url.searchParams.get("finlimit") ?? 12)));
  const deepLimit = Math.max(0, Math.min(40, Number(url.searchParams.get("deeplimit") ?? 8)));
  const concurrency = Math.max(1, Math.min(10, Number(url.searchParams.get("concurrency") ?? 6)));
  const report: Record<string, unknown> = {};

  const universe = await workingSet(db);
  report.workingSet = universe.length;

  if (task === "technicals" || task === "all") {
    const queue = await staleFirst(db, universe, "company_technicals", limit);
    let ok = 0;
    let withData = 0;
    await runPool(queue, concurrency, async (ticker) => {
      try {
        const t = await refreshTechnicals(ticker);
        if (t.asOfDate) { ok++; if (t.history.length) withData++; }
      } catch {
        /* skip — provider gap; picked up on a later run */
      }
    });
    report.technicals = { attempted: queue.length, refreshed: ok, withHistory: withData };
  }

  // Cheap fundamentals (PSX page + payouts + ratios, no LLM) — run broadly so
  // ~13 of 18 ratios cover the universe fast.
  if (task === "fundamentals" || task === "financials" || task === "all") {
    const queue = await staleFirst(db, universe, "company_payouts", finLimit * 3);
    let loaded = 0;
    let withPayouts = 0;
    await runPool(queue, Math.min(concurrency, 5), async (ticker) => {
      const r = await populateCheapFundamentals(ticker, db);
      if (r.pagePeriods > 0) loaded++;
      if (r.payouts > 0) withPayouts++;
    });
    report.fundamentals = { attempted: queue.length, loaded, withPayouts };
  }

  // Deep statement extraction (LLM, cached per filing) — narrow rotating slice,
  // prioritizing companies that still lack a balance sheet. Unlocks the
  // remaining margin / leverage / liquidity / coverage / FCF ratios.
  if (task === "extract" || task === "all") {
    const queue = await missingStatementFirst(db, universe, deepLimit);
    let extracted = 0;
    await runPool(queue, Math.min(concurrency, 3), async (ticker) => {
      const r = await populateDeepFundamentals(ticker, 3, db);
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
    const { data: uni } = await db.from("stock_universe").select("ticker").eq("listing_status", "active").limit(2000);
    for (const u of uni ?? []) set.add((u.ticker as string).toUpperCase());
  }
  return [...set];
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
 * Order the working set for deep extraction: companies with NO balance sheet
 * stored come first (they have the most missing ratios), then rotate by oldest.
 */
async function missingStatementFirst(db: ReturnType<typeof createAdminClient>, tickers: string[], limit: number): Promise<string[]> {
  if (limit === 0) return [];
  const hasBalance = new Set<string>();
  for (let i = 0; i < tickers.length; i += 400) {
    const chunk = tickers.slice(i, i + 400);
    const { data } = await db.from("company_financials").select("ticker").eq("statement_type", "balance_sheet").in("ticker", chunk);
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
