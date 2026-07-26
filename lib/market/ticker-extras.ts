import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Extra readings for the ticker tape: investor flows, gold and the rupee.
 *
 * These sit outside the PSX snapshot — flows come from the NCCPL tables and the
 * other two from the macro history the allocation forecaster maintains — so
 * they are read here rather than threaded through the market snapshot. Global
 * for every user, so the read is cached alongside it.
 */

/**
 * The PSX indices beside KSE-100. KSE-100 itself is kept current by the EOD
 * cache on every portfolio read; these three have no such incidental writer,
 * so the market cron tops them up explicitly.
 */
export const SECONDARY_INDEX_SYMBOLS = ["KSE30", "KMI30", "ALLSHR"] as const;

const INDEX_LABEL: Record<string, string> = {
  KSE30: "KSE-30",
  KMI30: "KMI-30",
  ALLSHR: "All Share",
};

/** Grams in a tola, and in a troy ounce. Gold is quoted per ounce upstream. */
const TOLA_G = 11.6638;
const OUNCE_G = 31.1034768;

export interface TickerExtra {
  label: string;
  value: string;
  change?: string;
  tone: "up" | "down" | "flat";
}

const fmt = (v: number, d = 0) =>
  v.toLocaleString("en-PK", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Latest two closes for a macro asset, newest first. */
async function lastTwo(
  supabase: ReturnType<typeof createAdminClient>,
  asset: "GOLD" | "USDPKR"
): Promise<{ value: number; prev: number | null } | null> {
  const { data } = await supabase
    .from("macro_asset_history")
    .select("asof_date, close_native, close_pkr")
    .eq("asset", asset)
    .order("asof_date", { ascending: false })
    .limit(2);
  const usePkr = asset === "GOLD";
  const points = (data ?? [])
    .map((r) => Number(usePkr ? r.close_pkr : r.close_native))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (points.length === 0) return null;
  return { value: points[0], prev: points[1] ?? null };
}

/** Latest close and the one before it, for a symbol in the price history. */
async function indexReading(
  supabase: ReturnType<typeof createAdminClient>,
  symbol: string
): Promise<TickerExtra | null> {
  const { data } = await supabase
    .from("company_price_history")
    .select("close")
    .eq("ticker", symbol)
    .order("price_date", { ascending: false })
    .limit(2);
  const closes = (data ?? []).map((r) => Number(r.close)).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length === 0) return null;
  const pct = closes.length === 2 ? ((closes[0] - closes[1]) / closes[1]) * 100 : null;
  return {
    label: INDEX_LABEL[symbol] ?? symbol,
    value: fmt(closes[0], 0),
    change: pct !== null ? `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%` : undefined,
    tone: pct === null ? "flat" : pct > 0 ? "up" : pct < 0 ? "down" : "flat",
  };
}

async function build(): Promise<TickerExtra[]> {
  const supabase = createAdminClient();
  const out: TickerExtra[] = [];

  const indices = await Promise.all(SECONDARY_INDEX_SYMBOLS.map((sym) => indexReading(supabase, sym)));
  for (const i of indices) if (i) out.push(i);

  const [flowRes, gold, rupee] = await Promise.all([
    supabase
      .from("foreign_flow_days")
      .select("flow_date, currency, fipi_net, lipi_net")
      .eq("market", "PSX")
      .order("flow_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    lastTwo(supabase, "GOLD"),
    lastTwo(supabase, "USDPKR"),
  ]);

  const flow = flowRes.data;
  const unit = flow?.currency === "USD" ? "USD mn" : (flow?.currency ?? "");
  const netLabel = (net: number) => `net ${net >= 0 ? "buy" : "sell"}`;

  if (flow?.fipi_net != null) {
    const net = Number(flow.fipi_net);
    out.push({
      label: "FIPI",
      value: `${net >= 0 ? "+" : "−"}${fmt(Math.abs(net), 2)} ${unit}`.trim(),
      change: netLabel(net),
      tone: net >= 0 ? "up" : "down",
    });
  }
  if (flow?.lipi_net != null) {
    const net = Number(flow.lipi_net);
    out.push({
      label: "LIPI",
      value: `${net >= 0 ? "+" : "−"}${fmt(Math.abs(net), 2)} ${unit}`.trim(),
      change: netLabel(net),
      tone: net >= 0 ? "up" : "down",
    });
  }

  // Quoted per tola, the unit a Pakistani reader prices gold in.
  if (gold) {
    const perTola = gold.value * (TOLA_G / OUNCE_G);
    const prevTola = gold.prev !== null ? gold.prev * (TOLA_G / OUNCE_G) : null;
    const pct = prevTola ? ((perTola - prevTola) / prevTola) * 100 : null;
    out.push({
      label: "Gold / tola",
      value: fmt(perTola, 0),
      change: pct !== null ? `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%` : undefined,
      tone: pct === null ? "flat" : pct > 0 ? "up" : pct < 0 ? "down" : "flat",
    });
  }

  if (rupee) {
    const pct = rupee.prev ? ((rupee.value - rupee.prev) / rupee.prev) * 100 : null;
    // A rising USD/PKR is a weaker rupee, so the tone follows the rupee.
    out.push({
      label: "Rupee",
      value: fmt(rupee.value, 2),
      change: pct === null ? undefined : Math.abs(pct) < 0.05 ? "steady" : `${pct > 0 ? "weaker" : "stronger"}`,
      tone: pct === null || Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "down" : "up",
    });
  }

  return out;
}

export const TICKER_EXTRAS_TAG = "ticker-extras";

/** End-of-day series; an hour keeps the tape current without re-reading per request. */
export const getCachedTickerExtras = unstable_cache(build, ["ticker-extras-v1"], {
  revalidate: 3600,
  tags: [TICKER_EXTRAS_TAG],
});
