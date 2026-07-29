/**
 * Finds and removes fills recorded twice under different sources.
 *
 * A statement import dates a trade by settlement while a confirmation dates it
 * by execution, so the same fill can land twice with different dates. This
 * script pairs a confirmation row with a legacy row (import / manual /
 * adjustment) of the same ticker, side and quantity at nearly the same price
 * within a settlement-sized window, and drops the legacy copy: the confirmation
 * carries the true execution date and the exact charge split.
 *
 *   npx tsx scripts/maintenance/dedupe-cross-source-trades.ts            # dry run
 *   npx tsx scripts/maintenance/dedupe-cross-source-trades.ts --apply
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const WINDOW_DAYS = 10;
const LEGACY_SOURCES = new Set(["import", "manual", "adjustment"]);

interface Row {
  id: string;
  trade_date: string | null;
  ticker: string;
  type: string;
  quantity: number | null;
  price: number | null;
  net_amount: number | null;
  source: string;
}

const daysApart = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000;

async function main() {
  const userId = process.env.EMAIL_INGEST_USER_ID;
  if (!userId) throw new Error("EMAIL_INGEST_USER_ID missing");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await s
    .from("transactions")
    .select("id, trade_date, ticker, type, quantity, price, net_amount, source")
    .eq("user_id", userId)
    .order("trade_date");
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const confirmations = rows.filter((r) => r.source === "email_confirmation");
  const legacy = rows.filter((r) => LEGACY_SOURCES.has(r.source));
  const claimed = new Set<string>();
  const pairs: { keep: Row; drop: Row; gapDays: number }[] = [];

  for (const c of confirmations) {
    if (!c.trade_date) continue;
    const match = legacy
      .filter(
        (l) =>
          !claimed.has(l.id) &&
          l.ticker === c.ticker &&
          l.type === c.type &&
          Number(l.quantity) === Number(c.quantity) &&
          l.price !== null &&
          c.price !== null &&
          Math.abs(Number(l.price) - Number(c.price)) <= Math.max(0.05, Number(c.price) * 0.01) &&
          l.trade_date !== null &&
          daysApart(l.trade_date, c.trade_date!) <= WINDOW_DAYS
      )
      .sort((a, b) => daysApart(a.trade_date!, c.trade_date!) - daysApart(b.trade_date!, c.trade_date!))[0];
    if (!match) continue;
    claimed.add(match.id);
    pairs.push({ keep: c, drop: match, gapDays: daysApart(match.trade_date!, c.trade_date!) });
  }

  console.log(`${pairs.length} duplicate pair(s) found:`);
  for (const p of pairs) {
    console.log(
      `  ${p.keep.ticker} ${p.keep.type} ${p.keep.quantity} @ ${p.keep.price}` +
        `\n      keep  ${p.keep.trade_date} [${p.keep.source}] net ${p.keep.net_amount}` +
        `\n      drop  ${p.drop.trade_date} [${p.drop.source}] net ${p.drop.net_amount}  (${p.gapDays}d apart)`
    );
  }
  if (!pairs.length) return;

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to delete the legacy copies.");
    return;
  }

  for (const p of pairs) {
    const { error: delErr } = await s
      .from("transactions")
      .delete()
      .eq("id", p.drop.id)
      .eq("user_id", userId);
    if (delErr) throw delErr;
  }
  const { recomputeHoldingsFromTransactions } = await import("../../lib/portfolio/positions");
  await recomputeHoldingsFromTransactions(s, userId);
  console.log(`\nDeleted ${pairs.length} duplicate row(s). Holdings recomputed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
