import { NextResponse } from "next/server";
import Papa from "papaparse";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { refreshAlerts } from "@/lib/alerts";
import { takeSnapshot } from "@/lib/portfolio";
import { getMarketDataProvider } from "@/lib/market-data/adapter";
import { needsRefresh, PSX_PRICE_SOURCE } from "@/lib/market-data/psx-dps";
import { parseNumberLoose, parseDateLoose } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Manual price management.
 * POST { prices: [{ticker, price, date?}] }  — set prices directly
 * POST { csv: "ticker,price[,date]..." }     — bulk upload
 * POST { refresh: true }                     — run the configured market-data provider
 */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const body = (await request.json()) as {
      prices?: { ticker: string; price: number; date?: string }[];
      csv?: string;
      refresh?: boolean;
      /** Skip the fetch when the last provider fetch is newer than this. */
      ifStaleMinutes?: number;
    };

    if (body.refresh) {
      const provider = getMarketDataProvider(supabase, user.id);
      if (provider.name === "manual") {
        const result = await provider.refreshPortfolioPrices(user.id);
        return NextResponse.json({
          provider: "manual",
          updated: 0,
          skipped: result.skipped,
          message:
            result.skipped.length > 0
              ? `Manual mode: no external provider configured. ${result.skipped.length} holding(s) still have no price: ${result.skipped.join(", ")}. Set prices below or upload a price CSV.`
              : "Manual mode: all holdings already have prices. Update them below whenever you like.",
        });
      }

      const providerSource = provider.name === "psx" ? PSX_PRICE_SOURCE : provider.name;
      if (body.ifStaleMinutes) {
        const { data: last } = await supabase
          .from("prices")
          .select("created_at")
          .eq("user_id", user.id)
          .eq("source", providerSource)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!needsRefresh(last ? new Date(last.created_at) : null, body.ifStaleMinutes)) {
          return NextResponse.json({ provider: provider.name, updated: 0, skipped: [], fresh: true });
        }
      }

      const result = await provider.refreshPortfolioPrices(user.id);
      if (result.updated > 0) {
        await takeSnapshot(supabase, user.id);
        await refreshAlerts(supabase, user.id);
      }
      return NextResponse.json({
        provider: provider.name,
        ...result,
        message:
          result.updated > 0
            ? `${result.updated} price(s) refreshed from ${provider.name}${result.skipped.length ? `; no data for ${result.skipped.join(", ")}` : ""}.`
            : `${provider.name} returned no prices${result.skipped.length ? ` for ${result.skipped.join(", ")}` : ""}. Try again shortly.`,
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
