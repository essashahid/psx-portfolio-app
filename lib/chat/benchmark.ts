import type { SupabaseClient } from "@supabase/supabase-js";
import { getCachedEod, KSE_SYMBOL, type ClosePoint } from "@/lib/market-data/eod-cache";
import { fmtPct } from "@/lib/market/format";
import type { HoldingsSummary } from "@/lib/chat/data";

/**
 * Per-holding and whole-portfolio price returns against the KSE-100 over fixed
 * windows, so "is this earning its place" becomes a number: "MEBL +18% vs
 * KSE-100 +6% over 6 months". Everything is pre-computed from the shared
 * company_price_history close cache (the same series the /performance benchmark uses) so
 * the model narrates the excess return, never recomputes it. Returns null when
 * the index history is not cached, so we never fabricate a comparison.
 */

const WINDOWS: { label: string; days: number }[] = [
  { label: "6-month", days: 182 },
  { label: "12-month", days: 365 },
];

export interface BenchmarkRow {
  ticker: string;
  weightPct: number | null;
  returnPct: number | null;
  excessPct: number | null;
}

export interface BenchmarkWindow {
  label: string;
  from: string | null;
  benchReturnPct: number | null;
  rows: BenchmarkRow[];
  portfolioReturnPct: number | null;
  portfolioExcessPct: number | null;
}

export interface BenchmarkPerformance {
  asOf: string;
  windows: BenchmarkWindow[];
}

function closeOnOrBefore(points: ClosePoint[], date: string): ClosePoint | null {
  let chosen: ClosePoint | null = null;
  for (const p of points) {
    if (p.date <= date) chosen = p;
    else break;
  }
  return chosen;
}

/** Percent return from the close nearest on-or-before (latest - days) to latest. */
function windowReturn(points: ClosePoint[] | undefined, latestDate: string, days: number): { from: string; pct: number } | null {
  if (!points || points.length < 2) return null;
  const latest = points[points.length - 1];
  const baseDate = new Date(Date.parse(latestDate) - days * 86_400_000).toISOString().slice(0, 10);
  const base = closeOnOrBefore(points, baseDate);
  if (!base || base.date === latest.date || base.close <= 0) return null;
  return { from: base.date, pct: (latest.close / base.close - 1) * 100 };
}

/**
 * Build the benchmark comparison. `focusTickers` are always listed as rows (the
 * names the question is about); when `holdings` is present, its held names fill
 * in weights and drive the current-weight-weighted portfolio return.
 */
export async function getBenchmarkPerformance(
  supabase: SupabaseClient,
  opts: { focusTickers: string[]; holdings: HoldingsSummary | null }
): Promise<BenchmarkPerformance | null> {
  const held = (opts.holdings?.holdings ?? []).map((h) => h.ticker.toUpperCase());
  const focus = opts.focusTickers.map((t) => t.toUpperCase());
  const symbols = [...new Set([...focus, ...held])];
  if (symbols.length === 0) return null;

  const eod = await getCachedEod(supabase, symbols);
  const kse = eod.get(KSE_SYMBOL);
  if (!kse || kse.length < 2) return null;
  const asOf = kse[kse.length - 1].date;

  const weightByTicker = new Map<string, number | null>(
    (opts.holdings?.holdings ?? []).map((h) => [h.ticker.toUpperCase(), h.weightPct])
  );

  // Row tickers: the focus names, or all held names when no explicit focus.
  const rowTickers = focus.length ? focus : held;

  const windows: BenchmarkWindow[] = WINDOWS.map(({ label, days }) => {
    const bench = windowReturn(kse, asOf, days);
    const benchReturnPct = bench?.pct ?? null;

    const rows: BenchmarkRow[] = rowTickers.map((ticker) => {
      const r = windowReturn(eod.get(ticker), asOf, days);
      return {
        ticker,
        weightPct: weightByTicker.get(ticker) ?? null,
        returnPct: r?.pct ?? null,
        excessPct: r && benchReturnPct != null ? r.pct - benchReturnPct : null,
      };
    });

    // Current-weight-weighted portfolio return across held names with both a
    // weight and a window return, normalised over the weight actually covered.
    let weightedSum = 0;
    let weightCovered = 0;
    for (const t of held) {
      const w = weightByTicker.get(t);
      if (w == null || w <= 0) continue;
      const r = windowReturn(eod.get(t), asOf, days);
      if (!r) continue;
      weightedSum += (w / 100) * r.pct;
      weightCovered += w / 100;
    }
    const portfolioReturnPct = weightCovered > 0 ? weightedSum / weightCovered : null;

    return {
      label,
      from: bench?.from ?? null,
      benchReturnPct,
      rows,
      portfolioReturnPct,
      portfolioExcessPct:
        portfolioReturnPct != null && benchReturnPct != null ? portfolioReturnPct - benchReturnPct : null,
    };
  });

  // Drop windows where the index has no base (too little history) and every row is empty.
  const usable = windows.filter((w) => w.benchReturnPct != null && (w.rows.some((r) => r.returnPct != null) || w.portfolioReturnPct != null));
  if (usable.length === 0) return null;

  return { asOf, windows: usable };
}

/** Render the benchmark comparison as compact per-window tables. */
export function briefFromBenchmark(perf: BenchmarkPerformance): string {
  const out: string[] = [`## Performance vs KSE-100 (pre-computed price returns; do not recompute)`, `Closes as of ${perf.asOf}.`];

  for (const w of perf.windows) {
    const lines: string[] = [`### ${w.label} return`];
    lines.push(`| Ticker | Weight | Return | KSE-100 | Excess |`);
    lines.push(`|---|---|---|---|---|`);
    for (const r of w.rows) {
      lines.push(
        `| ${r.ticker} | ${r.weightPct != null ? `${r.weightPct.toFixed(1)}%` : "—"} | ${fmtPct(r.returnPct)} | ${fmtPct(w.benchReturnPct)} | ${fmtPct(r.excessPct)} |`
      );
    }
    if (w.portfolioReturnPct != null) {
      lines.push(
        `| Portfolio (current weights) | — | ${fmtPct(w.portfolioReturnPct)} | ${fmtPct(w.benchReturnPct)} | ${fmtPct(w.portfolioExcessPct)} |`
      );
    }
    out.push(lines.join("\n"));
  }

  out.push(`Excess is the name's return minus the KSE-100 over the same window; positive means it earned its place versus simply owning the index.`);
  return out.join("\n\n");
}
