import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// Tag that invalidates the cached stock_master read. The universe sync and the
// holdings-enrichment upsert call invalidateStockMaster() after writing.
export const STOCK_MASTER_TAG = "stock-master";

export interface StockMasterRow {
  ticker: string;
  company_name: string;
  sector: string | null;
  face_value: number | null;
}

// stock_master is small (~PSX listings count), globally readable, and only
// rewritten by the universe sync / enrichment jobs — so reading the whole table
// once and serving it from the data cache removes repeated round-trips from the
// dividend, payout and company-identity flows.
async function readStockMaster(): Promise<StockMasterRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("stock_master")
    .select("ticker, company_name, sector, face_value");
  return (data ?? []) as StockMasterRow[];
}

const loadStockMasterCached = unstable_cache(readStockMaster, ["stock-master-v1"], {
  tags: [STOCK_MASTER_TAG],
  revalidate: 3600,
});

export async function getStockMasterRows(): Promise<StockMasterRow[]> {
  try {
    return await loadStockMasterCached();
  } catch {
    // No Next data-cache context (e.g. a standalone tsx script) — unstable_cache
    // throws its "incrementalCache missing" invariant there, so read directly.
    return readStockMaster();
  }
}

export async function getStockMasterMap(): Promise<Map<string, StockMasterRow>> {
  const rows = await getStockMasterRows();
  return new Map(rows.map((r) => [r.ticker, r]));
}

export function invalidateStockMaster(): void {
  try {
    revalidateTag(STOCK_MASTER_TAG, "max");
  } catch {
    // Outside a request context (scripts) there is no cache to invalidate.
  }
}
