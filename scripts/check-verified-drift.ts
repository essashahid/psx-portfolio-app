/**
 * Standing gate: does every entry in the verified registry STILL agree with
 * its independent reference?
 *
 * This exists because of a blind spot that let seven entries go stale
 * unnoticed. The regression check run after each change compares the registry
 * before and after THAT change ("did I break anything?"). It never asked the
 * different question "does the registry still agree with the reference?" —
 * so when a later extraction rewrote a company's financials, the registry
 * kept asserting a verification that no longer held, and nothing complained.
 *
 * HBL is the clean illustration. Verified 7 July against a reference of
 * 45.16. The reference never moved. Today it serves 42.81, because its stored
 * chain changed underneath the registry entry.
 *
 * Run this after ANY extraction or backfill, not just after manual edits.
 * Exits non-zero when something has drifted, so it can gate a pipeline.
 *
 *   npx tsx scripts/check-verified-drift.ts
 *   npx tsx scripts/check-verified-drift.ts --tolerance 0.05
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync } from "node:fs";

loadEnvLocal();

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const TOL = arg("tolerance") ? Number(arg("tolerance")) : 0.03;

// Entries whose reference is legitimately NOT the yardstick, with the reason.
// Keep this list short and evidenced: it suppresses a real alarm, so an entry
// here must explain WHY the reference disagrees, not merely that it does.
const EXPECTED_DIVERGENCE: Record<string, string> = {
  // The reference carries a superseded pre-restatement comparative. The
  // company restated H1 FY2025 from -2.54 to -2.03 for a deferred-tax error;
  // chaining the old figure reproduces the reference exactly. We hold the
  // corrected figure per IAS 8, so we are right and the reference is stale.
  ADAMS: "reference chains a superseded pre-restatement comparative (documented in registry)",
};

type Row = { ticker: string; inputs: unknown; source_period: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function page<T>(db: any, table: string, sel: string, apply?: (q: never) => never): Promise<T[]> {
  const out: T[] = [];
  const P = 1000;
  for (let f = 0; ; f += P) {
    let q = db.from(table).select(sel).range(f, f + P - 1) as never;
    if (apply) q = apply(q);
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < P) break;
  }
  return out;
}

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const reg = JSON.parse(readFileSync("data/verified-tickers.json", "utf8")).verified as Record<string, { source?: string; basis?: string; throughPeriod?: string }>;
  const snap = JSON.parse(readFileSync("data/sarmaaya-snapshots.json", "utf8")).snapshots as Record<string, { eps?: number | null }>;

  const pe = await page<Row>(db, "company_ratios", "ticker,inputs,source_period", ((q: never) => (q as unknown as { eq: (a: string, b: string) => never }).eq("ratio_name", "P/E")) as never);
  const peBy = new Map(pe.map((r) => [r.ticker, r]));

  const drifted: string[] = [];
  const noRef: string[] = [];
  const noData: string[] = [];
  const expected: string[] = [];
  let ok = 0;

  for (const t of Object.keys(reg)) {
    const row = peBy.get(t);
    const eps = (row?.inputs as { eps?: number } | undefined)?.eps ?? null;
    const ref = snap[t]?.eps ?? null;

    if (eps == null) {
      noData.push(`${t.padEnd(8)} registry says verified but we serve NO EPS`);
      continue;
    }
    if (ref == null) {
      noRef.push(t);
      continue;
    }
    const gap = Math.abs(eps - ref) / Math.abs(ref);
    if (gap < TOL) {
      ok++;
      continue;
    }
    const why = EXPECTED_DIVERGENCE[t];
    const line = `${t.padEnd(8)} served ${eps.toFixed(2).padStart(9)} vs ref ${String(ref).padStart(9)}  (${(gap * 100).toFixed(1)}%)  [${reg[t].source ?? "?"}, ${reg[t].throughPeriod ?? "?"}]`;
    if (why) expected.push(`${line}\n           expected: ${why}`);
    else drifted.push(line);
  }

  console.log(`verified registry: ${Object.keys(reg).length} entries, tolerance ${(TOL * 100).toFixed(0)}%`);
  console.log(`  agree with reference: ${ok}`);
  console.log(`  no reference to check: ${noRef.length}`);
  console.log(`  expected divergence:  ${expected.length}`);
  console.log(`  DRIFTED:              ${drifted.length}`);
  if (expected.length) console.log(`\nexpected divergences (suppressed):\n  ${expected.join("\n  ")}`);
  if (noData.length) console.log(`\nMISSING DATA:\n  ${noData.join("\n  ")}`);
  if (drifted.length) {
    console.log(`\nDRIFTED — these claim a verification that no longer holds:\n  ${drifted.join("\n  ")}`);
    console.log(`\nEach needs one of: re-verification against the filing, a basis correction,`);
    console.log(`an EXPECTED_DIVERGENCE entry explaining why the reference is wrong, or removal`);
    console.log(`from the registry. Leaving it is the one option that is not acceptable, because`);
    console.log(`the registry is what tells users a figure was independently checked.`);
  }

  if (drifted.length || noData.length) process.exit(1);
  console.log(`\nall good.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
