/**
 * Reconcile every computed ratio card against the Sarmaaya snapshot store.
 *
 * With a reference for 265 companies this replaces the one-at-a-time
 * hand-check with a single sweep, and — more importantly — it distinguishes
 * the divergences that are OUR bug from the ones that are a known convention
 * difference. The categories were learned the hard way over Cement, Banks and
 * Fertilizer:
 *
 *   MATCH        trailing EPS agrees within tolerance
 *   RUN_RATE     Sarmaaya is quoting the annualised run-rate, which it does
 *                for recovering cyclicals; our trailing figure is still right
 *   CONSOLIDATED Sarmaaya reports the group, we compute unconsolidated to
 *                match PSX (LUCK, FFC, HUBC, THCCL, FATIMA...)
 *   LOSS         both sides negative; P/E is not meaningful either way
 *   PRICE_ONLY   our EPS agrees but the P/E gap is just a stale quote
 *   DIVERGE      neither basis explains it — a real defect to investigate
 *   NO_REF       no Sarmaaya EPS published
 *
 * Multi-metric agreement is the bar for proposing verification. EPS alone can
 * coincide; EPS plus an independent balance-sheet metric (P/B) plus a payout
 * metric (dividend yield) agreeing simultaneously is strong evidence that the
 * whole card is right, because those three draw on different statements.
 *
 *   npx tsx scripts/sarmaaya-reconcile.ts                # summary
 *   npx tsx scripts/sarmaaya-reconcile.ts --diverge      # list real defects
 *   npx tsx scripts/sarmaaya-reconcile.ts --candidates   # verification candidates
 *   npx tsx scripts/sarmaaya-reconcile.ts --ticker COLG
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync } from "node:fs";

loadEnvLocal();

type Snap = {
  eps?: number; pe?: number; pb?: number; dividendYield?: number;
  netMargin?: number; priceClose?: number; marketCap?: number;
  basis?: string; note?: string; name?: string;
};

const near = (a: number | null, b: number | null, pct: number): boolean =>
  a !== null && b !== null && b !== 0 && Math.abs(a / b - 1) <= pct;

const ARG = (n: string) => process.argv.includes(`--${n}`);
const ONE = (() => { const i = process.argv.indexOf("--ticker"); return i >= 0 ? process.argv[i + 1]?.toUpperCase() : null; })();

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { verifiedTickers } = await import("@/lib/engine/verified");
  const db = createAdminClient();

  const store = JSON.parse(readFileSync("data/sarmaaya-snapshots.json", "utf8")) as { snapshots: Record<string, Snap> };
  const live = new Set(await activeUniverseTickers(db, "companies"));
  const verified = new Set(verifiedTickers());

  const page = async <T,>(t: string, c: string): Promise<T[]> => {
    const o: T[] = [];
    for (let i = 0; ; i += 1000) {
      const { data } = await db.from(t).select(c).range(i, i + 999);
      if (!data?.length) break;
      o.push(...(data as unknown as T[]));
      if (data.length < 1000) break;
    }
    return o;
  };

  type R = { ticker: string; ratio_name: string; ratio_value: number | null; inputs: Record<string, unknown> | null; source_period: string | null };
  const ratios = await page<R>("company_ratios", "ticker,ratio_name,ratio_value,inputs,source_period");
  const quotes = await page<{ ticker: string; market_cap: number | null }>("market_quotes", "ticker,market_cap");
  const cap = new Map(quotes.map((q) => [q.ticker, Number(q.market_cap) || 0]));

  const byTicker = new Map<string, Map<string, R>>();
  for (const r of ratios) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, new Map());
    byTicker.get(r.ticker)!.set(r.ratio_name, r);
  }

  type Row = {
    ticker: string; cat: string; ourEps: number | null; theirEps: number | null; d: number | null;
    pbOk: boolean | null; dyOk: boolean | null; nmOk: boolean | null; cap: number; basis: string | null; detail: string;
  };
  const rows: Row[] = [];

  for (const ticker of ONE ? [ONE] : [...live].sort()) {
    const snap = store.snapshots[ticker];
    const rs = byTicker.get(ticker);
    if (!snap || snap.eps === undefined) {
      if (ONE) console.log(`${ticker}: no Sarmaaya EPS reference`);
      continue;
    }
    const num = (n: string) => { const v = rs?.get(n)?.ratio_value; return v === null || v === undefined ? null : Number(v); };
    const ttmEps = (rs?.get("P/E")?.inputs as { eps?: number } | null)?.eps ?? null;
    const rrEps = num("EPS (annualized)");
    const theirEps = snap.eps;

    const pbOk = snap.pb !== undefined ? near(num("P/B"), snap.pb, 0.06) : null;
    const dyOk = snap.dividendYield ? near(num("Dividend yield"), snap.dividendYield, 0.08) : null;
    const nmOk = snap.netMargin ? near(num("Net margin"), snap.netMargin, 0.06) : null;

    let cat = "DIVERGE";
    let detail = "";
    const dPct = ttmEps !== null && theirEps !== 0 ? (ttmEps / theirEps - 1) * 100 : null;

    if (ttmEps === null) { cat = "NO_TTM"; detail = "we compute no trailing EPS"; }
    else if (theirEps < 0 && ttmEps < 0) { cat = "LOSS"; detail = "both negative; P/E not meaningful"; }
    else if (near(ttmEps, theirEps, 0.03)) { cat = "MATCH"; detail = `trailing ${ttmEps.toFixed(2)} vs ${theirEps}`; }
    else if (near(rrEps, theirEps, 0.05)) { cat = "RUN_RATE"; detail = `Sarmaaya quotes run-rate ${rrEps?.toFixed(2)}; our trailing ${ttmEps.toFixed(2)} is a different convention`; }
    else if (snap.basis === "consolidated") { cat = "CONSOLIDATED"; detail = `group basis; our unconsolidated ${ttmEps.toFixed(2)} vs group ${theirEps}`; }
    else if (near(ttmEps, theirEps, 0.08)) { cat = "MATCH"; detail = `trailing ${ttmEps.toFixed(2)} vs ${theirEps} (within 8%)`; }
    else { detail = `trailing ${ttmEps.toFixed(2)} vs ${theirEps} (${dPct?.toFixed(0)}%)`; }

    rows.push({ ticker, cat, ourEps: ttmEps, theirEps, d: dPct, pbOk, dyOk, nmOk, cap: cap.get(ticker) ?? 0, basis: snap.basis ?? null, detail });
  }

  if (ONE) {
    const r = rows[0];
    if (!r) return;
    console.log(`${ONE}  ${store.snapshots[ONE]?.name ?? ""}${verified.has(ONE) ? "  [verified]" : ""}\n`);
    console.log(`  category   ${r.cat}`);
    console.log(`  ${r.detail}`);
    console.log(`  P/B agrees        ${r.pbOk === null ? "no reference" : r.pbOk}`);
    console.log(`  dividend yield    ${r.dyOk === null ? "no reference" : r.dyOk}`);
    console.log(`  net margin        ${r.nmOk === null ? "no reference" : r.nmOk}`);
    return;
  }

  const B = (x: number) => (x / 1e9).toFixed(0) + "B";
  const cats = ["MATCH", "RUN_RATE", "CONSOLIDATED", "LOSS", "NO_TTM", "DIVERGE"];
  console.log(`Reconciled ${rows.length} live companies against a Sarmaaya EPS\n`);
  console.log("category       count   market cap   already verified");
  for (const c of cats) {
    const g = rows.filter((r) => r.cat === c);
    console.log(`${c.padEnd(14)} ${String(g.length).padStart(5)}   ${B(g.reduce((s, r) => s + r.cap, 0)).padStart(10)}   ${g.filter((r) => verified.has(r.ticker)).length}`);
  }

  // Verification candidates: EPS agrees AND at least one independent metric
  // drawn from a different statement also agrees.
  const candidates = rows.filter(
    (r) => !verified.has(r.ticker) && (r.cat === "MATCH" || r.cat === "RUN_RATE") && (r.pbOk === true || r.dyOk === true || r.nmOk === true)
  );
  const strong = candidates.filter((r) => [r.pbOk, r.dyOk, r.nmOk].filter((x) => x === true).length >= 2);
  console.log(`\nverification candidates (EPS + >=1 independent metric): ${candidates.length}, ${B(candidates.reduce((s, r) => s + r.cap, 0))}`);
  console.log(`  of which >=2 independent metrics agree: ${strong.length}, ${B(strong.reduce((s, r) => s + r.cap, 0))}`);

  if (ARG("candidates")) {
    console.log(`\nticker    ourEPS  theirEPS   P/B    DY    NM   cap`);
    for (const r of candidates.sort((a, b) => b.cap - a.cap))
      console.log(
        `${r.ticker.padEnd(9)} ${(r.ourEps ?? 0).toFixed(2).padStart(7)} ${String(r.theirEps).padStart(9)}  ${String(r.pbOk ?? "-").padStart(5)} ${String(r.dyOk ?? "-").padStart(5)} ${String(r.nmOk ?? "-").padStart(5)}  ${B(r.cap)}`
      );
  }

  if (ARG("diverge")) {
    const d = rows.filter((r) => r.cat === "DIVERGE" || r.cat === "NO_TTM").sort((a, b) => b.cap - a.cap);
    console.log(`\nreal divergences, largest first:\n`);
    for (const r of d.slice(0, 60)) console.log(`${r.ticker.padEnd(9)} ${B(r.cap).padStart(7)}  ${verified.has(r.ticker) ? "[v] " : "    "}${r.detail}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
