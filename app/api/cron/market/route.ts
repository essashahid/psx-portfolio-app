import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/shared/cron-auth";
import { revalidateTag } from "next/cache";
import { buildMarketSnapshot, ensureMarketSnapshot } from "@/lib/market/snapshot";
import { refreshMarketEvents } from "@/lib/market/events";
import { generateMarketBrief } from "@/lib/market/brief";
import { MARKET_SNAPSHOT_TAG } from "@/lib/market/read";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPsxWeekday } from "@/lib/market/trading-day";
import { fetchAndIngestForeignFlows, foreignFlowsAutoConfigured } from "@/lib/market/foreign-flows-ingest";
import { buildMacroAssetRows, writeMacroAssetRows } from "@/lib/market-data/macro-assets";
import { ensureEodCached } from "@/lib/market-data/eod-cache";
import { SECONDARY_INDEX_SYMBOLS } from "@/lib/market/ticker-extras";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Market Pulse refresh job. Builds today's whole-market snapshot (prices,
 * breadth, sectors, movers), refreshes the official events feed, and
 * regenerates the AI brief from the fresh aggregates.
 *
 * Protected by CRON_SECRET (Bearer header or ?key=). Schedule it during/after
 * PSX hours; each run is two market-wide HTTP pulls plus one cheap LLM call.
 *   ?task=snapshot|events|brief|flows|macro|all (default all)
 *   ?brief=1 to force brief regeneration
 */
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const task = url.searchParams.get("task") ?? "all";
  const report: Record<string, unknown> = {};

  if (task === "all" || task === "snapshot") {
    const snap = await buildMarketSnapshot();
    report.snapshot = { date: snap.date, items: snap.items, advancers: snap.advancers, decliners: snap.decliners, index: snap.index, errors: snap.errors };
  }
  if (task === "all" || task === "events") {
    const ev = await refreshMarketEvents();
    report.events = ev;
  }
  if (task === "all" || task === "flows") {
    // Foreign/local flows — best-effort; SCSTrade by default, custom JSON when configured.
    if (foreignFlowsAutoConfigured()) {
      const flows = await fetchAndIngestForeignFlows(createAdminClient());
      report.flows = flows ?? { ingested: false, note: "source unreachable; manual entry remains the fallback" };
    } else {
      report.flows = { configured: false };
    }
  }
  if (task === "all" || task === "macro") {
    // Refresh the non-PSX asset cache (BTC, gold, USD/PKR, T-bill path).
    try {
      const { rows, fetched } = await buildMacroAssetRows();
      const written = await writeMacroAssetRows(createAdminClient(), rows);
      report.macro = { written, fetched };
    } catch (err) {
      report.macro = { error: err instanceof Error ? err.message : "macro refresh failed" };
    }
  }
  // The macro assets above are global and trade on their own calendars, so
  // that block is safe to run any day. The PSX indices below are not, and this
  // task is now reached daily by /api/cron/market/macro to keep Bitcoin current
  // at weekends — hence the explicit weekday guard here.
  if ((task === "all" || task === "macro") && isPsxWeekday()) {
    // This task is reached every weekday by /api/cron/market/macro, on a later
    // schedule than the snapshot job, which makes it the natural place to
    // notice that the snapshot job never landed and build the day's snapshot
    // late rather than not at all. A no-op on the normal day.
    if (task === "macro") {
      try {
        const caught = await ensureMarketSnapshot();
        if (caught.built) report.snapshotCatchUp = { date: caught.date, items: caught.items, errors: caught.errors };
      } catch (err) {
        report.snapshotCatchUp = { error: err instanceof Error ? err.message : "snapshot catch-up failed" };
      }
    }

    // The secondary PSX indices. Only the outlook capture wrote these, and it
    // is gated on KSE-100 already holding today's close, so a lag there froze
    // them for days while the tape presented them as current. Topping them up
    // here keeps them on the same daily footing as everything else.
    try {
      const idx = await ensureEodCached([...SECONDARY_INDEX_SYMBOLS]);
      report.indices = { refreshed: idx.refreshed, skipped: idx.skipped };
    } catch (err) {
      report.indices = { error: err instanceof Error ? err.message : "index refresh failed" };
    }
  }
  if (task === "all" || task === "brief") {
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    const brief = await generateMarketBrief(date, { force: url.searchParams.get("brief") === "1" || task === "brief" });
    report.brief = { generated: brief.generated, error: brief.error };
  }

  // Any of the above tasks rewrites global market data — drop the cached read so
  // the next Market Pulse render serves the fresh snapshot.
  revalidateTag(MARKET_SNAPSHOT_TAG, "max");

  return NextResponse.json({ ok: true, ...report });
}
