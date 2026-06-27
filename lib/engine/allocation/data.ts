import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetClass, MonthlyReturns } from "./types";
import { PBS_NATIONAL_CPI } from "@/lib/market-data/pbs-cpi";
import { readMacroSeries, tbillYieldOn, type DataQuality } from "@/lib/market-data/macro-assets";

/**
 * Loads the aligned monthly real-PKR return matrix the allocation engine runs
 * on. Risk and correlation are estimated over the longest available nominal
 * history; returns are expressed in real terms by deflating with CPI. The
 * seeded PBS CPI table only reaches back to 2023, so months before it use a
 * single documented long-run inflation assumption (flagged in data quality),
 * rather than fabricating monthly index points we do not have.
 */

const FALLBACK_ANNUAL_INFLATION = 0.09; // ~9%/yr long-run PKR CPI before the seeded table
const FALLBACK_MONTHLY_INFLATION = Math.pow(1 + FALLBACK_ANNUAL_INFLATION, 1 / 12) - 1;

const CPI_MONTHS = Object.keys(PBS_NATIONAL_CPI).sort();
const CPI_FIRST_MONTH = CPI_MONTHS[0];

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** Month-over-month CPI inflation, or the fallback rate before the seeded table. */
function monthlyInflation(month: string, prevMonth: string): number {
  const cur = PBS_NATIONAL_CPI[month];
  const prev = PBS_NATIONAL_CPI[prevMonth];
  if (cur !== undefined && prev !== undefined && prev > 0) return cur / prev - 1;
  return FALLBACK_MONTHLY_INFLATION;
}

/** Reduce daily points to the last close seen in each calendar month. */
export function monthlyCloses(points: DailyPoint[]): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const p of [...points].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (Number.isFinite(p.value) && p.value > 0) byMonth.set(p.date.slice(0, 7), p.value);
  }
  return byMonth;
}

function prevMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export interface ReturnInputs {
  equityLevels: DailyPoint[]; // KSE-100 (PKR)
  goldLevels: DailyPoint[]; // gold in PKR
  btcLevels: DailyPoint[]; // BTC in PKR
  /** Monthly T-bill annualised yield % keyed by month, or a function. */
  tbillYieldPct: (month: string) => number;
}

/**
 * Build the aligned monthly real-PKR return series. A month is included only
 * when equity, gold and BTC all have a close that month and the prior month
 * (cash is always derivable from the yield path). This keeps the matrix honest:
 * no asset is forward-filled across a gap it does not have.
 */
export function buildMonthlyReturns(inputs: ReturnInputs): MonthlyReturns[] {
  const eq = monthlyCloses(inputs.equityLevels);
  const gd = monthlyCloses(inputs.goldLevels);
  const bt = monthlyCloses(inputs.btcLevels);

  // Common months present across the three priced assets.
  const months = [...eq.keys()].filter((m) => gd.has(m) && bt.has(m)).sort();

  const out: MonthlyReturns[] = [];
  for (let i = 1; i < months.length; i++) {
    const m = months[i];
    const pm = months[i - 1];
    // Require consecutive months for a clean monthly return.
    if (prevMonthKey(m) !== pm) continue;

    const infl = monthlyInflation(m, pm);
    const real = (nominal: number) => (1 + nominal) / (1 + infl) - 1;

    const eqRet = eq.get(m)! / eq.get(pm)! - 1;
    const gdRet = gd.get(m)! / gd.get(pm)! - 1;
    const btRet = bt.get(m)! / bt.get(pm)! - 1;
    const cashNominal = Math.pow(1 + inputs.tbillYieldPct(m) / 100, 1 / 12) - 1;

    const returns: Record<AssetClass, number> = {
      equity: real(eqRet),
      gold: real(gdRet),
      btc: real(btRet),
      cash: real(cashNominal),
    };
    out.push({ month: m, returns });
  }
  return out;
}

export interface MacroQuality {
  equity: DataQuality;
  gold: DataQuality;
  btc: DataQuality;
  /** True for months before the seeded CPI table (real returns use the fallback). */
  inflationAssumedBefore: string;
}

export interface LoadedReturns {
  series: MonthlyReturns[];
  quality: MacroQuality;
  /** Evidence depth per priced asset, in months of available history. */
  monthsByAsset: Record<"equity" | "gold" | "btc", number>;
  /** First month (YYYY-MM) each priced asset has data, for backtest windows. */
  firstMonths: Record<"equity" | "gold" | "btc", string | null>;
  /** USD/PKR daily history, for the PKR-depreciation signal. */
  usdpkr: DailyPoint[];
}

/**
 * Production loader: equity (KSE-100) from the shared eod_history cache, gold and
 * BTC (PKR) from macro_asset_history, cash from the T-bill step path.
 */
export async function loadMonthlyReturns(supabase: SupabaseClient): Promise<LoadedReturns> {
  const [{ data: kseRows }, gold, btc, usd] = await Promise.all([
    supabase
      .from("eod_history")
      .select("trade_date, close")
      .eq("ticker", "KSE100")
      .order("trade_date", { ascending: true }),
    readMacroSeries(supabase, "GOLD"),
    readMacroSeries(supabase, "BTC"),
    readMacroSeries(supabase, "USDPKR"),
  ]);

  const equityLevels: DailyPoint[] = (kseRows ?? []).map((r) => ({
    date: r.trade_date as string,
    value: Number(r.close),
  }));
  const goldLevels: DailyPoint[] = gold.points.map((p) => ({ date: p.date, value: p.value }));
  const btcLevels: DailyPoint[] = btc.points.map((p) => ({ date: p.date, value: p.value }));

  const series = buildMonthlyReturns({
    equityLevels,
    goldLevels,
    btcLevels,
    tbillYieldPct: (month) => tbillYieldOn(`${month}-15`),
  });

  const equityQuality: DataQuality = equityLevels.length === 0 ? "missing" : equityLevels.length < 60 ? "limited" : "good";
  const firstMonth = (pts: DailyPoint[]): string | null => (pts.length ? [...pts].sort((a, b) => (a.date < b.date ? -1 : 1))[0].date.slice(0, 7) : null);

  return {
    series,
    quality: {
      equity: equityQuality,
      gold: gold.quality,
      btc: btc.quality,
      inflationAssumedBefore: CPI_FIRST_MONTH,
    },
    monthsByAsset: {
      equity: monthlyCloses(equityLevels).size,
      gold: monthlyCloses(goldLevels).size,
      btc: monthlyCloses(btcLevels).size,
    },
    firstMonths: {
      equity: firstMonth(equityLevels),
      gold: firstMonth(goldLevels),
      btc: firstMonth(btcLevels),
    },
    usdpkr: usd.points.map((p) => ({ date: p.date, value: p.value })),
  };
}
