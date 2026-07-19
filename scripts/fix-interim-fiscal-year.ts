/**
 * Fix the fiscal-year off-by-one on interim filing extractions.
 *
 * PSX fiscal years are labelled by the calendar year the year ENDS in. For a
 * June year-end company the quarter ended 30 September 2025 is Q1 of FY2026,
 * not FY2025. The vision extraction was taking the calendar year of the
 * period end instead, so every interim whose period ends in the calendar year
 * BEFORE the fiscal year end came in one year early:
 *
 *   Q1 ends September  -> prior calendar year -> mislabelled
 *   Q2 ends December   -> prior calendar year -> mislabelled
 *   Q3 ends March      -> same calendar year  -> correct
 *   FY ends June       -> same calendar year  -> correct
 *
 * The damage is not just a wrong label. The mislabelled row lands in the
 * PRIOR-YEAR slot, which is the slot the trailing-12m chain reads for its
 * comparative leg (TTM = annual + current interim - prior-year interim). So
 * current-year data masquerades as the comparative, the chain either fails or
 * returns nonsense, and P/E silently falls back to a stale annual EPS. That is
 * exactly what happened to BWCL, KOHC and PIOC.
 *
 * Only rows that PROVE the mislabel are touched: a psx-filing row whose eps
 * and revenue exactly equal a psx-portal row one fiscal year later. The portal
 * labels these correctly, so an exact match on both figures is direct evidence
 * that the two describe the same period and the filing row's year is wrong.
 * Rows without that corroboration are left alone rather than guessed at.
 *
 *   npx tsx scripts/fix-interim-fiscal-year.ts          # dry run
 *   npx tsx scripts/fix-interim-fiscal-year.ts --apply
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const APPLY = process.argv.includes("--apply");

type Row = {
  id: string;
  ticker: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_type: string | null;
  statement_type: string;
  reporting_basis: string | null;
  source_type: string | null;
  reported_date: string | null;
  review_status: string | null;
  data: Record<string, number | null> | null;
};

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const all: Row[] = [];
  for (let o = 0; ; o += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("id,ticker,fiscal_year,fiscal_period,period_type,statement_type,reporting_basis,source_type,reported_date,review_status,data")
      .eq("statement_type", "income_statement")
      .range(o, o + 999);
    if (!data?.length) break;
    all.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const figures = (r: Row): string | null => {
    const eps = r.data?.eps;
    const rev = r.data?.revenue;
    return typeof eps === "number" && typeof rev === "number" ? `${eps}|${rev}` : null;
  };

  // Portal rows keyed by ticker/period/figures/year — the corroborating source.
  const portal = new Map<string, Row>();
  for (const r of all) {
    if (r.source_type !== "psx-portal") continue;
    const f = figures(r);
    if (f) portal.set(`${r.ticker}|${r.fiscal_period}|${f}|${r.fiscal_year}`, r);
  }

  // Existing filing rows, so a relabel never collides with a correct row.
  const filingAt = new Set(
    all
      .filter((r) => r.source_type === "psx-filing")
      .map((r) => `${r.ticker}|${r.period_type}|${r.fiscal_year}|${r.fiscal_period}|${r.reporting_basis}`)
  );

  const relabel: { row: Row; to: number }[] = [];
  const collide: { row: Row; to: number }[] = [];

  for (const r of all) {
    if (r.source_type !== "psx-filing" || r.review_status !== "published") continue;
    const f = figures(r);
    if (!f || r.fiscal_year === null) continue;
    const to = r.fiscal_year + 1;
    if (!portal.has(`${r.ticker}|${r.fiscal_period}|${f}|${to}`)) continue;

    if (filingAt.has(`${r.ticker}|${r.period_type}|${to}|${r.fiscal_period}|${r.reporting_basis}`)) {
      collide.push({ row: r, to });
    } else {
      relabel.push({ row: r, to });
    }
  }

  console.log(APPLY ? "APPLYING\n" : "DRY RUN (pass --apply to write)\n");
  console.log(`${relabel.length} rows to relabel one fiscal year forward`);
  console.log(`${collide.length} rows already have a correct filing row at the target year (quarantine instead)\n`);

  const byPeriod = new Map<string, number>();
  for (const { row } of relabel) byPeriod.set(row.fiscal_period ?? "?", (byPeriod.get(row.fiscal_period ?? "?") ?? 0) + 1);
  for (const [p, n] of [...byPeriod].sort((a, b) => b[1] - a[1])) console.log(`  ${p}: ${n}`);

  console.log("\nsample:");
  for (const { row, to } of relabel.slice(0, 8)) {
    console.log(`  ${row.ticker.padEnd(7)} ${row.fiscal_year} ${row.fiscal_period} -> ${to} ${row.fiscal_period}   (filed ${row.reported_date ?? "?"}, eps ${row.data?.eps})`);
  }

  if (!APPLY) return;

  let ok = 0;
  let failed = 0;
  for (const { row, to } of relabel) {
    const { error } = await db
      .from("company_financials")
      .update({ fiscal_year: to, validation_flags: ["fiscal_year_corrected"] })
      .eq("id", row.id);
    if (error) {
      console.log(`  ERROR ${row.ticker} ${row.fiscal_year} ${row.fiscal_period}: ${error.message}`);
      failed++;
    } else ok++;
  }
  for (const { row } of collide) {
    const { error } = await db
      .from("company_financials")
      .update({ review_status: "needs_review", validation_flags: ["fiscal_year_mislabelled", "superseded"] })
      .eq("id", row.id);
    if (!error) ok++;
  }
  console.log(`\nupdated ${ok}, failed ${failed}`);

  const affected = [...new Set([...relabel, ...collide].map((x) => x.row.ticker))];
  const { refreshRatios } = await import("@/lib/engine/ratios");
  console.log(`\nrecomputing ratios for ${affected.length} companies...`);
  let done = 0;
  for (const t of affected) {
    try {
      await refreshRatios(db, t);
      done++;
    } catch (e) {
      console.log(`  ${t}: ${(e as Error).message}`);
    }
  }
  console.log(`recomputed ${done}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
