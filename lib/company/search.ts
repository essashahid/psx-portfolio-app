import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPsxSymbols, type PsxSymbolInfo } from "@/lib/market-data/psx-dps";

export interface StockSearchResult {
  ticker: string;
  companyName: string | null;
  sector: string | null;
}

// Module-level cache of the full PSX directory so search stays instant after
// the first warm-up (the directory is ~1,050 rows from a single request).
let directoryCache: { map: Map<string, PsxSymbolInfo>; at: number } | null = null;
const DIRECTORY_TTL_MS = 1000 * 60 * 60 * 12;

async function getDirectory(): Promise<Map<string, PsxSymbolInfo>> {
  if (directoryCache && Date.now() - directoryCache.at < DIRECTORY_TTL_MS && directoryCache.map.size > 0) {
    return directoryCache.map;
  }
  const map = await fetchPsxSymbols();
  if (map.size > 0) directoryCache = { map, at: Date.now() };
  return map;
}

function score(query: string, ticker: string, name: string): number {
  const q = query.toUpperCase();
  const t = ticker.toUpperCase();
  const n = name.toUpperCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (n.startsWith(q)) return 2;
  if (t.includes(q)) return 3;
  if (n.includes(q)) return 4;
  return 5;
}

/**
 * Ticker + company-name search across the PSX universe. Merges the official
 * symbol directory with whatever is in stock_master, ranks by match quality,
 * and returns at most `limit` rows. Resilient to the directory being offline —
 * it still serves stock_master matches.
 */
export async function searchStocks(
  supabase: SupabaseClient,
  query: string,
  opts: { limit?: number; sector?: string } = {}
): Promise<StockSearchResult[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const limit = opts.limit ?? 20;

  const merged = new Map<string, StockSearchResult>();

  const [{ data: masterRows }, directory] = await Promise.all([
    supabase
      .from("stock_master")
      .select("ticker, company_name, sector")
      .or(`ticker.ilike.%${q}%,company_name.ilike.%${q}%`)
      .limit(50),
    getDirectory().catch(() => new Map<string, PsxSymbolInfo>()),
  ]);

  for (const r of masterRows ?? []) {
    merged.set(r.ticker.toUpperCase(), {
      ticker: r.ticker.toUpperCase(),
      companyName: r.company_name ?? null,
      sector: r.sector ?? null,
    });
  }

  const qu = q.toUpperCase();
  for (const [ticker, info] of directory) {
    if (!ticker.includes(qu) && !info.name.toUpperCase().includes(qu)) continue;
    const existing = merged.get(ticker);
    merged.set(ticker, {
      ticker,
      companyName: existing?.companyName ?? info.name,
      sector: existing?.sector ?? (info.sector || null),
    });
  }

  let results = [...merged.values()];
  if (opts.sector) {
    const s = opts.sector.toLowerCase();
    results = results.filter((r) => (r.sector ?? "").toLowerCase() === s);
  }

  return results
    .sort((a, b) => {
      const sa = score(q, a.ticker, a.companyName ?? "");
      const sb = score(q, b.ticker, b.companyName ?? "");
      if (sa !== sb) return sa - sb;
      return a.ticker.localeCompare(b.ticker);
    })
    .slice(0, limit);
}
