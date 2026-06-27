// End-to-end sanity check for the allocation quant core on live data, with no
// DB dependency: fetch KSE-100 (PSX) + gold/BTC/USD-PKR (Twelve Data), build the
// real-PKR monthly return matrix, estimate the return model, optimise, and stress
// the recommended mix against the 60-20-20 benchmark.
//
//   TWELVE_DATA_API_KEY=... npx tsx scripts/allocation-sanity.ts

import { config } from "dotenv";
import { resolve } from "path";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";
import { buildMacroAssetRows, tbillYieldOn } from "@/lib/market-data/macro-assets";
import { buildMonthlyReturns, type DailyPoint } from "@/lib/engine/allocation/data";
import { buildReturnModel } from "@/lib/engine/allocation/returns";
import { optimizeAllocation, evaluateMix, riskParityMix } from "@/lib/engine/allocation/optimizer";
import { stressMix } from "@/lib/engine/allocation/stress";
import { ASSET_CLASSES, ASSET_LABEL, type Allocation } from "@/lib/engine/allocation/types";
import { BENCHMARK_60_20_20, OBJECTIVE_LABEL } from "@/lib/engine/allocation/objective";
import { buildForecast } from "@/lib/engine/allocation";
import { monthlyCloses, type DailyPoint as DP } from "@/lib/engine/allocation/data";

config({ path: resolve(process.cwd(), ".env.local") });
if (!process.env.TWELVE_DATA_API_KEY && process.env.TWELVE_DATA_API) {
  process.env.TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const wfmt = (w: Allocation) => ASSET_CLASSES.map((a) => `${ASSET_LABEL[a]} ${pct(w[a])}`).join(", ");

async function main() {
  console.log("Fetching KSE-100 (PSX) + gold/BTC/USD-PKR (Twelve Data)...");
  const [kse, macro] = await Promise.all([fetchPsxEod("KSE100"), buildMacroAssetRows()]);

  const pkrLevels = (asset: "GOLD" | "BTC"): DailyPoint[] =>
    macro.rows
      .filter((r) => r.asset === asset && r.close_pkr != null)
      .map((r) => ({ date: r.asof_date, value: Number(r.close_pkr) }));

  const equityLevels: DailyPoint[] = kse.map((c) => ({ date: c.date, value: c.close }));
  console.log(
    `  KSE-100 ${equityLevels.length} days, gold ${pkrLevels("GOLD").length}, BTC ${pkrLevels("BTC").length}`
  );

  const series = buildMonthlyReturns({
    equityLevels,
    goldLevels: pkrLevels("GOLD"),
    btcLevels: pkrLevels("BTC"),
    tbillYieldPct: (m) => tbillYieldOn(`${m}-15`),
  });
  console.log(`\nAligned monthly real-PKR returns: ${series.length} months (${series[0]?.month} -> ${series.at(-1)?.month})`);

  const model = buildReturnModel(series);
  console.log(`\nObjective: ${OBJECTIVE_LABEL}\n`);
  console.log("=== Conservative annualised real-return estimates ===");
  for (const a of ASSET_CLASSES) {
    const e = model.estimates[a];
    console.log(
      `  ${ASSET_LABEL[a].padEnd(15)} exp ${pct(e.expReturn).padStart(7)}  band [${pct(e.expReturnLow)}, ${pct(e.expReturnHigh)}]  vol ${pct(e.volatility)}`
    );
  }

  console.log("\n=== Correlation matrix ===");
  console.log("            " + ASSET_CLASSES.map((a) => a.padStart(8)).join(""));
  ASSET_CLASSES.forEach((ai, i) => {
    const row = ASSET_CLASSES.map((aj, j) => {
      const corr = model.covariance[i][j] / Math.sqrt(model.covariance[i][i] * model.covariance[j][j]);
      return corr.toFixed(2).padStart(8);
    }).join("");
    console.log(`  ${ai.padEnd(10)}${row}`);
  });

  const rec = optimizeAllocation(model, { current: null });
  console.log("\n=== Recommended mix (no regime tilt) ===");
  console.log(`  ${wfmt(rec.allocation)}`);
  console.log(
    `  exp ${pct(rec.expReturn)} [${pct(rec.expReturnLow)}, ${pct(rec.expReturnHigh)}]  vol ${pct(rec.volatility)}  est drawdown ${pct(rec.estDrawdown)}  P(loss 5y) ${pct(rec.probLoss)}`
  );

  const bench = evaluateMix(model, BENCHMARK_60_20_20);
  console.log("\n=== 60-20-20 benchmark ===");
  console.log(`  ${wfmt(BENCHMARK_60_20_20)}`);
  console.log(`  exp ${pct(bench.expReturn)}  vol ${pct(bench.volatility)}  est drawdown ${pct(bench.estDrawdown)}  P(loss 5y) ${pct(bench.probLoss)}`);
  console.log(`\n  Risk-parity reference: ${wfmt(riskParityMix(model))}`);

  console.log("\n=== Stress test (real-PKR shock return) ===");
  const rs = stressMix(rec.allocation);
  const bs = stressMix(BENCHMARK_60_20_20);
  rs.forEach((r, i) => console.log(`  ${r.label.padEnd(22)} recommended ${pct(r.mixReturn).padStart(8)}   60-20-20 ${pct(bs[i].mixReturn).padStart(8)}`));

  // --- Full forecast (regimes + backtest + confidence + recommendation) ---
  const usdpkr: DP[] = macro.rows
    .filter((r) => r.asset === "USDPKR")
    .map((r) => ({ date: r.asof_date, value: Number(r.close_native) }));

  const forecast = buildForecast({
    series,
    signalInputs: { usdpkr, tbillYieldPct: tbillYieldOn(new Date().toISOString().slice(0, 10)), foreignFlowBias: null, newsCounts: null },
    dataQuality: { equity: "good", gold: "good", btc: "good", inflationAssumedBefore: "2023-01" },
    monthsByAsset: { equity: monthlyCloses(equityLevels).size, gold: pkrLevels("GOLD").length, btc: monthlyCloses(pkrLevels("BTC")).size },
    assetFirstMonths: { equity: series[0]?.month ?? null, gold: series[0]?.month ?? null, btc: series[0]?.month ?? null },
    current: null,
    portfolioValuePkr: 1_000_000,
    investableCashPkr: 500_000,
  });

  console.log("\n=== Scenarios (regime probabilities) ===");
  let probSum = 0;
  for (const s of forecast.scenarios) {
    probSum += s.probability;
    console.log(`  ${s.label.padEnd(26)} P(regime) ${pct(s.probability).padStart(6)}  -> ${wfmt(s.mix.allocation)}`);
  }
  console.log(`  probability sum: ${pct(probSum)} (must be 100.0%)`);

  console.log("\n=== Confidence ===");
  console.log(`  overall: ${forecast.confidence.overall}`);
  for (const c of forecast.confidence.components) console.log(`   - ${c.label.padEnd(22)} ${c.level.padEnd(12)} ${c.detail}`);

  console.log("\n=== Backtest layers (own evidence windows) ===");
  for (const L of [forecast.backtest.core, forecast.backtest.fullUniverse, forecast.backtest.signalOverlap]) {
    console.log(`   - ${L.label.padEnd(38)} ${L.firstMonth} -> ${L.lastMonth}  (${L.observations} obs)`);
  }
  console.log("  strategy           annRet   annVol   maxDD   hit");
  for (const st of forecast.backtest.strategies) {
    console.log(`   ${st.name.padEnd(24)} ${pct(st.annReturn).padStart(7)} ${pct(st.annVol).padStart(7)} ${pct(st.maxDrawdown).padStart(7)} ${pct(st.hitRate).padStart(6)}`);
  }
  console.log(`  enhanced overlay adds value: ${forecast.backtest.enhancedAddsValue} (Δreturn ${pct(forecast.backtest.enhancedVsCoreReturn)})`);

  console.log("\n=== Recommendation ===");
  if (forecast.recommendation.withheld) {
    console.log(`  WITHHELD: ${forecast.recommendation.withheldReason}`);
  } else {
    console.log(`  lead regime: ${forecast.recommendation.label}`);
    console.log(`  deploy first into: ${ASSET_LABEL[forecast.recommendation.deployFirst!]}`);
    for (const d of forecast.recommendation.deployment ?? []) {
      console.log(`   - ${d.label.padEnd(15)} target ${pct(d.targetWeight).padStart(6)}  buy PKR ${Math.round(d.buyPkr).toLocaleString()}`);
    }
  }

  // --- Narration (explanatory LLM + numeric guard) ---
  const { narrateForecast } = await import("@/lib/engine/allocation/narrate");
  const narrative = await narrateForecast(forecast);
  console.log(`\n=== Narrative (model: ${narrative.model}) ===`);
  console.log("  " + narrative.summary);
  console.log("  REC: " + narrative.recommendationNote);

  // --- Low-confidence / refuse-to-recommend path ---
  const shortForecast = buildForecast({
    series: series.slice(-12),
    signalInputs: { usdpkr, tbillYieldPct: tbillYieldOn(new Date().toISOString().slice(0, 10)), foreignFlowBias: null, newsCounts: null },
    dataQuality: { equity: "good", gold: "good", btc: "good", inflationAssumedBefore: "2023-01" },
    monthsByAsset: { equity: 12, gold: 12, btc: 12 },
    assetFirstMonths: { equity: null, gold: null, btc: null },
    current: null,
  });
  console.log("\n=== Refuse-to-recommend check (12-month series) ===");
  console.log(`  overall confidence: ${shortForecast.confidence.overall}`);
  console.log(`  recommendation withheld: ${shortForecast.recommendation.withheld} -> ${shortForecast.recommendation.withheldReason ?? "n/a"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
