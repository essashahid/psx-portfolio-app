import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { computeSignals, findSwings, detectSupportResistanceZones, swingThresholdFor } from "@/lib/market/technicals";

config({ path: resolve(process.cwd(), ".env.local") });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: all } = await db.from("company_technicals").select("ticker, data");
  if (!all) return;
  const usable = all.filter(r => ((r.data as any)?.history ?? []).length > 260);
  const picks = [0, 1, 2, 3].map(i => usable[Math.floor((i + 1) * usable.length / 5)]);

  // aggregate across the whole universe
  let totalOld = 0, totalNew = 0, totalZonesOld = 0, totalZonesNew = 0, n = 0;
  let worstDistOld = 0, worstDistNew = 0;
  for (const r of usable) {
    const h = (r.data as any).history;
    const price = h[h.length - 1].close;
    const oldSw = findSwings(h, 8);
    const newSw = findSwings(h);
    totalOld += oldSw.length; totalNew += newSw.length; n++;
    const zNew = detectSupportResistanceZones(h, newSw, price);
    totalZonesNew += zNew.length;
    for (const z of zNew) {
      const c = (z.low + z.high) / 2;
      worstDistNew = Math.max(worstDistNew, Math.abs((c - price) / price) * 100);
    }
  }
  console.log(`universe (${n} stocks with >260 candles)`);
  console.log(`  avg swings  old: ${(totalOld / n).toFixed(1)}  new: ${(totalNew / n).toFixed(1)}`);
  console.log(`  avg zones   new: ${(totalZonesNew / n).toFixed(1)}`);
  console.log(`  worst zone distance from price, new: ${worstDistNew.toFixed(1)}%`);

  for (const row of picks) {
    const hist = (row.data as any).history;
    const price = hist[hist.length - 1].close;
    const oldSwings = findSwings(hist, 8);
    const newSwings = findSwings(hist);
    const s = computeSignals(hist);
    const zones = detectSupportResistanceZones(hist, newSwings, price);

    console.log("\n" + "=".repeat(60));
    console.log(`${row.ticker}  price ${price}  candles ${hist.length}`);
    console.log(`  threshold: ${swingThresholdFor(hist).toFixed(1)}%  swings ${oldSwings.length} -> ${newSwings.length}`);
    console.log(`  trend: ${s.longTermTrend}  divergences: ${s.divergences.length}`);
    console.log(`  zones: ${zones.length}`);
    for (const z of zones) {
      const c = (z.low + z.high) / 2;
      const d = ((c - price) / price) * 100;
      console.log(`    ${z.kind.padEnd(10)} ${z.low.toFixed(2)}-${z.high.toFixed(2)}  ${d >= 0 ? "+" : ""}${d.toFixed(1)}%  ${z.touches}x  ${z.confidence}  last ${z.lastTested}`);
    }
    console.log(`  accumulation: ${s.accumulation?.status} zone ${s.accumulation?.zoneLow}-${s.accumulation?.zoneHigh} support ${s.accumulation?.majorSupport}`);
  }
}

main();
