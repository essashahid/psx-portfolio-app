import { loadEnvLocal } from "./load-env";

/**
 * Universe-wide PSX-portal refresh (free, no LLM, no OCR).
 *
 * Pulls each live company's latest official annual + quarterly summary
 * (sales / EPS / margins) from the PSX company page and recomputes ratios.
 * This is the cheapest coverage tier — one HTTP request per ticker — and its
 * job here is to cure the "stale portal series" gap where a stock's stored
 * annual data stops a year behind what the portal already publishes (LUCK sat
 * at FY2024 while the portal had FY2025).
 *
 * Idempotent: upserts by the canonical identity, so re-running only refreshes.
 * Holdings first. AI_DISABLED / VISION_DISABLED do not affect this — no model
 * is called.
 *
 *   npx tsx scripts/refresh-portal-annuals.ts [--concurrency N] [--limit N]
 */

async function main() {
  loadEnvLocal();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { populateFinancials } = await import("@/lib/engine/financials");
  const { refreshRatios } = await import("@/lib/engine/ratios");
  const db = createAdminClient();

  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const concurrency = Math.max(1, Number(flag("concurrency") ?? 4));
  const limit = Number(flag("limit") ?? Infinity);

  // Latest published annual fiscal year per ticker BEFORE the run, to measure lift.
  const beforeMax = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("ticker, fiscal_year")
      .eq("statement_type", "income_statement")
      .eq("period_type", "annual")
      .eq("review_status", "published")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) {
      const t = r.ticker as string, y = (r.fiscal_year as number) ?? 0;
      beforeMax.set(t, Math.max(beforeMax.get(t) ?? 0, y));
    }
    if (data.length < 1000) break;
  }

  const { data: hRows } = await db.from("holdings").select("ticker").gt("quantity", 0);
  const holdings = new Set((hRows ?? []).map((r) => (r.ticker as string).toUpperCase()));
  const companies = await activeUniverseTickers(db, "companies");
  const ordered = [...companies.filter((t) => holdings.has(t)), ...companies.filter((t) => !holdings.has(t))];
  const queue = ordered.slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`Portal refresh over ${queue.length} live companies (concurrency ${concurrency})\n`);

  let done = 0, refreshed = 0, advanced = 0, unreachable = 0;
  const advancedList: string[] = [];
  const started = Date.now();

  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < queue.length) {
        const t = queue[i++];
        try {
          const r = await populateFinancials(t);
          if (r.saved > 0) {
            refreshed++;
            await refreshRatios(db, t).catch(() => null);
          } else if (r.errors.some((e) => /unreachable|no financial tables/i.test(e))) {
            unreachable++;
          }
        } catch { unreachable++; }
        done++;
        if (done % 25 === 0 || done === queue.length) {
          process.stdout.write(`\r  ${done}/${queue.length}  (refreshed ${refreshed})   `);
        }
      }
    })
  );
  process.stdout.write("\n");

  // Measure how many tickers now have a newer latest published annual.
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("ticker, fiscal_year")
      .eq("statement_type", "income_statement")
      .eq("period_type", "annual")
      .eq("review_status", "published")
      .range(from, from + 999);
    if (!data?.length) break;
    const afterMax = new Map<string, number>();
    for (const r of data) {
      const tk = r.ticker as string, y = (r.fiscal_year as number) ?? 0;
      afterMax.set(tk, Math.max(afterMax.get(tk) ?? 0, y));
    }
    for (const [tk, y] of afterMax) {
      if (y > (beforeMax.get(tk) ?? 0)) { advanced++; if (advancedList.length < 60) advancedList.push(`${tk}→FY${y}`); }
    }
    if (data.length < 1000) break;
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n===== Done in ${mins} min =====`);
  console.log(`refreshed (rows saved): ${refreshed}`);
  console.log(`portal unreachable:     ${unreachable}`);
  console.log(`advanced to a newer annual: ${advanced}`);
  if (advancedList.length) console.log(`  ${advancedList.join(", ")}${advanced > advancedList.length ? " …" : ""}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
