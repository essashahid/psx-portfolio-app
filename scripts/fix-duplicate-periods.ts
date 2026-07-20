/**
 * Resolve interim rows duplicated across two fiscal years.
 *
 * Same root cause as the Q1/Q2 off-by-one already fixed: a period ending in
 * the calendar year BEFORE the fiscal year ends gets labelled a year early.
 * That fix could only touch rows the PSX portal corroborated, and the portal
 * publishes quarterly and annual figures but never H1 — so every mislabelled
 * half-year survived it. Seven of the fifteen duplicates are H1.
 *
 * Resolving one needs the company's fiscal year end, which is not stored. It
 * is recoverable from when annual reports are filed: an annual report appears
 * a few months AFTER the year closes, so
 *
 *   June year end     FY2025 annual filed Sep-Dec 2025   filed year == fiscal year
 *   December year end FY2025 annual filed Mar-Apr 2026   filed year == fiscal year + 1
 *
 * With the year end known, the correct fiscal year for any period is the
 * calendar year of the first year end falling on or after that period's end.
 *
 * Only acts where the evidence is unambiguous: the two rows must be genuinely
 * identical, the year end must be confidently inferred, and exactly one of the
 * two labels must be correct under the rule. Anything else is reported.
 *
 * KNOWN LIMITATION — do not use --apply until this is resolved.
 * The year-end inference reads reported_date off annual rows, but comparative
 * columns inherit the CURRENT filing's date, so a single filing writes both
 * FY2026 and FY2025 with the same date. That makes the "filed the year after"
 * test fire spuriously. ATLH is the counter-example: it closes in March, both
 * its FY2026 and FY2025 rows carry 2026-06-08, and the inference concluded
 * December — which would have quarantined a correct row. Deduplicating by
 * reported_date is not enough either, since a March close filed in June is
 * indistinguishable from a June close filed in June on this evidence alone.
 *
 * The authoritative source is the balance sheet's "Audited <date>" comparative
 * column inside the filing, which we do not currently store. Capturing that
 * during extraction is the real fix; until then this script reports only.
 *
 *   npx tsx scripts/fix-duplicate-periods.ts          # report (safe)
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const APPLY = process.argv.includes("--apply");

type Row = {
  id: string;
  ticker: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  source_type: string | null;
  reported_date: string | null;
  data: Record<string, number | null> | null;
};

/** Month (1-12) in which the fiscal year ends, or null if not confident. */
function inferYearEndMonth(annuals: Row[]): number | null {
  const votes: number[] = [];
  for (const a of annuals) {
    if (!a.reported_date || a.fiscal_year === null) continue;
    const d = new Date(a.reported_date);
    if (Number.isNaN(d.getTime())) continue;
    const filedYear = d.getUTCFullYear();
    const filedMonth = d.getUTCMonth() + 1;
    // Filed in the same calendar year as the fiscal label => year end already
    // passed this calendar year, so it ends mid-year (June for PSX).
    if (filedYear === a.fiscal_year && filedMonth >= 7) votes.push(6);
    // Filed the following calendar year => a December close.
    else if (filedYear === a.fiscal_year + 1 && filedMonth <= 6) votes.push(12);
  }
  if (!votes.length) return null;
  const six = votes.filter((v) => v === 6).length;
  const twelve = votes.length - six;
  if (six && twelve) return null; // contradictory evidence, stay out
  return six ? 6 : 12;
}

/** Calendar month in which a period ends, given the fiscal year end month. */
function periodEndMonth(period: string, yearEndMonth: number): number {
  const monthsIn = { Q1: 3, H1: 6, Q2: 6, "9M": 9, Q3: 9 }[period] ?? 12;
  return (((yearEndMonth - 12 + monthsIn) % 12) + 12) % 12 || 12;
}

/** The fiscal year a period belongs to, given the calendar year it ends in. */
function fiscalYearFor(endMonth: number, endCalYear: number, yearEndMonth: number): number {
  return endMonth <= yearEndMonth ? endCalYear : endCalYear + 1;
}

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const rows: Row[] = [];
  for (let o = 0; ; o += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("id,ticker,fiscal_year,fiscal_period,statement_type,source_type,reported_date,data")
      .eq("statement_type", "income_statement")
      .eq("review_status", "published")
      .range(o, o + 999);
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const byTicker = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    byTicker.get(r.ticker)!.push(r);
  }

  const relabel: { row: Row; to: number; why: string }[] = [];
  const quarantine: { row: Row; why: string }[] = [];
  const skipped: string[] = [];

  for (const [ticker, all] of byTicker) {
    const yearEnd = inferYearEndMonth(all.filter((r) => r.fiscal_period === "FY"));

    // Duplicate = same interim label, adjacent fiscal years, identical figures.
    const interims = all.filter((r) => ["Q1", "Q2", "Q3", "H1", "9M"].includes((r.fiscal_period ?? "").toUpperCase()));
    const sig = (r: Row) => {
      const e = r.data?.eps;
      const rev = r.data?.revenue;
      return typeof e === "number" && typeof rev === "number" ? `${e}|${rev}` : null;
    };

    for (const a of interims) {
      for (const b of interims) {
        if (a.id >= b.id) continue;
        if ((a.fiscal_period ?? "") !== (b.fiscal_period ?? "")) continue;
        const s = sig(a);
        if (!s || s !== sig(b)) continue;
        if (Math.abs((a.fiscal_year ?? 0) - (b.fiscal_year ?? 0)) !== 1) continue;

        const period = (a.fiscal_period ?? "").toUpperCase();
        if (yearEnd === null) {
          skipped.push(`${ticker} ${period}: duplicate across ${a.fiscal_year}/${b.fiscal_year} but fiscal year end could not be inferred`);
          continue;
        }
        // Prefer the row that carries a reported_date: it is the one read from
        // a filing whose date we can reason about.
        const dated = [a, b].filter((r) => r.reported_date);
        if (dated.length !== 1) {
          // Both dated (or neither): decide from the period-end rule alone.
          const endM = periodEndMonth(period, yearEnd);
          const src = dated[0] ?? a;
          const d = src.reported_date ? new Date(src.reported_date) : null;
          if (!d || Number.isNaN(d.getTime())) {
            skipped.push(`${ticker} ${period}: duplicate across ${a.fiscal_year}/${b.fiscal_year}, no usable reported_date`);
            continue;
          }
          // The period ends shortly before it is filed.
          const endCalYear = d.getUTCMonth() + 1 >= endM ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
          const correct = fiscalYearFor(endM, endCalYear, yearEnd);
          const keep = [a, b].find((r) => r.fiscal_year === correct);
          const drop = [a, b].find((r) => r.fiscal_year !== correct);
          if (keep && drop)
            quarantine.push({
              row: drop,
              why: `${ticker} ${drop.fiscal_year} ${period} duplicates ${keep.fiscal_year} ${period}; with a month-${yearEnd} year end the period ending ${endM}/${endCalYear} belongs to FY${correct}`,
            });
          else skipped.push(`${ticker} ${period}: neither ${a.fiscal_year} nor ${b.fiscal_year} matches computed FY${correct}`);
          continue;
        }

        const src = dated[0];
        const d = new Date(src.reported_date!);
        const endM = periodEndMonth(period, yearEnd);
        const endCalYear = d.getUTCMonth() + 1 >= endM ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
        const correct = fiscalYearFor(endM, endCalYear, yearEnd);
        const keep = [a, b].find((r) => r.fiscal_year === correct);
        const drop = [a, b].find((r) => r.fiscal_year !== correct);
        if (!keep || !drop) {
          skipped.push(`${ticker} ${period}: computed FY${correct} matches neither ${a.fiscal_year} nor ${b.fiscal_year}`);
          continue;
        }
        quarantine.push({
          row: drop,
          why: `${ticker} ${drop.fiscal_year} ${period} duplicates ${keep.fiscal_year} ${period}; filed ${src.reported_date}, month-${yearEnd} year end puts it in FY${correct}`,
        });
      }
    }
  }

  const uniq = new Map(quarantine.map((q) => [q.row.id, q]));
  console.log(APPLY ? "APPLYING\n" : "DRY RUN (pass --apply to write)\n");
  console.log(`${uniq.size} duplicate rows resolvable`);
  console.log(`${relabel.length} relabels`);
  console.log(`${skipped.length} left alone (insufficient evidence)\n`);
  for (const q of uniq.values()) console.log(`  ${q.why}`);
  if (skipped.length) {
    console.log(`\nskipped:`);
    for (const s of skipped.slice(0, 12)) console.log(`  ${s}`);
  }

  if (!APPLY) return;

  let n = 0;
  for (const q of uniq.values()) {
    const { error } = await db
      .from("company_financials")
      .update({ review_status: "needs_review", validation_flags: ["duplicate_wrong_fiscal_year"] })
      .eq("id", q.row.id);
    if (!error) n++;
  }
  const affected = [...new Set([...uniq.values()].map((q) => q.row.ticker))];
  const { refreshRatios } = await import("@/lib/engine/ratios");
  for (const t of affected) await refreshRatios(db, t);
  console.log(`\nquarantined ${n}, recomputed ${affected.length} companies`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
