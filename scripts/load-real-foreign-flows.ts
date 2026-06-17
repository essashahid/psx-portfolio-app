import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { ingestForeignFlows, type FlowIngestPayload } from "@/lib/market/foreign-flows-ingest";

/**
 * Load a real PSX FIPI day, replacing any prior (sample) rows.
 *
 * Source: Mettis Global "Hot money bolts PSX with $4.4m exit" (NCCPL-derived),
 * trading session 2026-03-02. The per-sector net flows reconcile to the −$4.43m
 * headline (Σ = −4.42m), so they are loaded as-is. The article's LIPI
 * participant figures did not reconcile (an obviously mangled mutual-fund line),
 * so they are intentionally omitted rather than stored as bad data.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/load-real-foreign-flows.ts
 */
config({ path: resolve(process.cwd(), ".env.local") });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const REAL_DAY: FlowIngestPayload = {
  date: "2026-03-02",
  currency: "USD",
  fipi: { net: -4.43, grossBuy: null, grossSell: null },
  sectors: [
    { sector: "Cement", net: -2.94 },
    { sector: "Commercial Banks", net: -1.43 },
    { sector: "Power Generation & Distribution", net: -0.59 },
    { sector: "Technology & Communication", net: -0.43 },
    { sector: "Oil & Gas Marketing Companies", net: 0.2 },
    { sector: "Textile Composite", net: 0.1 },
    { sector: "Oil & Gas Exploration Companies", net: 0.06 },
    { sector: "Food & Personal Care Products", net: 0.03 },
    { sector: "Fertilizer", net: 0.37 },
    { sector: "Other", net: 0.21 },
  ],
  sourceProvider: "nccpl",
  sourceUrl: "https://mettisglobal.news/Hot-money-bolts-PSX-with-44m-exit-58784",
  note: "Real NCCPL FIPI session (2026-03-02), via Mettis Global. Foreign net sell $4.43m amid war-fear risk-off.",
};

async function main() {
  // Clear prior (sample) rows so the real day is the source of truth.
  for (const t of ["foreign_flow_sectors", "local_flow_participants", "foreign_flow_days"]) {
    const { error } = await admin.from(t).delete().eq("market", "PSX");
    if (error) throw new Error(`clear ${t}: ${error.message}`);
    console.log(`cleared ${t}`);
  }

  const r = await ingestForeignFlows(admin, REAL_DAY, { ingestedBy: "auto" });
  console.log(`loaded real day ${r.date}: net ${r.fipiNet}, ${r.sectors} sectors`);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
