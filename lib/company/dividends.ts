import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyDividendRow } from "@/lib/company/types";

interface DividendRow {
  announcement_date: string | null;
  ex_date: string | null;
  pay_date: string | null;
  payment_date: string | null;
  dividend_per_share: number | null;
  notes: string | null;
  source: string | null;
}

function classifyKind(notes: string | null): CompanyDividendRow["kind"] {
  const t = (notes ?? "").toLowerCase();
  if (/bonus/.test(t)) return "bonus";
  if (/right/.test(t)) return "right";
  if (/cash|dividend/.test(t)) return "cash";
  return "cash";
}

/**
 * Dividend history for a company, drawn from the structured dividends the
 * dividend engine has already detected for this user. Returns rows newest
 * first; empty when nothing has been recorded yet.
 */
export async function getCompanyDividends(
  supabase: SupabaseClient,
  userId: string,
  ticker: string
): Promise<CompanyDividendRow[]> {
  const { data } = await supabase
    .from("dividends")
    .select("announcement_date, ex_date, pay_date, payment_date, dividend_per_share, notes, source")
    .eq("user_id", userId)
    .eq("ticker", ticker.toUpperCase())
    .order("announcement_date", { ascending: false, nullsFirst: false })
    .limit(40);

  return ((data ?? []) as DividendRow[]).map((d) => {
    const exDate = d.ex_date ?? null;
    const announce = d.announcement_date ?? null;
    return {
      date: announce ?? exDate ?? d.pay_date ?? d.payment_date ?? null,
      announcementDate: announce,
      exDate,
      payDate: d.pay_date ?? d.payment_date ?? null,
      perShare: d.dividend_per_share,
      percentage: null,
      kind: classifyKind(d.notes),
      source: d.source ?? "engine",
    };
  });
}
