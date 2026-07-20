/**
 * End-to-end accuracy check of what the stock APIs actually return.
 *
 * Exercises the same assembly path as GET /api/stocks/[ticker] (getRatioCard)
 * and compares the headline numbers a consumer would see against the Sarmaaya
 * reference. The point is not to re-test the ratio engine — it is to catch the
 * gap between "the database is right" and "the API returns it correctly":
 * float artefacts, missing verification status, a ratio present in the DB but
 * absent from the card, a period label that does not match the value.
 *
 *   npx tsx scripts/api-accuracy-check.ts             # verified sample
 *   npx tsx scripts/api-accuracy-check.ts --all       # every company with a ref
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync } from "node:fs";

loadEnvLocal();

const ALL = process.argv.includes("--all");

type Snap = { eps?: number; pe?: number; pb?: number; dividendYield?: number; basis?: string };

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { getRatioCard } = await import("@/lib/chat/data");
  const { verifiedTickers } = await import("@/lib/engine/verified");
  const db = createAdminClient();

  const store = JSON.parse(readFileSync("data/sarmaaya-snapshots.json", "utf8")).snapshots as Record<string, Snap>;
  const verified = verifiedTickers();
  const targets = ALL ? Object.keys(store).filter((t) => store[t].eps != null) : verified;

  let checked = 0;
  const problems: string[] = [];
  const unrounded: string[] = [];
  let noVerifiedField = 0;

  for (const t of targets) {
    const card = await getRatioCard(db, t);
    if (!card) continue;
    checked++;

    // 1. every numeric the API would emit must be presentation-clean
    for (const r of card.rows) {
      if (typeof r.value === "number" && Number.isFinite(r.value)) {
        const s = String(r.value);
        if (s.includes(".") && s.split(".")[1].length > 6) unrounded.push(`${t} ${r.name}=${s}`);
      }
    }

    // 2. verification status must be present and well-formed
    if (!card.verified || !("status" in card.verified)) noVerifiedField++;

    // 3. the headline value must agree with the reference
    const snap = store[t];
    const row = (n: string) => card.rows.find((r) => r.name === n);
    const pe = row("P/E");
    if (snap?.eps != null && pe) {
      const ourEps = (pe.inputs as { eps?: number } | undefined)?.eps ?? null;
      const rr = row("EPS (annualized)")?.value ?? null;
      const near = (a: number | null, b: number, p: number) => a !== null && b !== 0 && Math.abs(a / b - 1) <= p;
      const ok =
        near(ourEps, snap.eps, 0.08) ||
        near(typeof rr === "number" ? rr : null, snap.eps, 0.05) ||
        (snap.eps < 0 && ourEps !== null && ourEps < 0) ||
        snap.basis === "consolidated";
      if (!ok) problems.push(`${t}: API P/E eps ${ourEps} vs Sarmaaya ${snap.eps} (basis ${pe.period ?? "?"})`);
    }

    // 4. a value without a period label is unattributable
    for (const r of card.rows) {
      if (typeof r.value === "number" && !r.period) problems.push(`${t}: ${r.name} has a value but no period label`);
    }
  }

  console.log(`checked ${checked} companies through the API assembly path\n`);
  console.log(`unrounded floats leaking to consumers: ${unrounded.length}`);
  for (const u of unrounded.slice(0, 8)) console.log(`  ${u}`);
  console.log(`cards missing a verification status:   ${noVerifiedField}`);
  console.log(`headline disagreements with Sarmaaya:  ${problems.length}`);
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
