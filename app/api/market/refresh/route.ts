import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { buildMarketSnapshot } from "@/lib/market/snapshot";
import { refreshMarketEvents } from "@/lib/market/events";
import { generateMarketBrief } from "@/lib/market/brief";

export const maxDuration = 120;

/**
 * Manual Market Pulse refresh from the page. Any authenticated user can pull a
 * fresh whole-market snapshot; writes go through the service role inside the
 * builders. Body: { section?: "all" | "snapshot" | "events" | "brief" }.
 */
export async function POST(request: Request) {
  const { error } = await requireUser();
  if (error) return error;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { section?: string };
    const section = body.section ?? "all";

    if (section === "events") {
      const ev = await refreshMarketEvents();
      return NextResponse.json({ message: `${ev.saved} event(s) refreshed.`, detail: ev });
    }
    if (section === "brief") {
      const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
      const b = await generateMarketBrief(date, { force: true });
      return NextResponse.json({ message: b.error ? `Brief failed: ${b.error}` : "Market brief regenerated.", detail: b });
    }

    // snapshot or all
    const snap = await buildMarketSnapshot();
    if (snap.errors.length && !snap.snapshotId) {
      return NextResponse.json({ error: snap.errors[0] }, { status: 502 });
    }
    if (section === "all") {
      await refreshMarketEvents().catch(() => null);
      await generateMarketBrief(snap.date, { force: true }).catch(() => null);
    }
    return NextResponse.json({
      message: `Snapshot rebuilt — ${snap.items} stocks, ${snap.advancers} up / ${snap.decliners} down${snap.index ? ` · ${snap.index}` : ""}.`,
      detail: snap,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
