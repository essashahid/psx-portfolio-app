/**
 * Reconcile quarterly rows against the cumulative row that covers them.
 *
 * Recovering the comparative columns leaves some companies holding two rows
 * for the same period from different reads — KOHC ended up with 2025 Q1 at
 * both 3.51 (correct, from the re-extraction) and 3.20 (stale, from the
 * fiscal-year mislabel). Today that is harmless because the engine prefers a
 * directly-extracted cumulative row and never reaches the quarter-sum
 * fallback. But cumulativeField() resolves duplicates with .find(), so the
 * answer depends on row order the moment the cumulative row is absent.
 *
 * A cumulative row read straight off a filing is the stronger evidence: it is
 * one printed figure rather than a sum of three. So where quarters disagree
 * with it beyond a rounding tolerance, the quarters are wrong.
 *
 *   for each (ticker, year) with a published cumulative row (H1 or 9M):
 *     compare it against the sum of the quarters it should cover
 *     if they disagree, and a duplicate quarter exists, quarantine the
 *     quarter whose removal reconciles the sum
 *
 * Only duplicates are ever quarantined. A single quarter that disagrees is
 * reported but left alone: it might be the cumulative that is wrong, and this
 * script does not have the evidence to decide.
 *
 *   npx tsx scripts/reconcile-quarter-rows.ts          # report
 *   npx tsx scripts/reconcile-quarter-rows.ts --apply
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const APPLY = process.argv.includes("--apply");
const TOL = 0.02; // rupees per share; EPS is printed to 2dp

type Row = {
  id: string;
  ticker: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  source_type: string | null;
  reported_date: string | null;
  data: Record<string, number | null> | null;
};

const eps = (r: Row): number | null => {
  const v = r.data?.eps;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const rows: Row[] = [];
  for (let o = 0; ; o += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("id,ticker,fiscal_year,fiscal_period,source_type,reported_date,data")
      .eq("statement_type", "income_statement")
      .eq("review_status", "published")
      .range(o, o + 999);
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const key = (t: string, y: number | null) => `${t}|${y}`;
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r.ticker, r.fiscal_year);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const quarantine: { row: Row; why: string }[] = [];
  const reportOnly: string[] = [];

  for (const [k, g] of groups) {
    const [ticker] = k.split("|");
    const at = (p: string) => g.filter((r) => (r.fiscal_period ?? "").toUpperCase() === p);

    for (const [cumLabel, quarters] of [
      ["H1", ["Q1", "Q2"]],
      ["9M", ["Q1", "Q2", "Q3"]],
    ] as const) {
      const cums = at(cumLabel).filter((r) => eps(r) !== null);
      if (cums.length !== 1) continue;
      const target = eps(cums[0])!;

      // Every combination of one row per quarter; if some quarter is missing
      // entirely there is nothing to reconcile.
      const options = quarters.map((q) => at(q).filter((r) => eps(r) !== null));
      if (options.some((o) => o.length === 0)) continue;
      const hasDuplicate = options.some((o) => o.length > 1);

      const combos: Row[][] = options.reduce<Row[][]>(
        (acc, opts) => acc.flatMap((prefix) => opts.map((o) => [...prefix, o])),
        [[]]
      );
      const matching = combos.filter((c) => Math.abs(c.reduce((s, r) => s + eps(r)!, 0) - target) <= TOL);

      if (matching.length === 0) {
        reportOnly.push(
          `${ticker} ${cums[0].fiscal_year}: ${cumLabel} eps ${target} but no combination of ${quarters.join("+")} sums to it (best ${combos
            .map((c) => c.reduce((s, r) => s + eps(r)!, 0).toFixed(2))
            .join(", ")})`
        );
        continue;
      }
      if (!hasDuplicate) continue; // already consistent, nothing to do

      // Quarters that appear in NO matching combination are contradicted.
      const keep = new Set(matching.flat().map((r) => r.id));
      for (const opts of options) {
        if (opts.length < 2) continue;
        for (const r of opts) {
          if (keep.has(r.id)) continue;
          quarantine.push({
            row: r,
            why: `${ticker} ${r.fiscal_year} ${r.fiscal_period} eps ${eps(r)} is excluded by the ${cumLabel} total of ${target}`,
          });
        }
      }
    }
  }

  const unique = new Map(quarantine.map((q) => [q.row.id, q]));
  console.log(APPLY ? "APPLYING\n" : "DRY RUN (pass --apply to write)\n");
  console.log(`${unique.size} duplicate quarters contradicted by a cumulative row`);
  console.log(`${reportOnly.length} companies where no quarter combination reconciles (reported only, not touched)\n`);

  for (const q of [...unique.values()].slice(0, 25)) console.log(`  ${q.why}  [${q.row.source_type}]`);
  if (unique.size > 25) console.log(`  ... and ${unique.size - 25} more`);

  if (reportOnly.length) {
    console.log(`\nunreconciled (first 15):`);
    for (const r of reportOnly.slice(0, 15)) console.log(`  ${r}`);
  }

  if (!APPLY) return;

  let n = 0;
  for (const q of unique.values()) {
    const { error } = await db
      .from("company_financials")
      .update({ review_status: "needs_review", validation_flags: ["contradicted_by_cumulative"] })
      .eq("id", q.row.id);
    if (!error) n++;
  }
  console.log(`\nquarantined ${n}`);

  const affected = [...new Set([...unique.values()].map((q) => q.row.ticker))];
  const { refreshRatios } = await import("@/lib/engine/ratios");
  for (const t of affected) await refreshRatios(db, t);
  console.log(`recomputed ratios for ${affected.length} companies`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
