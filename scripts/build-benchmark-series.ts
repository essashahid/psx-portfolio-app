// Builds the dashboard "growth of invested capital" benchmark series.
//
// Reconstructs the portfolio's monthly market value from the AKD ledger plus
// the four non-ledger corporate actions, values it against real PSX EOD price
// history (KSE-100 and each ticker), and compares it to a KSE-100 total-return
// equivalent and a PBS-CPI inflation equivalent of the same contribution stream.
//
// Dry run (parse + fetch + validate, no DB write):
//   npx tsx scripts/build-benchmark-series.ts ./COAF5632.PDF
// Persist for a user:
//   npx tsx scripts/build-benchmark-series.ts ./COAF5632.PDF --write --email=you@example.com

import { readFileSync } from "fs";
import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { parseAkdStatement, type AkdStatement } from "@/lib/import/akd-statement";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";
import {
  buildBenchmarkSeries,
  type Contribution,
  type ShareEvent,
  type ClosePoint,
} from "@/lib/engine/benchmark-growth";

config({ path: resolve(process.cwd(), ".env.local") });

const KSE_SYMBOL = "KSE100";
const UBL_SPLIT_DATE = "2025-06-20"; // 2-for-1; DPS prices are split-adjusted
const UBL_SPLIT_FACTOR = 2;

// Non-ledger corporate actions supplied with the statement. Expressed so the
// reconstruction reconciles to the closing Inventory Position.
const EXTERNAL_CONTRIBUTIONS: Contribution[] = [
  { date: "2025-09-23", amount: 15000 }, // IREIT IPO allotment, funded outside AKD
  { date: "2026-06-15", amount: 19950 }, // SLM external acquisition
];
const EXTERNAL_SHARE_EVENTS: ShareEvent[] = [
  { date: "2025-09-23", ticker: "IREIT", qtyDelta: 1500 },
  { date: "2026-06-15", ticker: "SLM", qtyDelta: 1000 },
];
// FFBL -> FFC merger: 100 FFBL convert to 23 FFC (1 FFC per 4.29 FFBL), cost
// transferred. Modelled by remapping FFBL buys into FFC at that ratio so the
// position lives as FFC (continuously priced) instead of the delisted FFBL.
const FFBL_TO_FFC_RATIO = 23 / 100;
// IREIT listed on PSX on 2025-10-06; value the allotment at par until then.
const IREIT_PAR: ClosePoint = { date: "2025-09-23", close: 10 };

async function extractText(path: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const buffer = readFileSync(path);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text ?? "";
}

/** Map the parsed ledger + corporate actions into engine inputs. */
function toEngineInputs(stmt: AkdStatement, asOf: string) {
  // Contributions: AKD cash deposits + external acquisitions.
  const contributions: Contribution[] = [
    ...stmt.deposits
      .filter((d) => d.date)
      .map((d) => ({ date: d.date as string, amount: d.amount })),
    ...EXTERNAL_CONTRIBUTIONS,
  ];

  // Share events in current (split-adjusted) units.
  const shareEvents: ShareEvent[] = [];
  for (const t of stmt.trades) {
    if (!t.date) continue;
    const sign = t.side === "BUY" ? 1 : -1;
    if (t.ticker === "FFBL") {
      shareEvents.push({ date: t.date, ticker: "FFC", qtyDelta: sign * t.quantity * FFBL_TO_FFC_RATIO });
      continue;
    }
    let qty = t.quantity;
    if (t.ticker === "UBL" && t.date < UBL_SPLIT_DATE) qty *= UBL_SPLIT_FACTOR;
    shareEvents.push({ date: t.date, ticker: t.ticker, qtyDelta: sign * qty });
  }
  shareEvents.push(...EXTERNAL_SHARE_EVENTS);

  // Broker cash on hand after each dated ledger line (balance is printed as a
  // credit, i.e. negative, when the broker owes the client).
  const cashSeries: ClosePoint[] = stmt.entries
    .filter((e) => e.date)
    .map((e) => ({ date: e.date as string, close: Math.max(0, -e.balance) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { contributions, shareEvents, cashSeries, asOf };
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Pass the path to an AKD statement PDF.");
    process.exit(2);
  }
  const write = process.argv.includes("--write");
  const emailArg = process.argv.find((a) => a.startsWith("--email="))?.split("=")[1];

  const stmt = parseAkdStatement(await extractText(path));
  if (!stmt) {
    console.error("Not an AKD Statement Of Account.");
    process.exit(1);
  }

  const tradeTickers = [...new Set(stmt.trades.map((t) => (t.ticker === "FFBL" ? "FFC" : t.ticker)))];
  const heldTickers = [...new Set([...tradeTickers, "IREIT", "SLM"])];

  console.log(`Fetching PSX EOD history for ${KSE_SYMBOL} + ${heldTickers.length} tickers...`);
  const kse100 = (await fetchPsxEod(KSE_SYMBOL)).map((c) => ({ date: c.date, close: c.close }));
  if (kse100.length === 0) throw new Error("No KSE-100 history from PSX DPS.");

  const priceSeries = new Map<string, ClosePoint[]>();
  for (const ticker of heldTickers) {
    const eod = await fetchPsxEod(ticker);
    let series: ClosePoint[] = eod.map((c) => ({ date: c.date, close: c.close }));
    if (ticker === "IREIT") series = [IREIT_PAR, ...series].sort((a, b) => a.date.localeCompare(b.date));
    priceSeries.set(ticker, series);
    if (series.length === 0) console.warn(`  ! no price history for ${ticker}`);
  }

  // Value at the most recent date present across the data.
  const lastDates = [kse100.at(-1)!.date, ...[...priceSeries.values()].map((s) => s.at(-1)?.date ?? "")];
  const asOf = lastDates.filter(Boolean).sort().at(-1)!;

  const inputs = { ...toEngineInputs(stmt, asOf), priceSeries, kse100 };
  const series = buildBenchmarkSeries(inputs);

  // ---- Validation against the closing Inventory Position ----
  const finalQty = new Map<string, number>();
  for (const e of inputs.shareEvents) finalQty.set(e.ticker, (finalQty.get(e.ticker) ?? 0) + e.qtyDelta);
  console.log("\n=== Reconciliation: reconstructed qty vs statement inventory ===");
  let qtyOk = true;
  for (const inv of stmt.inventory) {
    const got = Math.round(finalQty.get(inv.ticker) ?? 0);
    const flag = got === inv.quantity ? "ok" : "MISMATCH";
    if (got !== inv.quantity) qtyOk = false;
    console.log(`  ${inv.ticker.padEnd(8)} reconstructed ${String(got).padStart(6)}  inventory ${String(inv.quantity).padStart(6)}  ${flag}`);
  }

  const last = series.at(-1)!;
  const invValue = stmt.inventory.reduce((s, i) => s + i.amount, 0);
  const cash = inputs.cashSeries.at(-1)?.close ?? 0;
  console.log(`\n=== Totals (as of ${asOf}) ===`);
  console.log(`  Contributed (AKD deposits + external) : ${fmt(last.contributed)}`);
  console.log(`  Reconstructed portfolio (EOD closes)  : ${fmt(last.portfolio)}`);
  console.log(`  Statement net worth (inv + cash)      : ${fmt(invValue + cash)}  (inv ${fmt(invValue)} + cash ${fmt(cash)})`);
  console.log(`  KSE-100 equivalent                    : ${fmt(last.kse100)}`);
  console.log(`  Inflation-protected equivalent        : ${fmt(last.inflation)}`);
  console.log(`  Points: ${series.length} (monthly ${series[0].date} -> ${last.date})`);

  if (!qtyOk) console.warn("\n! Quantity reconciliation has mismatches — review corporate-action config before --write.");

  if (!write) {
    console.log("\nDry run only. Re-run with --write --email=<user> to persist.");
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  let userId: string | null = null;
  if (emailArg) {
    const { data } = await supabase.auth.admin.listUsers();
    userId = data.users.find((u) => u.email?.toLowerCase() === emailArg.toLowerCase())?.id ?? null;
  } else {
    const { data } = await supabase.from("holdings").select("user_id").limit(1).maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) throw new Error("Could not resolve a user_id (pass --email=).");

  await supabase.from("benchmark_series").delete().eq("user_id", userId);
  const rows = series.map((p) => ({
    user_id: userId,
    point_date: p.date,
    contributed: p.contributed,
    portfolio: p.portfolio,
    kse100: p.kse100,
    inflation: p.inflation,
    cpi: p.cpi,
  }));
  const { error } = await supabase.from("benchmark_series").upsert(rows, { onConflict: "user_id,point_date" });
  if (error) throw error;
  console.log(`\nWrote ${rows.length} benchmark points for user ${userId}.`);
}

const fmt = (n: number) => "PKR " + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
