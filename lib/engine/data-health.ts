import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeUniverseTickers } from "@/lib/engine/universe";

/**
 * Data-health checks, shared by the cron route and the CLI audits.
 *
 * These encode the defect families that repeated hand-reads across Cement,
 * Banks and Fertilizer kept turning up. Each one corrupts the trailing-12m
 * chain (TTM = annual + current interim - prior-year same interim) in a way
 * the write-time accounting-identity checks cannot see, because every row is
 * individually well-formed — it is the RELATIONSHIP between rows that is wrong.
 *
 * Run on a schedule so a bad quarter surfaces in a day rather than being
 * discovered by hand a quarter later.
 */

export type HealthFinding = {
  code:
    | "NO_COMPARATIVE"
    | "DUPLICATE_PERIOD"
    | "SHARE_BREAK"
    | "UNDATED_STATEMENT"
    | "STALE_BASIS"
    | "SARMAAYA_DIVERGENCE"
    | "PRICE_MISMATCH";
  ticker: string;
  detail: string;
  marketCap: number;
};

type Fin = {
  ticker: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  reported_date: string | null;
  data: Record<string, number | null> | null;
};

const num = (d: Fin["data"], k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

async function pageAll<T>(db: SupabaseClient, table: string, cols: string, filter?: (q: never) => never): Promise<T[]> {
  const out: T[] = [];
  for (let o = 0; ; o += 1000) {
    let q = db.from(table).select(cols).range(o, o + 999);
    if (filter) q = filter(q as never);
    const { data } = await q;
    if (!data?.length) break;
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** Sarmaaya reference store, read from disk. Absent in some deploys — optional. */
type SarmaayaSnap = { eps?: number; basis?: string; priceClose?: number; shares?: number };

function sarmaayaStore(): Record<string, SarmaayaSnap> {
  try {
    const raw = readFileSync(join(process.cwd(), "data/sarmaaya-snapshots.json"), "utf8");
    return (JSON.parse(raw) as { snapshots: Record<string, SarmaayaSnap> }).snapshots ?? {};
  } catch {
    return {};
  }
}

export async function runDataHealth(db: SupabaseClient): Promise<{
  checked: number;
  findings: HealthFinding[];
  summary: Record<string, { companies: number; marketCap: number }>;
  cleanCompanies: number;
  cleanMarketCap: number;
  totalMarketCap: number;
  cleanMarketCapPct: number;
}> {
  const live = new Set(await activeUniverseTickers(db, "companies"));
  const fins = (await pageAll<Fin>(db, "company_financials", "ticker,fiscal_year,fiscal_period,statement_type,reported_date,data")).filter(
    (r) => live.has(r.ticker)
  );
  const quotes = await pageAll<{ ticker: string; market_cap: number | null; price: number | null; provider: string | null }>(
    db,
    "market_quotes",
    "ticker,market_cap,price,provider"
  );
  const ratios = await pageAll<{ ticker: string; ratio_name: string; ratio_value: number | null; inputs: { eps?: number } | null; source_period: string | null }>(
    db,
    "company_ratios",
    "ticker,ratio_name,ratio_value,inputs,source_period"
  );

  const cap = new Map(quotes.map((q) => [q.ticker, Number(q.market_cap) || 0]));
  const peRow = new Map(ratios.filter((r) => r.ratio_name === "P/E").map((r) => [r.ticker, r]));
  const rrEps = new Map(ratios.filter((r) => r.ratio_name === "EPS (annualized)").map((r) => [r.ticker, Number(r.ratio_value)]));
  const store = sarmaayaStore();

  const byTicker = new Map<string, Fin[]>();
  for (const r of fins) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    byTicker.get(r.ticker)!.push(r);
  }

  const findings: HealthFinding[] = [];
  const add = (code: HealthFinding["code"], ticker: string, detail: string) =>
    findings.push({ code, ticker, detail, marketCap: cap.get(ticker) ?? 0 });

  for (const [ticker, rows] of byTicker) {
    const inc = rows.filter((r) => r.statement_type === "income_statement");
    const annuals = inc.filter((r) => r.fiscal_period === "FY").sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0));

    // Mirror the engine's cumulativeField, including the quarter-sum fallback —
    // without it, companies that legitimately build the prior-year leg from
    // quarters (OGDC, PPL, MARI) are reported as false gaps.
    const cumLabel = (n: number) => (n === 1 ? "Q1" : n === 2 ? "H1" : "9M");
    const qField = (year: number, q: number) =>
      num(inc.find((r) => r.fiscal_year === year && (r.fiscal_period ?? "").toUpperCase() === `Q${q}`)?.data ?? null, "eps");
    const cumulative = (year: number, n: number): number | null => {
      const direct = num(inc.find((r) => r.fiscal_year === year && (r.fiscal_period ?? "").toUpperCase() === cumLabel(n))?.data ?? null, "eps");
      if (direct !== null) return direct;
      const qs = Array.from({ length: n }, (_, i) => qField(year, i + 1));
      if (qs.every((v) => v !== null)) return (qs as number[]).reduce((a, b) => a + b, 0);
      if (n === 3) {
        const h1 = cumulative(year, 2);
        const q3 = qField(year, 3);
        if (h1 !== null && q3 !== null) return h1 + q3;
      }
      return null;
    };

    const annualYear = annuals[0]?.fiscal_year ?? null;
    if (annualYear !== null) {
      for (const n of [3, 2, 1]) {
        if (cumulative(annualYear + 1, n) === null) continue;
        if (cumulative(annualYear, n) === null)
          add("NO_COMPARATIVE", ticker, `${annualYear + 1} ${cumLabel(n)} has no ${annualYear} ${cumLabel(n)} to subtract; TTM falls back to the annual`);
        break;
      }
    }

    // Same figures under two fiscal years: a period copied forward.
    const seen = new Map<string, string>();
    for (const r of inc) {
      const e = num(r.data, "eps");
      const rev = num(r.data, "revenue");
      if (e === null || rev === null || rev === 0) continue;
      const k = `${e}|${rev}`;
      const label = `${r.fiscal_year} ${r.fiscal_period}`;
      const prior = seen.get(k);
      if (prior && prior.split(" ")[0] !== label.split(" ")[0]) {
        add("DUPLICATE_PERIOD", ticker, `${prior} and ${label} carry identical figures (eps ${e})`);
        break;
      }
      seen.set(k, label);
    }

    // Annual vs latest interim implied share count: an unrestated split/bonus.
    const implied = (r?: Fin) => {
      const pat = num(r?.data ?? null, "profit_after_tax");
      const e = num(r?.data ?? null, "eps");
      return pat !== null && e !== null && e !== 0 ? Math.abs((pat * 1000) / e) : null;
    };
    const latestInterim = inc
      .filter((r) => ["Q1", "H1", "9M"].includes(r.fiscal_period ?? "") && r.fiscal_year === (annualYear ?? 0) + 1)
      .sort((a, b) => (b.fiscal_period ?? "").localeCompare(a.fiscal_period ?? ""))[0];
    const aS = implied(annuals[0]);
    const iS = implied(latestInterim);
    if (aS && iS && Math.min(aS, iS) > 0) {
      const ratio = Math.max(aS, iS) / Math.min(aS, iS);
      if (ratio > 1.12)
        add("SHARE_BREAK", ticker, `annual implies ${(aS / 1e6).toFixed(1)}M shares, ${latestInterim.fiscal_period} implies ${(iS / 1e6).toFixed(1)}M (${ratio.toFixed(2)}x)`);
    }

    // An undated balance sheet or cash flow newer than the dated row that
    // currently wins latest(), which sorts on reported_date before fiscal_year.
    for (const type of ["balance_sheet", "cash_flow"]) {
      const of = rows.filter((r) => r.statement_type === type);
      const dated = of.filter((r) => r.reported_date);
      const undated = of.filter((r) => !r.reported_date);
      if (!dated.length || !undated.length) continue;
      const winner = dated.sort((a, b) => (b.reported_date ?? "").localeCompare(a.reported_date ?? ""))[0];
      const newer = undated.filter((r) => (r.fiscal_year ?? 0) > (winner.fiscal_year ?? 0));
      if (newer.length) {
        const n = newer.sort((a, b) => (b.fiscal_year ?? 0) - (a.fiscal_year ?? 0))[0];
        add("UNDATED_STATEMENT", ticker, `${type} ${n.fiscal_year} ${n.fiscal_period} is undated and loses to the older ${winner.fiscal_year} ${winner.fiscal_period}`);
        break;
      }
    }

    // Valuation resting on a stale period despite a TTM chain being available.
    const pe = peRow.get(ticker);
    const basis = pe?.source_period ?? "";
    if (pe && basis && !basis.startsWith("TTM") && annualYear !== null && cumulative(annualYear + 1, 3) !== null)
      add("STALE_BASIS", ticker, `P/E computed on "${basis}" though a trailing period is available`);

    // External cross-check. Convention differences are excluded deliberately:
    // Sarmaaya quotes the run-rate for recovering cyclicals and the group for
    // holding companies, and neither means our figure is wrong.
    const snap = store[ticker];
    const ours = pe?.inputs?.eps ?? null;
    if (snap?.eps != null && ours !== null && snap.basis !== "consolidated") {
      const theirs = snap.eps;
      const rr = rrEps.get(ticker) ?? null;
      const near = (a: number | null, b: number, p: number) => a !== null && b !== 0 && Math.abs(a / b - 1) <= p;
      const bothLoss = theirs < 0 && ours < 0;
      if (!bothLoss && !near(ours, theirs, 0.08) && !near(rr, theirs, 0.05))
        add("SARMAAYA_DIVERGENCE", ticker, `trailing ${ours.toFixed(2)} vs Sarmaaya ${theirs} (${(((ours / theirs) - 1) * 100).toFixed(0)}%)`);
    }
  }

  // Price integrity. A wrong price corrupts every price-derived ratio at once
  // (P/E, P/B, P/S, EV/*, both yields) while the financials stay perfectly
  // correct, so none of the checks above can see it. This is how PPL came to
  // serve a P/E of 1.21: the quote was PPL Corp, a US utility, not the PSX
  // company. Checked against two independent references so one stale source
  // cannot condemn a good price.
  const priceOf = new Map(quotes.map((q) => [q.ticker, q]));
  for (const ticker of byTicker.keys()) {
    const q = priceOf.get(ticker);
    const ours = Number(q?.price);
    if (!Number.isFinite(ours) || ours <= 0) continue;
    const snap = store[ticker];
    const theirs = typeof snap?.priceClose === "number" ? snap.priceClose : null;
    const shares = typeof snap?.shares === "number" ? snap.shares : null;
    const implied = shares && q?.market_cap ? Number(q.market_cap) / shares : null;
    const off = (ref: number | null) => ref !== null && ref > 0 && Math.abs(ours / ref - 1) > 0.15;
    if (off(theirs) && (implied === null || off(implied))) {
      add(
        "PRICE_MISMATCH",
        ticker,
        `price ${ours.toFixed(2)} (${q?.provider ?? "?"}) vs Sarmaaya ${theirs?.toFixed(2)}${implied !== null ? ` and cap/shares ${implied.toFixed(2)}` : ""}`
      );
    }
  }

  const summary: Record<string, { companies: number; marketCap: number }> = {};
  for (const code of [
    "NO_COMPARATIVE",
    "DUPLICATE_PERIOD",
    "SHARE_BREAK",
    "UNDATED_STATEMENT",
    "STALE_BASIS",
    "SARMAAYA_DIVERGENCE",
    "PRICE_MISMATCH",
  ]) {
    const t = [...new Set(findings.filter((f) => f.code === code).map((f) => f.ticker))];
    summary[code] = { companies: t.length, marketCap: t.reduce((s, x) => s + (cap.get(x) ?? 0), 0) };
  }
  const affected = new Set(findings.map((f) => f.ticker));
  const clean = [...byTicker.keys()].filter((t) => !affected.has(t));
  const cleanMarketCap = clean.reduce((s, t) => s + (cap.get(t) ?? 0), 0);
  const totalMarketCap = [...byTicker.keys()].reduce((s, t) => s + (cap.get(t) ?? 0), 0);

  return {
    checked: byTicker.size,
    findings,
    summary,
    cleanCompanies: clean.length,
    cleanMarketCap,
    totalMarketCap,
    cleanMarketCapPct: totalMarketCap > 0 ? Number(((cleanMarketCap / totalMarketCap) * 100).toFixed(1)) : 0,
  };
}
