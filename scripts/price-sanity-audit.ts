/**
 * Price sanity audit.
 *
 * A wrong price silently corrupts every price-derived ratio at once — P/E,
 * P/B, P/S, EV/*, earnings and dividend yield — while the underlying
 * financials stay perfectly correct, so none of the statement-level checks
 * can see it. PPL was serving a P/E of 1.21 on a price of 35.85 when the
 * stock trades near 252.
 *
 * Two independent cross-checks, because either alone has blind spots:
 *   1. against the Sarmaaya close (an external observation)
 *   2. against market_cap / shares outstanding (an internal identity, which
 *      catches cases where our own quote row disagrees with itself)
 *
 *   npx tsx scripts/price-sanity-audit.ts
 *   npx tsx scripts/price-sanity-audit.ts --all
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync } from "node:fs";

loadEnvLocal();
const ALL = process.argv.includes("--all");

type Snap = { priceClose?: number; shares?: number; marketCap?: number };

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const db = createAdminClient();

  const store = JSON.parse(readFileSync("data/sarmaaya-snapshots.json", "utf8")).snapshots as Record<string, Snap>;
  const live = new Set(await activeUniverseTickers(db, "companies"));

  const quotes: { ticker: string; price: number | null; market_cap: number | null; as_of: string | null; provider: string | null }[] = [];
  for (let o = 0; ; o += 1000) {
    const { data } = await db.from("market_quotes").select("ticker,price,market_cap,as_of,provider").range(o, o + 999);
    if (!data?.length) break;
    quotes.push(...data);
    if (data.length < 1000) break;
  }

  type Bad = { ticker: string; ours: number; theirs: number | null; implied: number | null; ratio: number; provider: string; asOf: string };
  const bad: Bad[] = [];
  let checked = 0;
  const byProvider = new Map<string, { n: number; bad: number }>();

  for (const q of quotes) {
    if (!live.has(q.ticker)) continue;
    const ours = Number(q.price);
    if (!Number.isFinite(ours) || ours <= 0) continue;
    const snap = store[q.ticker];
    const theirs = snap?.priceClose ?? null;
    const implied = snap?.shares && q.market_cap ? Number(q.market_cap) / snap.shares : null;
    checked++;
    const p = q.provider ?? "?";
    const agg = byProvider.get(p) ?? { n: 0, bad: 0 };
    agg.n++;

    // Trust a disagreement only when BOTH references point the same way, so a
    // single stale reference cannot condemn a correct price.
    const offExternal = theirs !== null && Math.abs(ours / theirs - 1) > 0.15;
    const offInternal = implied !== null && Math.abs(ours / implied - 1) > 0.15;
    if (offExternal && (offInternal || theirs !== null)) {
      const ratio = theirs ? ours / theirs : 0;
      bad.push({ ticker: q.ticker, ours, theirs, implied, ratio, provider: p, asOf: q.as_of ?? "" });
      agg.bad++;
    }
    byProvider.set(p, agg);
  }

  console.log(`checked ${checked} live quotes against Sarmaaya close + market-cap identity\n`);
  console.log(`prices disagreeing by >15%: ${bad.length}\n`);
  console.log("provider        quotes   wrong");
  for (const [p, a] of [...byProvider].sort((x, y) => y[1].bad - x[1].bad))
    console.log(`${p.padEnd(14)} ${String(a.n).padStart(6)} ${String(a.bad).padStart(7)}  ${a.n ? ((a.bad / a.n) * 100).toFixed(0) + "%" : ""}`);

  const scale = (r: number) => {
    for (const [f, l] of [[100, "100x"], [10, "10x"], [7, "~7x"], [0.1, "1/10"], [0.01, "1/100"]] as [number, string][])
      if (Math.abs(r / f - 1) < 0.25) return l;
    return "";
  };
  const show = ALL ? bad : bad.slice(0, 30);
  console.log(`\n${ALL ? "all" : "first 30"} (ours vs Sarmaaya vs cap/shares):`);
  for (const b of show.sort((a, c) => Math.abs(c.ratio - 1) - Math.abs(a.ratio - 1)))
    console.log(
      `${b.ticker.padEnd(9)} ours=${b.ours.toFixed(2).padStart(10)} sarmaaya=${(b.theirs ?? 0).toFixed(2).padStart(10)} implied=${b.implied === null ? "     -" : b.implied.toFixed(2).padStart(10)}  ${scale(b.ratio).padEnd(5)} ${b.provider} ${b.asOf}`
    );
}

main().catch((e) => { console.error(e.message); process.exit(1); });
