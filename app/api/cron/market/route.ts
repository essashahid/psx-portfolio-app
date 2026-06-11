import { NextResponse } from "next/server";
import { buildMarketSnapshot } from "@/lib/market/snapshot";
import { refreshMarketEvents } from "@/lib/market/events";
import { generateMarketBrief } from "@/lib/market/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Market Pulse refresh job. Builds today's whole-market snapshot (prices,
 * breadth, sectors, movers), refreshes the official events feed, and
 * regenerates the AI brief from the fresh aggregates.
 *
 * Protected by CRON_SECRET (Bearer header or ?key=). Schedule it during/after
 * PSX hours; each run is two market-wide HTTP pulls plus one cheap LLM call.
 *   ?task=snapshot|events|brief|all (default all)
 *   ?brief=1 to force brief regeneration
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
  if (task === "all" || task === "brief") {
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    const brief = await generateMarketBrief(date, { force: url.searchParams.get("brief") === "1" || task === "brief" });
    report.brief = { generated: brief.generated, error: brief.error };
  }

  return NextResponse.json({ ok: true, ...report });
}
