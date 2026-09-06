import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { rejectDemoWrite } from "@/lib/demo/mode";
import type { WatchlistWriteRequest, WatchlistWriteResponse } from "@psx/shared/api/watchlist";

export const maxDuration = 15;

/** POST WatchlistWriteRequest: manage the watchlist. */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const body = (await request.json()) as Partial<WatchlistWriteRequest>;
    const ticker = (body.ticker ?? "").toUpperCase().trim();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    const { data: existing } = await supabase
      .from("stock_watchlist")
      .select("id")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .maybeSingle();

    const action = body.action ?? "toggle";
    const shouldRemove = action === "remove" || (action === "toggle" && existing);

    if (shouldRemove) {
      if (existing) await supabase.from("stock_watchlist").delete().eq("id", existing.id);
      return NextResponse.json<WatchlistWriteResponse>({ watched: false, message: `${ticker} removed from watchlist.` });
    }

    if (!existing) {
      const { error: insErr } = await supabase
        .from("stock_watchlist")
        .insert({ user_id: user.id, ticker, status: "watching" });
      if (insErr) throw insErr;
    }
    return NextResponse.json<WatchlistWriteResponse>({ watched: true, message: `${ticker} added to watchlist.` });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/stocks/watchlist?ticker=XYZ */
export async function DELETE(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;
  try {
    const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").toUpperCase().trim();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    await supabase.from("stock_watchlist").delete().eq("user_id", user.id).eq("ticker", ticker);
    return NextResponse.json({ watched: false, message: `${ticker} removed from watchlist.` });
  } catch (err) {
    return errorResponse(err);
  }
}
