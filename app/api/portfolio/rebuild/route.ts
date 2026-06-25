import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { recomputeAll } from "@/lib/holdings/recompute-cascade";
import { ensureEodCached } from "@/lib/market-data/eod-cache";

export const maxDuration = 120;

export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const { data: txns, error: txnErr } = await supabase
      .from("transactions")
      .select("ticker")
      .eq("user_id", user.id);
    if (txnErr) throw txnErr;
    const tickers = [...new Set((txns ?? []).map((t) => t.ticker as string).filter(Boolean))];
    await ensureEodCached(tickers, { force: true });
    await recomputeAll(supabase, user.id, { changedTickers: tickers });
    return NextResponse.json({ ok: true, message: "Portfolio rebuilt." });
  } catch (err) {
    return errorResponse(err);
  }
}
