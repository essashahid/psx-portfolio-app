import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getDividends } from "@/lib/dividends/summary";
import { getTaxSettings } from "@/lib/dividends/tax";
import { taxYearOf } from "@psx/shared/dividends/tax-year";
import { buildYieldOnCost } from "@psx/shared/dividends/yield-on-cost";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { fillFromSnapshot, snapshotByTicker } from "@/lib/portfolio/snapshot-fallback";
import type {
  DividendRow,
  DividendTaxYear,
  DividendsResponse,
} from "@psx/shared/api/dividends";

/** Received dividends land against the day they were paid. */
function effectiveDate(d: { pay_date: string | null; payment_date: string | null; ex_date: string | null }) {
  return d.pay_date ?? d.payment_date ?? d.ex_date;
}

export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const [dividends, tax, portfolio, daily] = await Promise.all([
      getDividends(supabase, user.id),
      getTaxSettings(supabase, user.id),
      getPortfolio(supabase, user.id),
      // Yield on current value needs a current value. Without this every row
      // shows a dash until the daily cron fills the per-user prices table.
      getDailyHoldingPerformance(supabase, user.id).catch(() => null),
    ]);
    const dayByTicker = daily ? snapshotByTicker(daily) : null;

    const toRow = (d: (typeof dividends)[number]): DividendRow => ({
      id: d.id,
      ticker: d.ticker,
      companyName: d.company_name,
      payDate: effectiveDate(d),
      exDate: d.ex_date,
      perShare: d.dividend_per_share,
      quantityHeld: d.quantity_held,
      amount: Number(d.amount ?? 0),
      tax: d.tax,
      netAmount: d.net_amount,
      status: d.status,
    });

    const received = dividends.filter((d) => d.status === "received");
    const pending = dividends.filter((d) => d.status === "announced" || d.status === "expected");

    // Group received cash by Pakistan tax year, which is the boundary that
    // matters for what is owed. Anything with no usable date is left out of the
    // year buckets rather than silently landing in the wrong one.
    const buckets = new Map<string, DividendTaxYear>();
    for (const d of received) {
      const date = effectiveDate(d);
      if (!date) continue;
      const key = taxYearOf(date);
      const bucket = buckets.get(key) ?? { taxYear: key, gross: 0, tax: 0, net: 0, count: 0 };
      const gross = Number(d.amount ?? 0);
      const withheld = Number(d.tax ?? 0);
      bucket.gross += gross;
      bucket.tax += withheld;
      bucket.net += d.net_amount === null ? gross - withheld : Number(d.net_amount);
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const sortByDateDesc = (a: DividendRow, b: DividendRow) =>
      (b.payDate ?? "").localeCompare(a.payDate ?? "");

    const body: DividendsResponse = {
      receivedTotal: received.reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
      receivedNetTotal: received.reduce(
        (sum, d) => sum + (d.net_amount === null ? Number(d.amount ?? 0) - Number(d.tax ?? 0) : Number(d.net_amount)),
        0
      ),
      upcomingTotal: pending.reduce((sum, d) => sum + Number(d.amount ?? 0), 0),
      byTaxYear: [...buckets.values()].sort((a, b) => b.taxYear.localeCompare(a.taxYear)),
      recent: received.map(toRow).sort(sortByDateDesc).slice(0, 50),
      upcoming: pending.map(toRow).sort((a, b) => (a.payDate ?? "").localeCompare(b.payDate ?? "")),
      taxRatePct: tax.dividend_tax_rate ?? null,
      yieldOnCost: buildYieldOnCost(
        portfolio.holdings.map((h) => {
          const totalCost = h.total_cost === null ? null : Number(h.total_cost);
          const priced = fillFromSnapshot(
            {
              latestPrice: h.latest_price,
              priceDate: h.price_date,
              marketValue: h.market_value,
              unrealizedPl: h.unrealized_pl,
              unrealizedPlPct: h.unrealized_pl_pct,
            },
            Number(h.quantity),
            totalCost,
            dayByTicker?.get(h.ticker),
            daily?.asOf ?? null
          );
          return {
            ticker: h.ticker,
            companyName: h.company_name,
            totalCost,
            marketValue: priced.marketValue,
          };
        }),
        dividends.map((d) => ({
          ticker: d.ticker,
          status: d.status,
          date: effectiveDate(d),
          net: d.net_amount ?? d.amount,
        })),
        new Date().toISOString().slice(0, 10)
      ),
      count: dividends.length,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
