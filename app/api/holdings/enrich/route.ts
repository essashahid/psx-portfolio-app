import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { enrichHoldingsMetadata } from "@/lib/holdings/enrichment";
import { refreshAlerts } from "@/lib/alerts";
import { takeSnapshot } from "@/lib/portfolio";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const body = (await request.json().catch(() => ({}))) as { tickers?: string[]; useAi?: boolean };
    const output = await logAgentRun(
      supabase,
      user.id,
      "holdings_metadata_enrichment",
      { tickers: body.tickers ?? "all", useAi: body.useAi ?? true },
      async () => enrichHoldingsMetadata(supabase, user.id, { tickers: body.tickers, useAi: body.useAi })
    );

    await takeSnapshot(supabase, user.id);
    await refreshAlerts(supabase, user.id);

    return NextResponse.json({ ok: true, ...output });
  } catch (err) {
    return errorResponse(err);
  }
}
