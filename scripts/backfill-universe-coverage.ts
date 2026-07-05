import { loadEnvLocal } from "./load-env";

/**
 * Universe-wide financial-data coverage backfill (safe to re-run, resumable).
 *
 * For every live company, runs the full waterfall:
 *   1. populateFinancials  — PSX portal page (income/EPS/margins, free, no LLM)
 *   2. extractFinancials   — latest result-filing PDFs: text layer via the
 *      DeepSeek tasks model (cheap), then chunked vision OCR via the
 *      configured vision provider (lib/ai/vision.ts — OpenRouter by default)
 *      for scanned statement pages
 *   3. refreshRatios       — recompute the full ratio card (TTM-aware)
 *
 * Resumable: extraction dedupes per filing by statement types already saved,
 * so re-runs only touch new filings and past failures. Holdings are processed
 * first so the names that matter most refresh soonest.
 *
 *   npx tsx scripts/backfill-universe-coverage.ts [--limit N] [--concurrency N]
 *                                                 [--tickers PPL,OGDC] [--no-vision]
 *
 * Cost: the portal and ratio steps are free. Text extraction is fractions of a
 * cent per filing. Vision OCR cost depends on VISION_MODEL — with a cheap
 * OpenRouter model (default google/gemini-2.5-flash) a full-universe pass runs
 * single-digit dollars; the script prints the metered token usage at the end.
 */

interface Summary {
  portalOk: string[];
  deepSaved: string[];
  nothingNew: string[];
  scannedBlocked: string[];
  errors: string[];
}

async function main() {
  loadEnvLocal();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { populateFinancials, extractFinancials } = await import("@/lib/engine/financials");
  const { refreshRatios } = await import("@/lib/engine/ratios");
  const { getVisionUsage, visionProviderLabel, visionConfigured } = await import("@/lib/ai/vision");

  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const limit = Number(flag("limit") ?? Infinity);
  const concurrency = Math.max(1, Number(flag("concurrency") ?? 3));
  const onlyTickers = flag("tickers")?.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (args.includes("--no-vision")) process.env.VISION_DISABLED = "true";

  const db = createAdminClient();

  // Holdings first, then the rest of the live universe.
  const { data: holdingRows } = await db.from("holdings").select("ticker").gt("quantity", 0);
  const holdings = [...new Set((holdingRows ?? []).map((r) => (r.ticker as string).toUpperCase()))];
  const companies = await activeUniverseTickers(db, "companies");
  const ordered = [...holdings.filter((t) => companies.includes(t)), ...companies.filter((t) => !holdings.includes(t))];
  const queue = (onlyTickers ?? ordered).slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`Universe: ${companies.length} live companies; queue: ${queue.length} (holdings first)`);
  console.log(`Vision provider: ${visionConfigured() ? visionProviderLabel() : "DISABLED — scanned filings will be skipped"}`);
  console.log(`Concurrency: ${concurrency}\n`);

  const summary: Summary = { portalOk: [], deepSaved: [], nothingNew: [], scannedBlocked: [], errors: [] };
  let done = 0;
  const started = Date.now();

  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < queue.length) {
        const t = queue[i++];
        const notes: string[] = [];
        try {
          const portal = await populateFinancials(t).catch((e) => ({ saved: 0, errors: [String(e)], processed: 0, skipped: [], ticker: t }));
          if (portal.saved > 0) summary.portalOk.push(t);

          const deep = await extractFinancials(t, 3).catch((e) => ({ saved: 0, errors: [String(e)], processed: 0, skipped: [], ticker: t }));
          if (deep.saved > 0) {
            summary.deepSaved.push(t);
            notes.push(`deep +${deep.saved}`);
          } else if (deep.errors.some((e) => /no vision provider|disabled|scanned\/image/i.test(e))) {
            summary.scannedBlocked.push(t);
            notes.push("scanned-blocked");
          } else if (deep.errors.length) {
            summary.errors.push(t);
            notes.push(deep.errors[0].slice(0, 120));
          } else {
            summary.nothingNew.push(t);
          }

          if (portal.saved > 0 || deep.saved > 0) await refreshRatios(db, t).catch(() => null);
        } catch (e) {
          summary.errors.push(t);
          notes.push(`THREW ${(e as Error).message.slice(0, 100)}`);
        }
        done++;
        console.log(`[${done}/${queue.length}] ${t}${notes.length ? ": " + notes.join(" | ") : ""}`);
      }
    })
  );

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  const u = getVisionUsage();
  console.log(`\n===== Done in ${mins} min =====`);
  console.log(`portal refreshed:   ${summary.portalOk.length}`);
  console.log(`deep rows saved:    ${summary.deepSaved.length}`);
  console.log(`up to date already: ${summary.nothingNew.length}`);
  console.log(`scanned, blocked:   ${summary.scannedBlocked.length} (no vision provider / disabled)`);
  console.log(`errors (retryable): ${summary.errors.length}${summary.errors.length ? " — " + summary.errors.slice(0, 30).join(", ") : ""}`);
  console.log(`vision usage:       ${u.calls} calls, ${u.promptTokens.toLocaleString()} in / ${u.completionTokens.toLocaleString()} out tokens (${visionProviderLabel()})`);

  // Final coverage picture, paginated past the 1000-row default cap.
  const byTicker = new Map<string, Set<string>>();
  for (let off = 0; ; off += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("ticker, statement_type")
      .eq("review_status", "published")
      .range(off, off + 999);
    if (!data?.length) break;
    for (const r of data) {
      const s = byTicker.get(r.ticker as string) ?? new Set<string>();
      s.add(r.statement_type as string);
      byTicker.set(r.ticker as string, s);
    }
    if (data.length < 1000) break;
  }
  const live = new Set(companies);
  const liveCov = [...byTicker.entries()].filter(([t]) => live.has(t));
  console.log(`\nCoverage (live universe of ${companies.length}):`);
  console.log(`  any financials: ${liveCov.length}`);
  console.log(`  balance sheet:  ${liveCov.filter(([, s]) => s.has("balance_sheet")).length}`);
  console.log(`  cash flow:      ${liveCov.filter(([, s]) => s.has("cash_flow")).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
