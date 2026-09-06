import { NextResponse } from "next/server";
import Papa from "papaparse";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { refreshAlerts } from "@/lib/alerts/refresh";
import { takeSnapshot } from "@/lib/portfolio/positions";
import { refreshBenchmarkForUser } from "@/lib/engine/benchmark-rebuild";
import { refreshQuotesForTickers } from "@/lib/engine/market-data";
import { RATE_LIMITS, rateLimitResponse } from "@/lib/shared/rate-limit";
import { parseNumberLoose, parseDateLoose } from "@/lib/shared/format";
import { rejectDemoWrite } from "@/lib/demo/mode";

export const maxDuration = 60;

/** Keep ticker lists in user-facing messages short instead of dumping the whole batch. */
function summarizeTickers(tickers: string[], max = 6): string {
  if (tickers.length <= max) return tickers.join(", ");
  return `${tickers.slice(0, max).join(", ")} and ${tickers.length - max} more`;
}

/**
 * Manual price management.
 * POST { prices: [{ticker, price, date?}] }  — set prices directly
 * POST { csv: "ticker,price[,date]..." }     — bulk upload
 * POST { refresh: true }                     — run the configured market-data provider
 */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const body = (await request.json()) as {
      prices?: { ticker: string; price: number; date?: string }[];
      csv?: string;
      refresh?: boolean;
      /** Skip the fetch when the last provider fetch is newer than this. */
      ifStaleMinutes?: number;
    };

    if (body.refresh) {
      const limited = await rateLimitResponse(RATE_LIMITS.priceRefresh, user.id, "Prices were refreshed recently. Try again in a few minutes.");
      if (limited) return limited;
      const providerName = (process.env.MARKET_DATA_PROVIDER ?? "psx").toLowerCase();
      if (providerName === "manual") {
        return NextResponse.json({
          provider: "manual",
          updated: 0,
          skipped: [],
          message: "Manual mode: no external provider configured. Set prices below or upload a price CSV.",
        });
      }

      const { data: held } = await supabase.from("holdings").select("ticker").eq("user_id", user.id).gt("quantity", 0);
      const refreshed = await refreshQuotesForTickers(
        (held ?? []).map((h) => String(h.ticker)),
        { staleMinutes: body.ifStaleMinutes ?? 10 }
      );
      if (body.ifStaleMinutes && refreshed.refreshed === 0 && refreshed.failed.length === 0) {
        return NextResponse.json({ provider: providerName, updated: 0, skipped: [], fresh: true });
      }
      const result = { updated: refreshed.refreshed, skipped: refreshed.failed };
      const provider = { name: providerName };
      if (result.updated > 0) {
        await takeSnapshot(supabase, user.id);
        await refreshAlerts(supabase, user.id);
        // Keep the growth-of-capital chart in step with the freshly priced header.
        try {
          await refreshBenchmarkForUser(supabase, user.id);
        } catch (e) {
          console.error("benchmark rebuild after price refresh failed", e);
        }
      }
      return NextResponse.json({
        provider: provider.name,
        ...result,
        message:
          result.updated > 0
            ? `${result.updated} price(s) refreshed from ${provider.name}${result.skipped.length ? `; no data for ${summarizeTickers(result.skipped)}` : ""}.`
            : `${provider.name} returned no prices${result.skipped.length ? ` for ${summarizeTickers(result.skipped)}` : ""}. Try again shortly.`,
      });
    }

    let updates: { ticker: string; price: number; date?: string }[] = body.prices ?? [];

    if (body.csv) {
      const parsed = Papa.parse<Record<string, unknown>>(body.csv.trim(), {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      for (const row of parsed.data) {
        const ticker = String(row.ticker ?? row.symbol ?? row.scrip ?? "").toUpperCase().trim();
        const price = parseNumberLoose(row.price ?? row.rate ?? row.close);
        const date = parseDateLoose(row.date ?? row.price_date) ?? undefined;
        if (ticker && price !== null && price > 0) updates.push({ ticker, price, date });
      }
    }

    updates = updates.filter((u) => u.ticker && Number.isFinite(u.price) && u.price > 0);
    if (updates.length === 0) {
      return NextResponse.json({ error: "No valid prices provided." }, { status: 422 });
    }

    const today = new Date().toISOString().slice(0, 10);
    let updated = 0;
    for (const u of updates) {
      const { error: upErr } = await supabase.from("prices").upsert(
        {
          user_id: user.id,
          ticker: u.ticker.toUpperCase(),
          price: u.price,
          price_date: u.date ?? today,
          source: "manual",
        },
        { onConflict: "user_id,ticker,price_date" }
      );
      if (!upErr) updated++;
    }

    await takeSnapshot(supabase, user.id);
    await refreshAlerts(supabase, user.id);
    return NextResponse.json({ updated, message: `${updated} price(s) saved.` });
  } catch (err) {
    return errorResponse(err);
  }
}
