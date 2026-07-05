import { loadEnvLocal } from "./load-env";

/**
 * Quarantine sweep (free, no LLM): run the deterministic accounting-identity
 * checks across the EXISTING published financial rows and downgrade any that
 * fail their own identities to `needs_review`, so they stop feeding ratios and
 * the Copilot.
 *
 * The write-time checks (statementIdentityViolations) only guard NEW writes;
 * the ~6.3k rows already in the table were bulk-migrated in as `published`
 * without ever passing through them. This closes that gap for the backlog.
 *
 * Idempotent: re-running only ever re-flags the same failing rows, and rows
 * that pass are left published. The revision-audit trigger records every
 * status change automatically, so the downgrade is fully traceable.
 *
 *   npx tsx scripts/quarantine-invalid-financials.ts            # dry run (default)
 *   npx tsx scripts/quarantine-invalid-financials.ts --apply    # write changes
 */

interface Row {
  id: string;
  ticker: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: "income_statement" | "balance_sheet" | "cash_flow";
  reporting_basis: string;
  validation_flags: unknown;
  data: Record<string, number | null | string>;
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { statementIdentityViolations } = await import("@/lib/engine/financials");
  const db = createAdminClient();

  // Pull every published row, paginating past the 1000-row default cap.
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("company_financials")
      .select("id, ticker, fiscal_year, fiscal_period, statement_type, reporting_basis, validation_flags, data")
      .eq("review_status", "published")
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }
  console.log(`Scanning ${rows.length} published rows...\n`);

  const flagged: { row: Row; flags: string[] }[] = [];
  for (const row of rows) {
    const violations = statementIdentityViolations({ statement_type: row.statement_type, data: row.data });
    if (violations.length) flagged.push({ row, flags: violations.map((v) => v.flag) });
  }

  const byFlag = new Map<string, number>();
  const byTicker = new Set<string>();
  for (const { row, flags } of flagged) {
    byTicker.add(row.ticker);
    for (const f of flags) byFlag.set(f, (byFlag.get(f) ?? 0) + 1);
  }

  console.log(`Rows failing an accounting identity: ${flagged.length} across ${byTicker.size} tickers`);
  for (const [flag, n] of [...byFlag.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${flag}: ${n}`);
  console.log(`\nSample:`);
  for (const { row, flags } of flagged.slice(0, 25)) {
    console.log(`  ${row.ticker} ${row.fiscal_year} ${row.fiscal_period} ${row.statement_type} [${row.reporting_basis}] → ${flags.join(", ")}`);
  }
  if (flagged.length > 25) console.log(`  … +${flagged.length - 25} more`);

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to quarantine these ${flagged.length} rows.`);
    return;
  }

  console.log(`\nApplying: downgrading ${flagged.length} rows to needs_review...`);
  let updated = 0;
  const errors: string[] = [];
  for (const { row, flags } of flagged) {
    const existing = Array.isArray(row.validation_flags) ? (row.validation_flags as string[]) : [];
    const merged = [...new Set([...existing, ...flags, "identity_backfill"])];
    const { error } = await db
      .from("company_financials")
      .update({ review_status: "needs_review", validation_flags: merged })
      .eq("id", row.id);
    if (error) errors.push(`${row.ticker} ${row.id}: ${error.message}`);
    else updated++;
  }
  console.log(`Done. Downgraded ${updated} rows${errors.length ? `; ${errors.length} errors` : ""}.`);
  if (errors.length) console.log(errors.slice(0, 20).join("\n"));

  // Recompute ratios for affected tickers so the bad rows stop feeding them now.
  const { refreshRatios } = await import("@/lib/engine/ratios");
  const affected = [...byTicker];
  console.log(`\nRecomputing ratios for ${affected.length} affected tickers...`);
  let recomputed = 0;
  for (const t of affected) {
    const r = await refreshRatios(db, t).catch(() => null);
    if (r) recomputed++;
  }
  console.log(`Recomputed ${recomputed}/${affected.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
