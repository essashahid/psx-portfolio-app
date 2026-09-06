import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { computeWhatIf, dateYearsAgo } from "@/lib/company/what-if";
import { loadCloses } from "@/lib/company/history";
import { WHAT_IF_DEFAULT_AMOUNT, type WhatIfResponse } from "@psx/shared/api/what-if";
import { track } from "@/lib/telemetry/events";

export const maxDuration = 30;

/**
 * GET /api/stocks/[ticker]/what-if?amount=100000&from=2023-09-06
 *
 * Five years of closes for the company and the KSE-100 from the canonical
 * history, and the cash payouts on record, run through computeWhatIf.
 */
export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  try {
    const { ticker: raw } = await params;
    const ticker = decodeURIComponent(raw).toUpperCase();
    const url = new URL(request.url);
    const amount = Number(url.searchParams.get("amount") ?? WHAT_IF_DEFAULT_AMOUNT);
    const from = url.searchParams.get("from") ?? dateYearsAgo(3);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return NextResponse.json({ error: "from must be YYYY-MM-DD" }, { status: 422 });

    const [closes, index, { data: payouts }, { data: earliest }] = await Promise.all([
      loadCloses(supabase, ticker),
      loadCloses(supabase, "KSE100"),
      supabase.from("company_payouts").select("announcement_date, book_closure_start, dividend_per_share").eq("ticker", ticker).eq("kind", "cash"),
      supabase.from("company_payouts").select("announcement_date").eq("ticker", ticker).order("announcement_date", { ascending: true }).limit(1).maybeSingle(),
    ]);

    const result = computeWhatIf({
      ticker,
      amount,
      from,
      candles: closes,
      payouts: (payouts ?? [])
        .map((p) => ({ date: String(p.book_closure_start ?? p.announcement_date ?? ""), dps: Number(p.dividend_per_share) }))
        .filter((p) => p.date && Number.isFinite(p.dps)),
      payoutsKnownFrom: earliest?.announcement_date ? String(earliest.announcement_date) : null,
      benchmark: { label: "KSE-100", candles: index },
    });
    if ("error" in result) return NextResponse.json(result, { status: 422 });
    void track(user.id, "what_if_run", { ticker, years: result.years });
    return NextResponse.json<WhatIfResponse>(result);
  } catch (err) {
    return errorResponse(err);
  }
}
