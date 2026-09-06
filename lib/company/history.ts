import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily closes for one ticker, oldest first, beyond the 1,000-row page that
 * PostgREST returns however large a `limit` asks for. A five-year series is
 * about 1,250 rows, so a single query stops a year short and every "today"
 * figure built on it is silently stale. Two ranged reads cover it.
 */
export interface CloseRow {
  date: string;
  close: number;
}

const PAGE = 1000;

export async function loadCloses(supabase: SupabaseClient, ticker: string, maxRows = 2000): Promise<CloseRow[]> {
  const out: CloseRow[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("price_date, close")
      .eq("ticker", ticker.toUpperCase())
      .order("price_date", { ascending: true })
      .range(from, Math.min(from + PAGE, maxRows) - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      const close = Number(r.close);
      if (Number.isFinite(close) && close > 0) out.push({ date: String(r.price_date), close });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}
