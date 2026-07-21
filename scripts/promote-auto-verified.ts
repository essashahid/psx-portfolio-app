/**
 * Promote companies whose INDEPENDENTLY COMPUTED figures already agree with
 * the Sarmaaya reference, at a distinct and weaker evidence tier than the
 * hand/filing-read entries.
 *
 * What this tier does and does not claim:
 *   DOES  — our TTM EPS, built from stored filing data by the ratio engine,
 *           lands within 2% of an independent outside reference, AND the
 *           P/B (a different ratio off a different statement) independently
 *           agrees within 15%. Two unrelated metrics agreeing by chance is
 *           unlikely; that is the whole basis of this tier.
 *   DOES NOT — assert anyone opened the filing and confirmed the figures,
 *           the reporting basis, or that no restatement (bonus/rights) sits
 *           unhandled underneath. Those are exactly the things that turned
 *           out to matter for SEARL (un-restated bonus), MUGHAL (basis), and
 *           GAL (mislabeled balance sheet), none of which EPS agreement
 *           alone would have caught.
 *
 * Marked source "auto+Sarmaaya" so it is greppable and downgradeable as a
 * group if the tier ever proves unreliable.
 *
 * The P/B gate is not decoration. LUCK carried a plausible P/B of 1.48 for
 * weeks that was silently pairing consolidated equity against unconsolidated
 * EPS. A company whose two metrics disagree is exactly the kind that needs a
 * human read, so it is held back rather than promoted.
 *
 *   npx tsx scripts/promote-auto-verified.ts --dry
 *   npx tsx scripts/promote-auto-verified.ts
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync, writeFileSync } from "node:fs";

loadEnvLocal();
const DRY = process.argv.includes("--dry");

const EPS_TOL = 0.02;
const PB_TOL = 0.15;
const REGISTRY = "data/verified-tickers.json";

interface Snap {
  eps?: number | null;
  pb?: number | null;
  name?: string;
}

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { verifiedTickers } = await import("@/lib/engine/verified");
  const db = createAdminClient();

  const live = await activeUniverseTickers(db, "companies");
  const already = new Set(verifiedTickers());
  const store = JSON.parse(readFileSync("data/sarmaaya-snapshots.json", "utf8")).snapshots as Record<string, Snap>;

  const pass: { t: string; eps: number; refEps: number; epsOff: number; pb: number | null; refPb: number | null; pbOff: number | null; period: string }[] = [];
  const heldNoPb: string[] = [];
  const heldPbDiverges: { t: string; pb: number; refPb: number; off: number }[] = [];

  for (const t of live) {
    if (already.has(t)) continue;
    const s = store[t];
    if (!s || s.eps == null || s.eps === 0) continue;

    const { data: peRow } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", t).eq("ratio_name", "P/E").maybeSingle();
    const ours = (peRow?.inputs as { eps?: number } | undefined)?.eps ?? null;
    if (ours == null) continue;
    // Same sign required: a +2% match between a profit and a loss is meaningless.
    if (ours < 0 !== s.eps < 0) continue;
    const epsOff = Math.abs(ours / s.eps - 1);
    if (epsOff > EPS_TOL) continue;

    const { data: pbRow } = await db.from("company_ratios").select("ratio_value").eq("ticker", t).eq("ratio_name", "P/B").maybeSingle();
    const pb = pbRow?.ratio_value == null ? null : Number(pbRow.ratio_value);

    if (pb == null || s.pb == null || s.pb === 0) {
      heldNoPb.push(t);
      continue;
    }
    const pbOff = Math.abs(pb / s.pb - 1);
    if (pbOff > PB_TOL) {
      heldPbDiverges.push({ t, pb, refPb: s.pb, off: pbOff });
      continue;
    }
    pass.push({ t, eps: ours, refEps: s.eps, epsOff, pb, refPb: s.pb, pbOff, period: peRow?.source_period ?? "?" });
  }

  pass.sort((a, b) => a.epsOff - b.epsOff);
  console.log(`PASS both gates: ${pass.length}`);
  for (const p of pass) {
    console.log(`  ${p.t.padEnd(8)} eps ${p.eps.toFixed(2).padStart(9)} vs ${String(p.refEps).padStart(8)} (${(p.epsOff * 100).toFixed(1)}%)  pb ${p.pb!.toFixed(2)} vs ${p.refPb} (${(p.pbOff! * 100).toFixed(1)}%)`);
  }
  console.log(`\nHELD — EPS matched but no P/B on one side: ${heldNoPb.length}`);
  console.log(`  ${heldNoPb.join(", ")}`);
  console.log(`\nHELD — EPS matched but P/B diverges >${PB_TOL * 100}%: ${heldPbDiverges.length}`);
  for (const h of heldPbDiverges) console.log(`  ${h.t.padEnd(8)} pb ${h.pb.toFixed(2)} vs ${h.refPb} (${(h.off * 100).toFixed(0)}%)`);

  if (DRY) {
    console.log("\n[dry] nothing written");
    return;
  }

  const reg = JSON.parse(readFileSync(REGISTRY, "utf8"));
  for (const p of pass) {
    reg.verified[p.t] = {
      throughPeriod: p.period,
      basis: "unconsolidated",
      source: "auto+Sarmaaya",
      date: "2026-07-21",
      note:
        `bulk-promoted on independent agreement, NOT a filing read. Our engine-computed trailing EPS ${p.eps.toFixed(2)} vs Sarmaaya ${p.refEps} (${(p.epsOff * 100).toFixed(1)}%), and P/B ${p.pb!.toFixed(2)} vs ${p.refPb} (${(p.pbOff! * 100).toFixed(1)}%) — two ratios off different statements agreeing independently. No one opened the filing, so an un-restated bonus/rights issue or a basis subtlety could still be hiding underneath (the failure modes that caught SEARL, MUGHAL and GAL). Weaker tier than the "filing+Sarmaaya"/"hand+Sarmaaya" entries; re-verify by hand before relying on it for anything load-bearing.`,
    };
  }
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + "\n");
  console.log(`\nwritten: ${pass.length} promoted (registry now ${Object.keys(reg.verified).length})`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
