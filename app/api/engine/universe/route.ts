import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { fetchPsxSymbols } from "@/lib/market-data/psx-dps";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 120;

function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  return provided === secret;
}

/**
 * Sync the PSX stock universe from the official symbol directory
 * (~1,050 listings). Callable by a logged-in user or by cron with CRON_SECRET.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    const { supabase, user, error } = await requireUser();
    if (error) return error;
    const demoError = await rejectDemoWrite(supabase, user.id);
    if (demoError) return demoError;
  }
  return syncUniverse();
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return syncUniverse();
}

async function syncUniverse() {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
    }
    const directory = await fetchPsxSymbols();
    if (directory.size === 0) {
      return NextResponse.json({ error: "PSX symbol directory unavailable — try again shortly." }, { status: 502 });
    }

    const db = createAdminClient();
    const now = new Date().toISOString();
    const rows = [...directory.entries()].map(([ticker, info]) => ({
      ticker,
      company_name: info.name,
      psx_name: info.name,
      sector: info.sector || null,
      exchange: "PSX",
      listing_status: "active",
      last_updated: now,
    }));

    // Upsert in chunks to stay under payload limits.
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const { error } = await db.from("stock_universe").upsert(chunk, { onConflict: "ticker" });
      if (!error) upserted += chunk.length;
    }

    // Keep stock_master in sync for older code paths.
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400).map((r) => ({ ticker: r.ticker, company_name: r.company_name, sector: r.sector }));
      await db.from("stock_master").upsert(chunk, { onConflict: "ticker" });
    }

    return NextResponse.json({ ok: true, listings: directory.size, upserted, message: `Stock universe synced: ${upserted} PSX listings.` });
  } catch (err) {
    return errorResponse(err);
  }
}
