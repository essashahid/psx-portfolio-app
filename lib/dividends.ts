import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dividend, EnrichedHolding } from "@/lib/types";

export interface DividendSummary {
  totalGross: number;
  totalTax: number;
  netReceived: number;
  expectedNet: number;
  pendingCount: number;
  receivedCount: number;
  topPayers: { ticker: string; net: number }[];
}

export function normalizeDividend(row: Record<string, unknown>): Dividend {
  return {
    id: String(row.id),
    ticker: row.ticker ? String(row.ticker) : null,
    company_name: row.company_name ? String(row.company_name) : null,
    announcement_date: row.announcement_date ? String(row.announcement_date) : null,
    ex_date: row.ex_date ? String(row.ex_date) : null,
    pay_date: row.pay_date ? String(row.pay_date) : null,
    payment_date: row.payment_date ? String(row.payment_date) : row.pay_date ? String(row.pay_date) : null,
    dividend_per_share: row.dividend_per_share !== null && row.dividend_per_share !== undefined ? Number(row.dividend_per_share) : null,
    quantity_held: row.quantity_held !== null && row.quantity_held !== undefined ? Number(row.quantity_held) : null,
    amount: Number(row.amount ?? 0),
    tax: row.tax !== null && row.tax !== undefined ? Number(row.tax) : null,
    net_amount: row.net_amount !== null && row.net_amount !== undefined ? Number(row.net_amount) : null,
    status: ["announced", "expected", "received", "missing"].includes(String(row.status))
      ? (String(row.status) as Dividend["status"])
      : "received",
    source: row.source ? String(row.source) : "manual",
    notes: row.notes ? String(row.notes) : null,
    created_at: row.created_at ? String(row.created_at) : "",
  };
}

export async function getDividends(
  supabase: SupabaseClient,
  userId: string,
  opts: { ticker?: string } = {}
): Promise<Dividend[]> {
  let query = supabase
    .from("dividends")
    .select("*")
    .eq("user_id", userId)
    .order("payment_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (opts.ticker) query = query.eq("ticker", opts.ticker);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => normalizeDividend(row as Record<string, unknown>));
}

export function summarizeDividends(dividends: Dividend[]): DividendSummary {
  const byTicker = new Map<string, number>();
  let totalGross = 0;
  let totalTax = 0;
  let netReceived = 0;
  let expectedNet = 0;
  let pendingCount = 0;
  let receivedCount = 0;

  for (const d of dividends) {
    const gross = Number(d.amount ?? 0);
    const tax = Number(d.tax ?? 0);
    const net = Number(d.net_amount ?? gross - tax);
    totalGross += gross;
    totalTax += tax;
    if (d.status === "received") {
      receivedCount++;
      netReceived += net;
      if (d.ticker) byTicker.set(d.ticker, (byTicker.get(d.ticker) ?? 0) + net);
    } else {
      pendingCount++;
      if (d.status === "announced" || d.status === "expected") expectedNet += net;
    }
  }

  return {
    totalGross,
    totalTax,
    netReceived,
    expectedNet,
    pendingCount,
    receivedCount,
    topPayers: [...byTicker.entries()]
      .map(([ticker, net]) => ({ ticker, net }))
      .sort((a, b) => b.net - a.net)
      .slice(0, 5),
  };
}

export function quantityForTicker(holdings: EnrichedHolding[], ticker: string): number | null {
  const holding = holdings.find((h) => h.ticker === ticker);
  return holding ? Number(holding.quantity) : null;
}

export function companyForTicker(holdings: EnrichedHolding[], ticker: string): string | null {
  const holding = holdings.find((h) => h.ticker === ticker);
  return holding?.company_name ?? null;
}
