import { loadEnvLocal } from "./load-env";

/**
 * Freshness + correctness audit across the live universe (read-only, no LLM).
 *
 * Answers "which stocks have stale, old, or suspect data" the same way the
 * PPL incident was diagnosed, but for everyone at once:
 *
 *   FRESHNESS   latest fiscal year of income data per ticker. PSX fiscal years
 *               are labelled by the calendar year they END in, so as of
 *               mid-2026 a current company shows fiscal 2026 rows (June
 *               year-ends: 9M FY2026; December year-ends: Q1 FY2026).
 *   DEEP LAG    balance sheet / cash flow trailing the income series by a
 *               fiscal year or more (PPL's exact failure shape), or absent.
 *   CORRECTNESS deterministic identity checks on stored rows:
 *                 - assets ≈ liabilities + equity          (>2% off = flag)
 *                 - revenue − cost of sales ≈ gross profit (>2% off = flag)
 *                 - PBT − tax ≈ PAT                        (>2% off = flag)
 *                 - cumulative monotonicity within a year  (Q1 ≤ H1 ≤ 9M eps/OCF)
 *                 - quarterly sum vs cumulative eps        (>3% off = flag)
 *
 *   npx tsx scripts/data-freshness-audit.ts [--full]   (--full lists every ticker)
 */

interface FinRow {
  ticker: string;
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  data: Record<string, unknown>;
}

const num = (d: Record<string, unknown>, k: string): number | null => {
  const v = d[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const off = (actual: number, expected: number): number =>
  expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected);

async function main() {
  loadEnvLocal();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const db = createAdminClient();
  const full = process.argv.includes("--full");

  const companies = new Set(await activeUniverseTickers(db, "companies"));
  const { data: holdingRows } = await db.from("holdings").select("ticker").gt("quantity", 0);
  const holdings = new Set((holdingRows ?? []).map((r) => (r.ticker as string).toUpperCase()));

  const rows: FinRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("ticker, period_type, fiscal_year, fiscal_period, statement_type, data")
      .range(from, from + 999);
    if (!data?.length) break;
    rows.push(...(data as FinRow[]));
    if (data.length < 1000) break;
  }

  const byTicker = new Map<string, FinRow[]>();
  for (const r of rows) {
    if (!companies.has(r.ticker)) continue;
    (byTicker.get(r.ticker) ?? byTicker.set(r.ticker, []).get(r.ticker)!).push(r);
  }

  const CURRENT_FY = 2026;
  const tag = (t: string) => (holdings.has(t) ? `${t}*` : t);

  const noData: string[] = [];
  const staleIncome: { t: string; fy: number }[] = [];
  const deepMissing: string[] = [];
  const deepLagging: { t: string; income: number; deep: number }[] = [];
  const identityFlags: { t: string; issue: string }[] = [];
  const fresh: string[] = [];

  for (const t of [...companies].sort()) {
    const trs = byTicker.get(t);
    if (!trs?.length) {
      noData.push(tag(t));
      continue;
    }
    const maxFy = (type?: string) =>
      Math.max(0, ...trs.filter((r) => !type || r.statement_type === type).map((r) => r.fiscal_year ?? 0));
    const incomeFy = maxFy("income_statement");
    const bsFy = maxFy("balance_sheet");
    const cfFy = maxFy("cash_flow");

    if (incomeFy < CURRENT_FY - 1) staleIncome.push({ t: tag(t), fy: incomeFy });
    else if (incomeFy >= CURRENT_FY) fresh.push(t);

    if (bsFy === 0 || cfFy === 0) deepMissing.push(tag(t));
    else if (Math.min(bsFy, cfFy) < incomeFy) deepLagging.push({ t: tag(t), income: incomeFy, deep: Math.min(bsFy, cfFy) });

    // --- identity checks on every stored row ---
    for (const r of trs) {
      const d = r.data ?? {};
      const label = `${r.fiscal_year} ${r.fiscal_period}`;
      if (r.statement_type === "balance_sheet") {
        const a = num(d, "total_assets"), l = num(d, "total_liabilities"), e = num(d, "equity");
        if (a !== null && l !== null && e !== null && off(a, l + e) > 0.02)
          identityFlags.push({ t: tag(t), issue: `${label} BS: assets ${a} vs liab+equity ${l + e}` });
      }
      if (r.statement_type === "income_statement") {
        const rev = num(d, "revenue"), cogs = num(d, "cost_of_sales"), gp = num(d, "gross_profit");
        if (rev !== null && cogs !== null && gp !== null && off(gp, rev - Math.abs(cogs)) > 0.02)
          identityFlags.push({ t: tag(t), issue: `${label} IS: gross ${gp} vs rev−cogs ${rev - Math.abs(cogs)}` });
        // Tax may be an expense or a credit (loss-makers), and extractors may
        // store either sign — accept the identity if ANY sign convention
        // reconciles, flag only when none does.
        const pbt = num(d, "profit_before_tax"), tax = num(d, "tax"), pat = num(d, "profit_after_tax");
        if (pbt !== null && tax !== null && pat !== null) {
          const candidates = [pbt - Math.abs(tax), pbt + Math.abs(tax)];
          if (candidates.every((c) => off(pat, c) > 0.02))
            identityFlags.push({ t: tag(t), issue: `${label} IS: PAT ${pat} irreconcilable with PBT ${pbt}, tax ${tax}` });
        }
      }
    }

    // --- cumulative monotonicity + quarterly-sum checks per fiscal year ---
    const years = [...new Set(trs.map((r) => r.fiscal_year).filter((y): y is number => y !== null))];
    for (const y of years) {
      const slot = (p: string, type: string) =>
        trs.find((r) => r.fiscal_year === y && (r.fiscal_period ?? "").toUpperCase() === p && r.statement_type === type);
      const eps = (p: string) => { const r = slot(p, "income_statement"); return r ? num(r.data ?? {}, "eps") : null; };
      const ocf = (p: string) => { const r = slot(p, "cash_flow"); return r ? num(r.data ?? {}, "operating_cash_flow") : null; };

      for (const metric of [{ name: "eps", get: eps }, { name: "OCF", get: ocf }]) {
        const seq = [metric.get("Q1"), metric.get("H1"), metric.get("9M")].filter((v): v is number => v !== null);
        for (let i = 1; i < seq.length; i++) {
          if (seq.every((v) => v > 0) && seq[i] < seq[i - 1] * 0.98)
            identityFlags.push({ t: tag(t), issue: `${y} ${metric.name} cumulative not monotonic (${seq.join(" → ")})` });
        }
      }
      const q1 = eps("Q1"), q2 = eps("Q2"), q3 = eps("Q3"), h1 = eps("H1"), nm = eps("9M");
      if (q1 !== null && q2 !== null && h1 !== null && off(h1, q1 + q2) > 0.03)
        identityFlags.push({ t: tag(t), issue: `${y} eps Q1+Q2=${(q1 + q2).toFixed(2)} vs H1=${h1}` });
      if (q1 !== null && q2 !== null && q3 !== null && nm !== null && off(nm, q1 + q2 + q3) > 0.03)
        identityFlags.push({ t: tag(t), issue: `${y} eps Q1+Q2+Q3=${(q1 + q2 + q3).toFixed(2)} vs 9M=${nm}` });
    }
  }

  const show = (list: string[], cap = 40) => (full ? list : list.slice(0, cap)).join(", ") + (!full && list.length > cap ? ` … +${list.length - cap} more` : "");

  console.log(`Live universe: ${companies.size}   (* = your holding)\n`);
  console.log(`FRESH (fiscal ${CURRENT_FY} income on file): ${fresh.length}`);
  console.log(`\nNO FINANCIALS AT ALL: ${noData.length}`);
  if (noData.length) console.log(`  ${show(noData)}`);
  console.log(`\nSTALE INCOME (nothing newer than fiscal ${CURRENT_FY - 2}): ${staleIncome.length}`);
  if (staleIncome.length) console.log(`  ${show(staleIncome.map((x) => `${x.t}(${x.fy || "?"})`))}`);
  console.log(`\nDEEP DATA MISSING (no balance sheet or no cash flow ever): ${deepMissing.length}`);
  if (deepMissing.length) console.log(`  ${show(deepMissing)}`);
  console.log(`\nDEEP DATA LAGGING (BS/CF at least a fiscal year behind income — the PPL shape): ${deepLagging.length}`);
  if (deepLagging.length) console.log(`  ${show(deepLagging.map((x) => `${x.t}(income fy${x.income}, deep fy${x.deep})`))}`);
  console.log(`\nIDENTITY-CHECK FLAGS (arithmetic inconsistencies in stored rows): ${identityFlags.length}`);
  for (const f of full ? identityFlags : identityFlags.slice(0, 40)) console.log(`  ${f.t}: ${f.issue}`);
  if (!full && identityFlags.length > 40) console.log(`  … +${identityFlags.length - 40} more (run with --full)`);

  const holdingsIssues = new Set(
    [...noData, ...staleIncome.map((x) => x.t), ...deepMissing, ...deepLagging.map((x) => x.t), ...identityFlags.map((f) => f.t)]
      .filter((x) => x.endsWith("*"))
  );
  console.log(`\nYOUR HOLDINGS with at least one issue: ${holdingsIssues.size}`);
  if (holdingsIssues.size) console.log(`  ${[...holdingsIssues].sort().join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
