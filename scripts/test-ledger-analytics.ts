// Runs the ledger analytics engine on an AKD statement PDF and prints a report.
// Usage: npx tsx scripts/test-ledger-analytics.ts /path/to/COAF5632.PDF

import { readFileSync } from "fs";
import { parseAkdStatement } from "@/lib/import/akd-statement";
import { analyzeLedger } from "@/lib/engine/ledger-analytics";

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

async function extractText(path: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const buffer = readFileSync(path);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text ?? "";
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Pass the path to an AKD statement PDF.");
    process.exit(2);
  }
  const stmt = parseAkdStatement(await extractText(path));
  if (!stmt) {
    console.error("Not an AKD Statement Of Account.");
    process.exit(1);
  }
  const a = analyzeLedger(stmt);
  const r = a.returns;

  console.log("===== RETURNS =====");
  console.log("Total deposited      ", fmt(r.totalDeposited));
  console.log("Net worth            ", fmt(r.netWorth), `(market ${fmt(r.marketValue)} + cash ${fmt(r.cashBalance)})`);
  console.log("Total gain           ", fmt(r.totalGain), `(${fmt(r.totalReturnPct)}% on capital)`);
  console.log("Money-weighted XIRR  ", r.xirrPct === null ? "-" : r.xirrPct + "% / yr", `over ${r.holdingPeriodYears} yrs`);
  console.log("Realized P/L         ", fmt(r.realizedPl));
  console.log("Unrealized P/L       ", fmt(r.unrealizedPl));
  console.log("Total friction paid  ", fmt(r.totalFriction));

  console.log("\n===== COST BASIS (current holdings) =====");
  console.log("TICKER   QTY     AVG     PRICE   MKT VALUE    UNREAL    UNREAL%  BREAKEVEN  IF SOLD TODAY  WT%");
  for (const c of a.costBasis) {
    console.log(
      c.ticker.padEnd(8),
      String(c.quantity).padStart(5),
      fmt(c.avgCost).padStart(7),
      fmt(c.currentPrice).padStart(7),
      fmt(c.marketValue).padStart(11),
      fmt(c.unrealizedPl).padStart(9),
      (c.unrealizedPlPct === null ? "-" : c.unrealizedPlPct + "%").padStart(8),
      fmt(c.breakEvenPrice).padStart(9),
      fmt(c.profitIfSoldToday).padStart(13),
      (c.weightPct === null ? "-" : c.weightPct + "%").padStart(6)
    );
  }

  console.log("\n===== FRICTION AUTOPSY =====");
  const f = a.friction;
  console.log(`commission ${fmt(f.commission)}  SST ${fmt(f.sst)}  CDC ${fmt(f.cdc)}  CGT ${fmt(f.cgt)}  account fees ${fmt(f.accountFees)}`);
  console.log(`total friction ${fmt(f.total)}  = ${fmt(f.pctOfDeposits)}% of deposits, ${f.pctOfGains === null ? "-" : fmt(f.pctOfGains) + "% of gains"}`);
  console.log("by trade size:");
  for (const b of f.bySize) console.log(`  ${b.bucket.padEnd(14)} ${String(b.trades).padStart(3)} trades  avg gross ${fmt(b.avgGross).padStart(10)}  avg fee ${b.avgFeePct}%`);

  console.log("\n===== BY YEAR =====");
  console.log("YEAR  DEPOSITS      BUYS         SELLS       REALIZED    FRICTION   TRADES");
  for (const y of a.byYear) {
    console.log(
      y.year.padEnd(5),
      fmt(y.deposits).padStart(11),
      fmt(y.buys).padStart(12),
      fmt(y.sells).padStart(11),
      fmt(y.realizedPl).padStart(11),
      fmt(y.friction).padStart(10),
      String(y.tradeCount).padStart(6)
    );
  }

  console.log("\n===== CAPITAL DEPLOYMENT =====");
  const d = a.deployment;
  console.log(`avg ${d.avgDaysDepositToBuy} days deposit->buy, median ${d.medianDaysDepositToBuy} days`);
  console.log(`${d.buysWithin24h}/${d.buysTotal} buys within 24h of a deposit (${d.pctDeployedWithin24h}%)`);

  console.log("\n===== CONCENTRATION =====");
  const cc = a.concentration;
  console.log(`top holding ${cc.topHolding?.ticker} ${cc.topHolding?.weightPct}%  |  top-2 banks ${cc.top2BanksWeightPct}%  |  HHI ${cc.hhi}`);
  console.log(`sub-1% positions ${cc.positionsBelow1pct}, sub-3% ${cc.positionsBelow3pct} (combined ${cc.smallTailWeightPct}% of value)`);
  if (cc.topTwoShock) console.log(`an ${cc.topTwoShock.dropPct}% drop in your top 2 = ${cc.topTwoShock.portfolioImpactPct}% of total portfolio`);
  console.log("sectors:", cc.sectorWeights.map((s) => `${s.sector} ${s.weightPct}%`).join(" | "));

  // Cross-check against the statement's own net worth.
  const expectedNet = (stmt.controls.inventoryValue ?? 0) + (stmt.controls.ledgerBalance ?? 0);
  const diff = Math.abs(r.netWorth - expectedNet);
  console.log(`\nNet worth check: engine ${fmt(r.netWorth)} vs statement ${fmt(expectedNet)} -> ${diff < 1 ? "MATCH" : "MISMATCH (" + diff + ")"}`);
  if (diff >= 1) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
