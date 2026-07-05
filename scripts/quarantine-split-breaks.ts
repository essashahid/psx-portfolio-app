import { loadEnvLocal } from "./load-env";

/**
 * Share-count-break sweep (free, no LLM): finds portal annual EPS rows that are
 * NOT adjusted for a later stock split/bonus and quarantines them so EPS
 * growth / CAGR are never computed across the break.
 *
 * The tell: implied share count (PAT ÷ EPS) is stable for a company unless
 * shares change. LUCK's portal series shows FY2024/25 EPS split-adjusted
 * (implied ~1.47B shares) but FY2022/23 unadjusted (implied ~0.29B — exactly
 * 5x off, its March-2025 5-for-1 split). CAGR from the unadjusted base is
 * garbage. Rows whose implied share count differs >2.5x from the NEWEST
 * annual's implied count are flagged `share_count_break` and set needs_review.
 *
 *   npx tsx scripts/quarantine-split-breaks.ts            # dry run
 *   npx tsx scripts/quarantine-split-breaks.ts --apply
 */

interface Row {
  id: string;
  ticker: string;
  fiscal_year: number | null;
  validation_flags: unknown;
  data: Record<string, unknown>;
}

const num = (d: Record<string, unknown>, k: string): number | null => {
  const v = d[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("company_financials")
      .select("id, ticker, fiscal_year, validation_flags, data")
      .eq("statement_type", "income_statement")
      .eq("period_type", "annual")
      .eq("source_type", "psx-portal")
      .eq("review_status", "published")
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const byTicker = new Map<string, Row[]>();
  for (const r of rows) (byTicker.get(r.ticker) ?? byTicker.set(r.ticker, []).get(r.ticker)!).push(r);

  const flagged: { row: Row; ratio: number }[] = [];
  for (const [, trs] of byTicker) {
    // implied shares = PAT (thousands) * 1000 / EPS; needs positive PAT & EPS
    const implied = (r: Row): number | null => {
      const pat = num(r.data, "profit_after_tax");
      const eps = num(r.data, "eps");
      if (pat === null || eps === null || pat <= 0 || eps <= 0.25) return null;
      return (pat * 1000) / eps;
    };
    const dated = trs.filter((r) => r.fiscal_year !== null).sort((a, b) => b.fiscal_year! - a.fiscal_year!);
    const anchor = dated.map(implied).find((v) => v !== null);
    if (!anchor) continue;
    for (const r of dated.slice(1)) {
      const s = implied(r);
      if (s === null) continue;
      const ratio = anchor / s;
      if (ratio > 2.5 || ratio < 1 / 2.5) flagged.push({ row: r, ratio });
    }
  }

  const tickers = [...new Set(flagged.map((f) => f.row.ticker))];
  console.log(`Rows with a share-count break vs the latest annual: ${flagged.length} across ${tickers.length} tickers`);
  for (const f of flagged.slice(0, 30)) {
    console.log(`  ${f.row.ticker} FY${f.row.fiscal_year}: implied shares ${f.ratio > 1 ? (1 / f.ratio).toFixed(2) : f.ratio.toFixed(2)}x of current (factor ${f.ratio > 1 ? f.ratio.toFixed(1) : (1 / f.ratio).toFixed(1)})`);
  }
  if (flagged.length > 30) console.log(`  … +${flagged.length - 30} more`);

  if (!apply) {
    console.log(`\nDRY RUN — re-run with --apply to quarantine.`);
    return;
  }

  let updated = 0;
  for (const { row } of flagged) {
    const existing = Array.isArray(row.validation_flags) ? (row.validation_flags as string[]) : [];
    const { error } = await db
      .from("company_financials")
      .update({ review_status: "needs_review", validation_flags: [...new Set([...existing, "share_count_break"])] })
      .eq("id", row.id);
    if (!error) updated++;
  }
  console.log(`\nQuarantined ${updated} rows. Recomputing ratios for ${tickers.length} tickers...`);
  const { refreshRatios } = await import("@/lib/engine/ratios");
  let ok = 0;
  for (const t of tickers) if (await refreshRatios(db, t).catch(() => null)) ok++;
  console.log(`Recomputed ${ok}/${tickers.length}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
