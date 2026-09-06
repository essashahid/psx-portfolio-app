import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/shared/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { populatePayouts } from "@/lib/market/payouts";
import { runCron } from "@/lib/ops/job-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily payout sweep across every actively listed company.
 *
 * company_payouts drives the dividend yield in every company header and the
 * payout calendar, and it was 27 days stale when measured in July because
 * only the rotating backfill touched it. One POST per company at the portal's
 * pacing is about two minutes for the whole exchange, which fits this
 * function. Companies are visited least-recently-fetched first, so a run cut
 * short by the time budget picks up where it left off tomorrow.
 */
const TIME_BUDGET_MS = 240_000;
const CONCURRENCY = 4;

async function handler(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }
  const db = createAdminClient();
  const started = Date.now();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 700);

  const [{ data: universe }, { data: seen }] = await Promise.all([
    db.from("stock_universe").select("ticker").eq("instrument_type", "equity").eq("listing_status", "active"),
    db.from("company_payouts").select("ticker, updated_at").order("updated_at", { ascending: false }).limit(5000),
  ]);
  const lastFetched = new Map<string, string>();
  for (const r of seen ?? []) {
    const t = String(r.ticker);
    if (!lastFetched.has(t)) lastFetched.set(t, String(r.updated_at ?? ""));
  }
  const tickers = (universe ?? [])
    .map((r) => String(r.ticker))
    .sort((a, b) => (lastFetched.get(a) ?? "").localeCompare(lastFetched.get(b) ?? ""))
    .slice(0, limit);

  let done = 0;
  let saved = 0;
  const errors: string[] = [];
  let index = 0;
  const worker = async () => {
    while (index < tickers.length && Date.now() - started < TIME_BUDGET_MS) {
      const t = tickers[index++];
      try {
        const r = await populatePayouts(t, db);
        saved += r.saved;
        errors.push(...r.errors.map((e) => `${t}: ${e}`));
      } catch (e) {
        errors.push(`${t}: ${e instanceof Error ? e.message : String(e)}`);
      }
      done++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const deferred = tickers.length - done;
  await db.from("data_fetch_logs").insert({
    ticker: null, section: "payouts_sweep", source: "psx-payouts",
    status: errors.length ? "error" : "ok", rows: saved,
    detail: `${done} companies, ${deferred} deferred, ${errors.length} errors`.slice(0, 300),
  }).then(() => {}, () => {});

  return NextResponse.json({
    ok: true,
    companies: done,
    deferred,
    rows_saved: saved,
    elapsed_ms: Date.now() - started,
    errors: errors.slice(0, 20),
  });
}

export const GET = (request: Request) => runCron("market/payouts", request, handler);
