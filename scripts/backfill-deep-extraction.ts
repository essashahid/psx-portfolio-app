import { loadEnvLocal } from "./load-env";

/**
 * Bulk deep statement extraction (safe to re-run, resumable).
 *
 * Fills balance sheet + cash flow (and any missing income statements) for every
 * live company that still lacks a balance sheet, by parsing the official PSX
 * result-filing PDFs with the DeepSeek tasks model. This is the same path the
 * `backfill/extract` cron runs, just across the whole queue at once instead of
 * 8 per run.
 *
 * Resumable: the queue is "active companies with no balance_sheet", so re-runs
 * naturally skip anything already done. Already-extracted filings are also
 * de-duped by source_url inside extractFinancials, so no PDF is parsed twice.
 *
 *   npx tsx scripts/backfill-deep-extraction.ts [--limit N] [--concurrency N]
 *   npx tsx scripts/backfill-deep-extraction.ts --tickers AAA,BBB
 *   npx tsx scripts/backfill-deep-extraction.ts --from-file data/queue.txt
 *
 * --tickers / --from-file override the default "missing balance sheet" queue.
 * The reconciliation work needs a different queue: companies whose INCOME
 * chain is too sparse to build a trailing figure, which is a separate
 * condition from lacking a balance sheet (a company can have one and not the
 * other). Explicit targeting also makes the run auditable — the exact input
 * list is a file you can diff, rather than a query whose result moves as the
 * database changes underneath it.
 *
 * Outcomes are bucketed so you can see WHY a company got nothing:
 *   saved        — statements extracted and stored
 *   scannedOnly  — every candidate filing was a scanned/image PDF (needs OCR)
 *   noFilings    — no result-filing PDFs on the portal
 *   otherError   — download/parse/model errors (transient; retried next run)
 */

interface Buckets {
  saved: string[];
  scannedOnly: string[];
  noFilings: string[];
  otherError: string[];
}

function classify(errors: string[], skipped: string[], saved: number): keyof Buckets | null {
  if (saved > 0) return "saved";
  const all = [...errors, ...skipped];
  if (all.length === 0) return "noFilings"; // nothing to process
  if (errors.some((e) => /No result filings/.test(e))) return "noFilings";
  const nonScanned = errors.filter((e) => !/scanned\/image PDF|no text layer/.test(e));
  const hadScanned = errors.some((e) => /scanned\/image PDF|no text layer/.test(e));
  if (nonScanned.length === 0 && (hadScanned || skipped.length > 0)) return "scannedOnly";
  return "otherError";
}

async function main() {
  loadEnvLocal();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { extractFinancials } = await import("@/lib/engine/financials");
  const { refreshRatios } = await import("@/lib/engine/ratios");

  const args = process.argv.slice(2);
  const limArg = args.indexOf("--limit");
  const limit = limArg >= 0 ? Number(args[limArg + 1]) : Infinity;
  const conArg = args.indexOf("--concurrency");
  const concurrency = conArg >= 0 ? Math.max(1, Number(args[conArg + 1])) : 3;

  const db = createAdminClient();

  const tickArg = args.indexOf("--tickers");
  const fileArg = args.indexOf("--from-file");
  const explicit: string[] = [];
  if (tickArg >= 0) explicit.push(...(args[tickArg + 1] ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  if (fileArg >= 0) {
    const { readFileSync } = await import("node:fs");
    explicit.push(
      ...readFileSync(args[fileArg + 1], "utf8")
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    );
  }

  const companies = await activeUniverseTickers(db, "companies");
  let queue: string[];

  if (explicit.length) {
    // Intersect with the live universe: extracting a delisted or suspended
    // counter burns a model call on a company that will never be served.
    const liveSet = new Set(companies);
    const unknown = explicit.filter((t) => !liveSet.has(t));
    queue = explicit.filter((t) => liveSet.has(t)).slice(0, Number.isFinite(limit) ? limit : undefined);
    console.log(`Live companies: ${companies.length}`);
    console.log(`Explicit queue: ${queue.length} of ${explicit.length} requested${unknown.length ? ` (${unknown.length} not in live universe: ${unknown.slice(0, 10).join(", ")})` : ""}`);
  } else {
    // Which already have a balance sheet? Those are done.
    const hasBalance = new Set<string>();
    for (let i = 0; i < companies.length; i += 400) {
      const { data } = await db
        .from("company_financials")
        .select("ticker")
        .eq("statement_type", "balance_sheet")
        .eq("review_status", "published")
        .in("ticker", companies.slice(i, i + 400));
      for (const r of data ?? []) hasBalance.add((r.ticker as string).toUpperCase());
    }
    queue = companies.filter((t) => !hasBalance.has(t)).slice(0, Number.isFinite(limit) ? limit : undefined);
    console.log(`Live companies: ${companies.length}`);
    console.log(`Already have balance sheet: ${hasBalance.size}`);
    console.log(`Queue (missing balance sheet): ${queue.length}${Number.isFinite(limit) ? ` (capped at ${limit})` : ""}`);
  }
  console.log(`Concurrency: ${concurrency}\n`);

  const buckets: Buckets = { saved: [], scannedOnly: [], noFilings: [], otherError: [] };
  let done = 0;
  const started = Date.now();

  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < queue.length) {
        const t = queue[i++];
        try {
          const r = await extractFinancials(t, 2);
          if (r.saved > 0) await refreshRatios(db, t).catch(() => null);
          const bucket = classify(r.errors, r.skipped, r.saved);
          if (bucket) buckets[bucket].push(t);
          done++;
          const tag = r.saved > 0 ? `saved ${r.saved}` : (bucket ?? "?");
          console.log(`[${done}/${queue.length}] ${t}: ${tag}`);
        } catch (e) {
          buckets.otherError.push(t);
          done++;
          console.log(`[${done}/${queue.length}] ${t}: THREW ${(e as Error).message.slice(0, 80)}`);
        }
      }
    })
  );

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n===== Done in ${mins} min =====`);
  console.log(`saved:        ${buckets.saved.length}`);
  console.log(`scannedOnly:  ${buckets.scannedOnly.length} (need OCR — no text-layer PDF available)`);
  console.log(`noFilings:    ${buckets.noFilings.length} (no result PDFs on portal)`);
  console.log(`otherError:   ${buckets.otherError.length} (transient — retry)`);
  if (buckets.otherError.length) console.log(`  otherError tickers: ${buckets.otherError.slice(0, 40).join(", ")}`);
  if (buckets.scannedOnly.length) console.log(`  scannedOnly sample: ${buckets.scannedOnly.slice(0, 30).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
