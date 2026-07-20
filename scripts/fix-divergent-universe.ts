/**
 * Re-extract every live company whose trailing EPS diverges from the Sarmaaya
 * reference (and the handful computing no TTM at all), using the corrected
 * extraction prompt (one statement set, all period columns).
 *
 * This is the bulk remediation pass for the 139 divergences the reconciler
 * found. Two failure families it fixes directly:
 *   - stale P/E (filings exist but were never extracted; getCompanyFilings
 *     fetches the live PSX list, so new filings are picked up automatically)
 *   - missing/corrupt comparatives and multi-basis double-reads
 * Companies that stay divergent after a clean re-read are the residue that
 * needs human judgement (share-count breaks, us-right-Sarmaaya-wrong cases,
 * genuinely unreadable filings) and are written to a report for that purpose.
 *
 *   npx tsx scripts/fix-divergent-universe.ts --dry     # list targets
 *   npx tsx scripts/fix-divergent-universe.ts           # run
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync, writeFileSync } from "node:fs";

loadEnvLocal();

process.env.VISION_DISABLED = "false";
process.env.AI_DISABLED = "false";

const DRY = process.argv.includes("--dry");
// Already re-extracted individually while diagnosing the multi-basis bug.
const ALREADY_DONE = new Set(["AVN", "SIEM", "PSEL", "SEARL", "GAL", "HUMNL"]);

type Snap = { eps?: number; basis?: string };

const near = (a: number | null, b: number, pct: number): boolean =>
  a !== null && b !== 0 && Math.abs(a / b - 1) <= pct;

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const db = createAdminClient();

  const store = JSON.parse(readFileSync("data/sarmaaya-snapshots.json", "utf8")).snapshots as Record<string, Snap>;
  const live = await activeUniverseTickers(db, "companies");

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
  type R = { ticker: string; ratio_name: string; ratio_value: number | null; inputs: { eps?: number } | null };
  const ratios = await page<R>("company_ratios", "ticker,ratio_name,ratio_value,inputs");
  const quotes = await page<{ ticker: string; market_cap: number | null }>("market_quotes", "ticker,market_cap");
  const cap = new Map(quotes.map((q) => [q.ticker, Number(q.market_cap) || 0]));
  const R2: Record<string, Record<string, R>> = {};
  for (const r of ratios) (R2[r.ticker] ??= {})[r.ratio_name] = r;

  const targets: string[] = [];
  for (const t of live) {
    if (ALREADY_DONE.has(t)) continue;
    const s = store[t];
    if (!s || s.eps === undefined || s.eps === null) continue;
    if (s.basis === "consolidated") continue;
    const ours = R2[t]?.["P/E"]?.inputs?.eps ?? null;
    const rr = R2[t]?.["EPS (annualized)"]?.ratio_value ?? null;
    if (ours !== null && s.eps < 0 && ours < 0) continue;
    if (near(ours, s.eps, 0.08) || near(rr === null ? null : Number(rr), s.eps, 0.05)) continue;
    targets.push(t);
  }
  targets.sort((a, b) => (cap.get(b) ?? 0) - (cap.get(a) ?? 0));

  const B = (x: number) => (x / 1e9).toFixed(1) + "B";
  console.log(`${targets.length} divergent companies to re-extract`);
  console.log(`combined cap ${B(targets.reduce((s, t) => s + (cap.get(t) ?? 0), 0))}, est cost ~$${(targets.length * 3 * 0.014).toFixed(2)}\n`);
  if (DRY) {
    console.log(targets.join(", "));
    return;
  }

  const { extractFinancials } = await import("@/lib/engine/financials");
  const { refreshRatios } = await import("@/lib/engine/ratios");

  // Resumable: this run takes hours and has been interrupted before. Every
  // company's outcome is appended to a checkpoint the moment it completes, so
  // a restart skips finished work instead of re-paying for it.
  const CKPT = "data/remediation-progress.json";
  type Outcome = { ticker: string; ok: boolean; ours: number | null; theirs: number; note: string; at: string };
  let done: Record<string, Outcome> = {};
  try {
    done = JSON.parse(readFileSync(CKPT, "utf8")).done ?? {};
  } catch {
    done = {};
  }
  const pending = targets.filter((t) => !done[t]);
  if (Object.keys(done).length) {
    console.log(`checkpoint holds ${Object.keys(done).length} completed; ${pending.length} still to do\n`);
  }

  const saveCkpt = () =>
    writeFileSync(
      CKPT,
      JSON.stringify({ _note: "Per-company outcome of the divergence remediation pass. Delete to force a full re-run.", done }, null, 2) + "\n"
    );

  const residue: { ticker: string; ours: number | null; theirs: number; note: string }[] = [];
  let fixed = 0;
  for (const o of Object.values(done)) {
    if (o.ok) fixed++;
    else residue.push({ ticker: o.ticker, ours: o.ours, theirs: o.theirs, note: o.note });
  }

  for (const [i, t] of pending.entries()) {
    const theirs = store[t].eps!;
    try {
      // Supersede prior filing reads so the corrected prompt's rows win cleanly.
      await db
        .from("company_financials")
        .update({ review_status: "needs_review", validation_flags: ["superseded_by_reextract"] })
        .eq("ticker", t)
        .eq("source_type", "psx-filing")
        .eq("review_status", "published");
      const r = await extractFinancials(t, 3, true);
      await refreshRatios(db, t);
      const { data } = await db
        .from("company_ratios")
        .select("ratio_value,inputs,source_period")
        .eq("ticker", t)
        .eq("ratio_name", "P/E")
        .maybeSingle();
      const ours = (data?.inputs as { eps?: number } | null)?.eps ?? null;
      const { data: rr } = await db
        .from("company_ratios")
        .select("ratio_value")
        .eq("ticker", t)
        .eq("ratio_name", "EPS (annualized)")
        .maybeSingle();
      const ok = near(ours, theirs, 0.08) || near(rr?.ratio_value == null ? null : Number(rr.ratio_value), theirs, 0.05) || (theirs < 0 && ours !== null && ours < 0);
      const note = `basis ${data?.source_period ?? "none"}, saved ${r.saved}`;
      if (ok) fixed++;
      else residue.push({ ticker: t, ours, theirs, note });
      done[t] = { ticker: t, ok, ours, theirs, note, at: new Date().toISOString() };
      saveCkpt();
      console.log(
        `${String(i + 1).padStart(3)}/${pending.length} ${t.padEnd(8)} ${ok ? "FIXED " : "still "} ours=${ours === null ? "-" : ours.toFixed(2)} sarmaaya=${theirs} (${data?.source_period ?? "none"}, saved ${r.saved})`
      );
    } catch (e) {
      const note = `ERROR ${(e as Error).message.slice(0, 80)}`;
      residue.push({ ticker: t, ours: null, theirs, note });
      done[t] = { ticker: t, ok: false, ours: null, theirs, note, at: new Date().toISOString() };
      saveCkpt();
      console.log(`${String(i + 1).padStart(3)}/${pending.length} ${t.padEnd(8)} ERROR ${(e as Error).message.slice(0, 70)}`);
    }
  }

  console.log(`\nfixed: ${fixed}/${targets.length}`);
  console.log(`residue for human judgement: ${residue.length}`);
  writeFileSync(
    "data/divergence-residue.json",
    JSON.stringify(
      {
        _note:
          "Companies still diverging from Sarmaaya after a clean re-extraction with the corrected prompt. Each needs human judgement: share-count break, us-right-Sarmaaya-wrong, or unreadable filings.",
        _asOf: new Date().toISOString().slice(0, 10),
        residue,
      },
      null,
      2
    ) + "\n"
  );
  console.log("written: data/divergence-residue.json");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
