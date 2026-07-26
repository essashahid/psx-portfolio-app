import { loadEnvLocal } from "../lib/load-env";

loadEnvLocal();

/**
 * Backfill the business description on every live company from the exchange's
 * own company page.
 *
 * The description is the one piece of prose on the company page, so it is only
 * ever quoted from PSX — never inferred, never generated. Rows are written with
 * the company-page URL as their source, which is what the Overview trusts.
 *
 * Safe to re-run. By default it only fetches companies that have no usable
 * description, so a second run is nearly free and picks up whatever failed or
 * was newly listed. Pass --force to refresh rows that already have one.
 *
 *   npx tsx scripts/backfills/company-descriptions.ts            # fill the gaps
 *   npx tsx scripts/backfills/company-descriptions.ts --force    # refresh everything
 *   npx tsx scripts/backfills/company-descriptions.ts --limit 25 # try a few first
 *
 * PSX is fetched one company at a time with a pause between, because this walks
 * the whole universe and there is no reason to hammer the exchange for a field
 * that changes once a year.
 */

const FORCE = process.argv.includes("--force");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const PAUSE_MS = 400;
const MIN_USEFUL = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { fetchPsxCompanyProfile } = await import("@/lib/company/psx-profile");
  const { saveCompanyDescription } = await import("@/lib/company/metadata");
  const db = createAdminClient();

  /**
   * Read a whole table. PostgREST caps a response at its own max_rows —
   * typically 1,000 — whatever limit is asked for, so a plain .limit(4000)
   * silently returns a first page. That truncation made MCB, which has a
   * perfectly good description, look undescribed and queued it for a pointless
   * refetch.
   */
  async function readAll<T>(table: string, columns: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from(table).select(columns).range(offset, offset + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  // The live universe, not the full registry: the registry carries dead lines
  // and non-equity instruments whose company pages do not exist.
  const snapshot = await readAll<{ ticker: string }>("market_snapshot_items", "ticker");
  const live = [...new Set(snapshot.map((r) => String(r.ticker).toUpperCase()))].sort();

  const existing = await readAll<{ ticker: string; description: string | null }>(
    "company_metadata",
    "ticker, description"
  );
  const hasDescription = new Set(
    existing
      .filter((r) => typeof r.description === "string" && r.description.trim().length >= MIN_USEFUL)
      .map((r) => String(r.ticker).toUpperCase())
  );

  let targets = FORCE ? live : live.filter((t) => !hasDescription.has(t));
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log(
    `${live.length} live companies, ${hasDescription.size} already described.\n` +
      `Fetching ${targets.length}${FORCE ? " (forced refresh)" : ""}.\n`
  );

  let saved = 0;
  let empty = 0;
  let failed = 0;

  for (const [i, ticker] of targets.entries()) {
    try {
      const profile = await fetchPsxCompanyProfile(ticker);
      const text = profile?.businessDescription?.trim() ?? "";

      if (!profile || text.length < MIN_USEFUL) {
        empty++;
        console.log(`  ${String(i + 1).padStart(4)}/${targets.length}  ${ticker.padEnd(10)} no description on the page`);
      } else {
        await saveCompanyDescription(ticker, {
          description: text,
          website: profile.website,
          // The URL is what marks this as exchange prose; the source label is
          // overwritten elsewhere, so the URL is the durable provenance.
          source: "psx-company-page",
          source_url: profile.sourceUrl,
          confidence: 1,
        });
        saved++;
        console.log(`  ${String(i + 1).padStart(4)}/${targets.length}  ${ticker.padEnd(10)} saved ${text.length} chars`);
      }
    } catch (err) {
      failed++;
      console.log(
        `  ${String(i + 1).padStart(4)}/${targets.length}  ${ticker.padEnd(10)} FAILED ${
          err instanceof Error ? err.message.slice(0, 60) : "unknown"
        }`
      );
    }
    if (i < targets.length - 1) await sleep(PAUSE_MS);
  }

  console.log(
    `\nDone. ${saved} saved, ${empty} with no description published, ${failed} failed.\n` +
      `Re-run to retry the failures; it skips everything already stored.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
