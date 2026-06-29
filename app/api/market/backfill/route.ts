import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshTechnicals } from "@/lib/company/technicals";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 120;

/**
 * Manual, authenticated technicals backfill from the screener — accelerates the
 * rotating cron so a user can fill sparklines / 52-week data on demand. Bounded
 * per call (default 60) and oldest-data-first so repeated calls converge to full
 * coverage without re-doing fresh rows.
 */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.max(1, Math.min(120, body.limit ?? 60));
    const db = createAdminClient();

    // Working set: today's traded stocks.
    const { data: snap } = await db.from("market_snapshots").select("id").eq("market", "PSX").order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
    if (!snap?.id) return NextResponse.json({ error: "No market snapshot yet — refresh the market first." }, { status: 409 });
    const { data: items } = await db.from("market_snapshot_items").select("ticker").eq("snapshot_id", snap.id);
    const tickers = (items ?? []).map((i) => (i.ticker as string).toUpperCase());

    // Oldest/missing technicals first.
    const updatedAt = new Map<string, string>();
    for (let i = 0; i < tickers.length; i += 500) {
      const { data } = await db.from("company_technicals").select("ticker, updated_at, spark").in("ticker", tickers.slice(i, i + 500));
      for (const r of data ?? []) updatedAt.set((r.ticker as string).toUpperCase(), r.spark ? ((r.updated_at as string) ?? "") : "");
    }
    const queue = [...tickers].sort((a, b) => (updatedAt.has(a) ? updatedAt.get(a)! : "").localeCompare(updatedAt.has(b) ? updatedAt.get(b)! : "")).slice(0, limit);

    let ok = 0;
    let i = 0;
    const runners = Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (i < queue.length) {
        const t = queue[i++];
        try {
          const tech = await refreshTechnicals(t);
          if (tech.history.length) ok++;
        } catch {
          /* skip */
        }
      }
    });
    await Promise.all(runners);

    const { count } = await db.from("company_technicals").select("ticker", { count: "exact", head: true }).not("spark", "is", null);
    return NextResponse.json({
      message: `Built deep data for ${ok} stock(s). ${count ?? 0} now have sparklines & technicals.`,
      detail: { attempted: queue.length, withHistory: ok, totalWithSpark: count ?? 0 },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
