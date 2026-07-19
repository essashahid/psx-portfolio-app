/**
 * TTM integrity audit (free, no LLM): finds the defect families that the
 * Cement and Fertilizer hand-reads kept turning up, across the whole live
 * universe, ranked by market cap.
 *
 * Trailing-12m EPS is `annual + current interim - prior-year same interim`.
 * Every defect below corrupts that chain, and none of them are caught by the
 * existing sweeps (which check accounting identities, freshness, and
 * annual-to-annual split breaks).
 *
 *   A NO_COMPARATIVE  current-year interim exists but the prior-year interim
 *                     of the same label is missing, so TTM cannot be formed
 *                     (GWLC, DNCC, DCL, SMCPL, FECTC, AHCL all failed here)
 *   B DUPLICATE       two different fiscal years carry byte-identical eps AND
 *                     revenue, i.e. a period copied forward (POWER, DCL, AGL)
 *   C SHARE_BREAK     implied shares (PAT x 1000 / eps) from the annual and
 *                     from the latest interim disagree by >12%, meaning a
 *                     split or bonus was never restated (THCCL: 5:1)
 *   D NO_REPORTED_DATE  a balance sheet or cash flow that is newer than the
 *                     row currently winning latest(), but undated, so it
 *                     loses the sort and is ignored (EFERT's Q1 balance sheet).
 *                     Income is exempt: the engine selects it from annual rows.
 *   E PAT_GT_REVENUE  |PAT| exceeds |revenue|, usually a unit mismatch.
 *                     Legitimate for holding companies, so reported separately.
 *   F NO_TTM_BASIS    P/E is computed off a partial period instead of a TTM,
 *                     which understates it (AHCL: P/E off a 9-month EPS)
 *
 *   npx tsx scripts/ttm-integrity-audit.ts             # summary + top offenders
 *   npx tsx scripts/ttm-integrity-audit.ts --all       # every affected ticker
 *   npx tsx scripts/ttm-integrity-audit.ts --ticker X  # explain one company
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

type Fin = {
  ticker: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  period_type: string | null;
  statement_type: string;
  reported_date: string | null;
  data: Record<string, number | null> | null;
};

const INTERIM = new Set(["Q1", "H1", "9M"]);
const num = (d: Fin["data"], k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

type Finding = { code: string; ticker: string; detail: string };

const ARG_ALL = process.argv.includes("--all");
const ONE = (() => {
  const i = process.argv.indexOf("--ticker");
  return i >= 0 ? process.argv[i + 1]?.toUpperCase() : null;
})();

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { verifiedTickers } = await import("@/lib/engine/verified");
  const db = createAdminClient();

  const live = new Set(await activeUniverseTickers(db, "companies"));
  const verified = new Set(verifiedTickers());

  const page = async <T>(table: string, cols: string): Promise<T[]> => {
    const out: T[] = [];
    for (let o = 0; ; o += 1000) {
      const { data } = await db.from(table).select(cols).range(o, o + 999);
      if (!data?.length) break;
      out.push(...(data as T[]));
      if (data.length < 1000) break;
    }
    return out;
  };

  const fins = (
    await page<Fin>("company_financials", "ticker,fiscal_year,fiscal_period,period_type,statement_type,reported_date,data")
  ).filter((r) => live.has(r.ticker));
  const quotes = await page<{ ticker: string; market_cap: number | null }>("market_quotes", "ticker,market_cap");
  const masters = await page<{ ticker: string; sector: string | null }>("stock_master", "ticker,sector");
  const ratios = await page<{ ticker: string; ratio_name: string; source_period: string | null }>(
    "company_ratios",
    "ticker,ratio_name,source_period"
  );

  const cap = new Map(quotes.map((q) => [q.ticker, Number(q.market_cap) || 0]));
  const sector = new Map(masters.map((m) => [m.ticker, m.sector ?? "?"]));
  const peBasis = new Map(ratios.filter((r) => r.ratio_name === "P/E").map((r) => [r.ticker, r.source_period ?? ""]));

  const byTicker = new Map<string, Fin[]>();
  for (const r of fins) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    byTicker.get(r.ticker)!.push(r);
  }

  const findings: Finding[] = [];

  for (const [ticker, rows] of byTicker) {
    const inc = rows.filter((r) => r.statement_type === "income_statement");
    const annuals = inc.filter((r) => r.fiscal_period === "FY").sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0));

    // Mirror the engine's cumulativeField exactly, including the fallback that
    // sums quarterly rows when the cumulative row itself is absent. Without
    // this fallback the audit reports false gaps on companies that are fine
    // (OGDC, PPL and MARI all build their prior-year leg from quarters).
    const cumLabel = (n: number) => (n === 1 ? "Q1" : n === 2 ? "H1" : "9M");
    const qField = (year: number, q: number, field: string): number | null => {
      const row = inc.find((r) => r.fiscal_year === year && (r.fiscal_period ?? "").toUpperCase() === `Q${q}`);
      return num(row?.data ?? null, field);
    };
    const cumulative = (year: number, n: number, field: string): number | null => {
      const direct = inc.find((r) => r.fiscal_year === year && (r.fiscal_period ?? "").toUpperCase() === cumLabel(n));
      const dv = num(direct?.data ?? null, field);
      if (dv !== null) return dv;
      const qs = Array.from({ length: n }, (_, i) => qField(year, i + 1, field));
      if (qs.every((v) => v !== null)) return (qs as number[]).reduce((a, b) => a + b, 0);
      if (n === 3) {
        const h1 = cumulative(year, 2, field);
        const q3 = qField(year, 3, field);
        if (h1 !== null && q3 !== null) return h1 + q3;
      }
      return null;
    };

    const annualYear = annuals[0]?.fiscal_year ?? null;
    let ttmNeeded = false;
    let ttmBroken: string | null = null;
    if (annualYear !== null) {
      const y = annualYear + 1;
      for (const n of [3, 2, 1]) {
        if (cumulative(y, n, "eps") === null) continue;
        ttmNeeded = true;
        if (cumulative(annualYear, n, "eps") === null) {
          ttmBroken = `${y} ${cumLabel(n)} exists but ${annualYear} ${cumLabel(n)} cannot be formed, so TTM falls back to the ${annualYear} annual alone`;
        }
        break;
      }
    }

    // A: the prior-year leg of the TTM chain cannot be built at all
    if (ttmBroken) findings.push({ code: "A_NO_COMPARATIVE", ticker, detail: ttmBroken });

    // B: identical eps+revenue across different fiscal years
    const seen = new Map<string, string>();
    for (const r of inc) {
      const e = num(r.data, "eps");
      const rev = num(r.data, "revenue");
      if (e === null || rev === null || rev === 0) continue;
      const key = `${e}|${rev}`;
      const label = `${r.fiscal_year} ${r.fiscal_period}`;
      const prior = seen.get(key);
      if (prior && prior.split(" ")[0] !== label.split(" ")[0]) {
        findings.push({ code: "B_DUPLICATE", ticker, detail: `${prior} and ${label} are identical (eps ${e}, revenue ${rev.toLocaleString()})` });
        break;
      }
      seen.set(key, label);
    }

    // C: annual vs latest interim implied share count
    const impliedShares = (r: Fin | undefined): number | null => {
      const pat = num(r?.data ?? null, "profit_after_tax");
      const e = num(r?.data ?? null, "eps");
      return pat !== null && e !== null && e !== 0 ? Math.abs((pat * 1000) / e) : null;
    };
    const latestInterim = inc
      .filter((r) => INTERIM.has(r.fiscal_period ?? "") && r.fiscal_year === (annualYear ?? 0) + 1)
      .sort((a, b) => (b.fiscal_period ?? "").localeCompare(a.fiscal_period ?? ""))[0];
    const aShares = impliedShares(annuals[0]);
    const iShares = impliedShares(latestInterim);
    if (aShares && iShares && Math.min(aShares, iShares) > 0) {
      const ratio = Math.max(aShares, iShares) / Math.min(aShares, iShares);
      if (ratio > 1.12) {
        findings.push({
          code: "C_SHARE_BREAK",
          ticker,
          detail: `annual ${annuals[0].fiscal_year} implies ${(aShares / 1e6).toFixed(1)}M shares, ${latestInterim.fiscal_year} ${latestInterim.fiscal_period} implies ${(iShares / 1e6).toFixed(1)}M (${ratio.toFixed(2)}x)`,
        });
      }
    }

    // D: a null-dated row that is NEWER than the dated row currently winning
    // latest(). Portal rows are systematically undated, so a bare null count
    // is noise; only mis-ordering is a defect.
    // Only balance_sheet and cash_flow: the engine picks income from annual
    // rows explicitly, so an undated income row cannot displace anything, but
    // balance and cash go straight through latest().
    for (const type of ["balance_sheet", "cash_flow"]) {
      const of = rows.filter((r) => r.statement_type === type);
      const dated = of.filter((r) => r.reported_date);
      const undated = of.filter((r) => !r.reported_date);
      if (!dated.length || !undated.length) continue;
      const winner = dated.sort((a, b) => (b.reported_date ?? "").localeCompare(a.reported_date ?? ""))[0];
      const newer = undated.filter((r) => (r.fiscal_year ?? 0) > (winner.fiscal_year ?? 0));
      if (newer.length) {
        const n = newer.sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0))[0];
        findings.push({
          code: "D_NO_REPORTED_DATE",
          ticker,
          detail: `${type}: ${n.fiscal_year} ${n.fiscal_period} is undated so it loses latest() to the older ${winner.fiscal_year} ${winner.fiscal_period}`,
        });
        break;
      }
    }

    // E: profit exceeding revenue. Legitimate where income is dividends or
    // investment gains, so holding and investment sectors are excluded.
    const sec = sector.get(ticker) ?? "";
    const holdingLike = /Inv\.|Modaraba|Insurance|Close-end|Mutual/i.test(sec);
    if (!holdingLike) {
      for (const r of inc) {
        const pat = num(r.data, "profit_after_tax");
        const rev = num(r.data, "revenue");
        if (pat !== null && rev !== null && rev !== 0 && Math.abs(pat) > Math.abs(rev) * 1.5) {
          findings.push({ code: "E_PAT_GT_REVENUE", ticker, detail: `${r.fiscal_year} ${r.fiscal_period}: PAT ${pat.toLocaleString()} vs revenue ${rev.toLocaleString()}` });
          break;
        }
      }
    }

    // F: P/E on a partial or stale period even though a TTM chain is available
    const basis = peBasis.get(ticker);
    if (basis && ttmNeeded && !basis.startsWith("TTM")) {
      findings.push({ code: "F_NO_TTM_BASIS", ticker, detail: `P/E computed on "${basis}" instead of a trailing twelve months` });
    }
  }

  if (ONE) {
    const mine = findings.filter((f) => f.ticker === ONE);
    console.log(`${ONE} (${sector.get(ONE) ?? "?"}) — ${mine.length} finding(s)${verified.has(ONE) ? " [verified]" : ""}\n`);
    for (const f of mine) console.log(`  ${f.code}\n    ${f.detail}`);
    if (!mine.length) console.log("  clean on all six checks");
    return;
  }

  const codes = ["A_NO_COMPARATIVE", "B_DUPLICATE", "C_SHARE_BREAK", "D_NO_REPORTED_DATE", "E_PAT_GT_REVENUE", "F_NO_TTM_BASIS"];
  const capOf = (t: string) => cap.get(t) ?? 0;
  const B = (x: number) => (x / 1e9).toFixed(0) + "B";

  console.log(`TTM INTEGRITY AUDIT — ${byTicker.size} live companies with financials\n`);
  console.log("code                 tickers   affected market cap   verified-but-affected");
  for (const c of codes) {
    const hit = [...new Set(findings.filter((f) => f.code === c).map((f) => f.ticker))];
    const v = hit.filter((t) => verified.has(t));
    console.log(
      `${c.padEnd(20)} ${String(hit.length).padStart(7)}   ${B(hit.reduce((s, t) => s + capOf(t), 0)).padStart(17)}   ${v.length ? v.join(", ") : "-"}`
    );
  }

  const affected = [...new Set(findings.map((f) => f.ticker))];
  console.log(
    `\ntotal affected: ${affected.length} companies, ${B(affected.reduce((s, t) => s + capOf(t), 0))} market cap`
  );

  const clean = [...byTicker.keys()].filter((t) => !affected.includes(t));
  console.log(`clean on all six checks: ${clean.length} companies, ${B(clean.reduce((s, t) => s + capOf(t), 0))}`);

  const ranked = affected.sort((a, b) => capOf(b) - capOf(a));
  const show = ARG_ALL ? ranked : ranked.slice(0, 25);
  console.log(`\n${ARG_ALL ? "All" : "Top 25"} affected by market cap:\n`);
  for (const t of show) {
    const mine = findings.filter((f) => f.ticker === t);
    console.log(
      `${t.padEnd(7)} ${B(capOf(t)).padStart(7)}  ${(sector.get(t) ?? "?").slice(0, 28).padEnd(28)} ${verified.has(t) ? "[v] " : "    "}${mine.map((f) => f.code[0]).join("")}`
    );
    for (const f of mine) console.log(`          ${f.code.slice(2).padEnd(17)} ${f.detail}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
