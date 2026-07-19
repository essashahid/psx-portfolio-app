/**
 * Re-extract filings to recover the prior-year comparative columns.
 *
 * The extraction prompt used to say "Use the CURRENT period column (not the
 * comparative prior-year column)", so for years we threw away the one figure
 * the trailing-twelve-month chain needs most. TTM is
 * `annual + current interim - prior-year same interim`, and where the
 * comparative is missing the chain fails and P/E silently falls back to a
 * stale annual EPS. That is 159 companies as of the last audit.
 *
 * The comparative is printed in the same filing we already downloaded, so
 * this is a re-read rather than new data collection. KOHC proved it out:
 * before, P/E ran off the FY2025 annual (11.97); after, TTM is 10.61 against
 * Sarmaaya's 10.62.
 *
 * Costs money (vision OCR, roughly $0.014 per filing), so it runs against an
 * explicit target list, newest filings first, and reports before/after.
 *
 *   npx tsx scripts/backfill-comparatives.ts --limit 5 --dry
 *   npx tsx scripts/backfill-comparatives.ts --limit 40
 *   npx tsx scripts/backfill-comparatives.ts --ticker KOHC
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

// Vision is disabled by default in .env.local so nothing runs by accident.
// Enable it only for this process.
process.env.VISION_DISABLED = "false";
process.env.AI_DISABLED = "false";

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const DRY = process.argv.includes("--dry");
const LIMIT = Number(arg("limit") ?? 25);
const ONE = arg("ticker")?.toUpperCase() ?? null;
const FILINGS = Number(arg("filings") ?? 3);

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const db = createAdminClient();

  const live = new Set(await activeUniverseTickers(db, "companies"));

  const page = async <T>(table: string, cols: string, eq?: [string, string]): Promise<T[]> => {
    const out: T[] = [];
    for (let o = 0; ; o += 1000) {
      let q = db.from(table).select(cols).range(o, o + 999);
      if (eq) q = q.eq(eq[0], eq[1]);
      const { data } = await q;
      if (!data?.length) break;
      out.push(...(data as T[]));
      if (data.length < 1000) break;
    }
    return out;
  };

  const ratios = await page<{ ticker: string; ratio_name: string; source_period: string | null }>(
    "company_ratios",
    "ticker,ratio_name,source_period"
  );
  const quotes = await page<{ ticker: string; market_cap: number | null }>("market_quotes", "ticker,market_cap");
  const cap = new Map(quotes.map((q) => [q.ticker, Number(q.market_cap) || 0]));

  // Target: P/E exists but is not on a TTM basis — the observable symptom of a
  // missing comparative. Ranked by market cap so the spend goes where it matters.
  const targets = ONE
    ? [ONE]
    : ratios
        .filter((r) => r.ratio_name === "P/E" && live.has(r.ticker) && !(r.source_period ?? "").startsWith("TTM"))
        .map((r) => r.ticker)
        .sort((a, b) => (cap.get(b) ?? 0) - (cap.get(a) ?? 0))
        .slice(0, LIMIT);

  const B = (x: number) => (x / 1e9).toFixed(0) + "B";
  console.log(`${targets.length} companies to re-extract (${FILINGS} filings each)`);
  console.log(`combined market cap ${B(targets.reduce((s, t) => s + (cap.get(t) ?? 0), 0))}`);
  console.log(`estimated vision cost ~$${(targets.length * FILINGS * 0.014).toFixed(2)}\n`);
  if (DRY) {
    console.log(targets.map((t) => `${t} (${B(cap.get(t) ?? 0)})`).join(", "));
    return;
  }

  const { extractFinancials } = await import("@/lib/engine/financials");
  const { refreshRatios } = await import("@/lib/engine/ratios");

  let fixed = 0;
  let unchanged = 0;
  const failures: string[] = [];

  for (const [i, t] of targets.entries()) {
    const before = ratios.find((r) => r.ticker === t && r.ratio_name === "P/E")?.source_period ?? "none";
    try {
      const r = await extractFinancials(t, FILINGS, true);
      await refreshRatios(db, t);
      const { data } = await db
        .from("company_ratios")
        .select("source_period, ratio_value, inputs")
        .eq("ticker", t)
        .eq("ratio_name", "P/E")
        .maybeSingle();
      const after = data?.source_period ?? "none";
      const ok = after.startsWith("TTM");
      if (ok) fixed++;
      else unchanged++;
      console.log(
        `${String(i + 1).padStart(3)}/${targets.length} ${t.padEnd(7)} ${ok ? "FIXED  " : "still  "} ${before.padEnd(14)} -> ${after.padEnd(16)} eps=${(data?.inputs as { eps?: number })?.eps ?? "-"}  (saved ${r.saved})`
      );
    } catch (e) {
      failures.push(`${t}: ${(e as Error).message}`);
      console.log(`${String(i + 1).padStart(3)}/${targets.length} ${t.padEnd(7)} ERROR ${(e as Error).message.slice(0, 60)}`);
    }
  }

  console.log(`\nmoved onto a TTM basis: ${fixed}`);
  console.log(`still not on TTM: ${unchanged}`);
  if (failures.length) console.log(`errors: ${failures.length}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
