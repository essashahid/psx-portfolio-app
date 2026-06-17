import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { ingestForeignFlows, type FlowIngestPayload } from "@/lib/market/foreign-flows-ingest";

/**
 * Seed a realistic week of FIPI / LIPI flows (illustrative, in USD millions) so
 * the Market Pulse card, Bulls & Bears overlay, and Copilot tool have data to
 * render. Idempotent — re-running overwrites the same dates. NOT live data.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/seed-foreign-flows.ts
 */
config({ path: resolve(process.cwd(), ".env.local") });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

// Prior days — just the headline net, enough to draw the cumulative tide.
const SERIES: { date: string; net: number; buy: number; sell: number }[] = [
  { date: "2026-06-10", net: -1.8, buy: 16.2, sell: 18.0 },
  { date: "2026-06-11", net: 2.4, buy: 19.7, sell: 17.3 },
  { date: "2026-06-12", net: 0.9, buy: 15.1, sell: 14.2 },
  { date: "2026-06-13", net: -3.1, buy: 12.8, sell: 15.9 },
  { date: "2026-06-16", net: 4.6, buy: 22.0, sell: 17.4 },
];

// Latest day — full sector + local-participant breakdown.
const LATEST: FlowIngestPayload = {
  date: "2026-06-17",
  currency: "USD",
  fipi: { net: 6.2, grossBuy: 24.6, grossSell: 18.4 },
  sectors: [
    { sector: "Commercial Banks", net: 3.8 },
    { sector: "Oil & Gas Exploration Companies", net: 1.9 },
    { sector: "Technology & Communication", net: 1.4 },
    { sector: "Fertilizer", net: 0.6 },
    { sector: "Power Generation & Distribution", net: 0.3 },
    { sector: "Cement", net: -0.9 },
    { sector: "Food & Personal Care Products", net: -0.5 },
    { sector: "Textile Composite", net: -0.4 },
  ],
  participants: [
    { category: "individuals", label: "Individuals", net: -7.5 },
    { category: "mutual_funds", label: "Mutual Funds", net: 2.1 },
    { category: "companies", label: "Companies", net: 1.8 },
    { category: "insurance", label: "Insurance", net: -1.4 },
    { category: "brokers", label: "Broker Proprietary", net: -0.9 },
    { category: "banks_dfi", label: "Banks / DFI", net: -0.6 },
    { category: "other_organizations", label: "Other Organizations", net: 0.3 },
  ],
  sourceProvider: "manual",
  note: "Illustrative sample data — not live NCCPL figures.",
};

async function main() {
  for (const d of SERIES) {
    const r = await ingestForeignFlows(
      admin,
      {
        date: d.date,
        currency: "USD",
        fipi: { net: d.net, grossBuy: d.buy, grossSell: d.sell },
        sourceProvider: "manual",
        note: "Illustrative sample data — not live NCCPL figures.",
      },
      { ingestedBy: "manual" }
    );
    console.log(`seeded ${r.date}: net ${r.fipiNet}`);
  }
  const last = await ingestForeignFlows(admin, LATEST, { ingestedBy: "manual" });
  console.log(`seeded ${last.date}: net ${last.fipiNet}, ${last.sectors} sectors, ${last.participants} participants`);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
