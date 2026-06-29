// Backfills holdings for shahid@crescentcotton.com from two custody sources:
//
//   1. CDC Investor Account (IAS 03277, Acc 10478) — balance as at 31/05/2026
//      93 positions loaded as ADJUST rows; cost basis unknown.
//
//   2. First Equity Modaraba broker sub-account (Client 001321, Sub A/C #3033)
//      — Securities Balance Summary as at 29/06/2026
//      12 positions; 8 new tickers + 4 tickers also in CDC (additive qty).
//
// Both sets are ADJUST rows with price=0 / net_amount=0 (snapshots only;
// no purchase history available). Holdings recompute aggregates them per ticker.
// Hash prefixes are per-source so each set is independently idempotent.
//
//   npx tsx scripts/backfill-shahid-ledger.ts          # dry run
//   npx tsx scripts/backfill-shahid-ledger.ts --write   # persist

import { config } from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recomputeHoldingsFromTransactions } from "@/lib/portfolio";

config({ path: resolve(process.cwd(), ".env.local") });

const EMAIL = "shahid@crescentcotton.com";
const CDC_PREFIX = "shahid-cdc-10478";
const FEM_PREFIX  = "shahid-fem-3033";
const CDC_DATE = "2026-05-31";
const FEM_DATE = "2026-06-29";

type Position = { ticker: string; company_name: string; qty: number };

// Transcribed from CDC Account Balance Report (IAS-KHI, 01/06/2026 03:58:03).
// HIFB omitted — position_owned = 0 (71 pending in, not yet settled).
// Securities marked FREEZE are included at their owned quantity.
const POSITIONS: Position[] = [
  // Page 1
  { ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    qty: 125 },
  { ticker: "AATM",    company_name: "ALI ASGHAR TEXTILE MILLS LIMITED",                qty: 125 },
  { ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             qty: 44 },
  { ticker: "AIRLINK", company_name: "AIR LINK COMMUNICATION LIMITED",                  qty: 537 },
  { ticker: "AKBL",    company_name: "ASKARI BANK LIMITED",                             qty: 54 },
  { ticker: "ALNRS",   company_name: "AL-NOOR SUGAR MILLS LIMITED",                     qty: 106 },
  { ticker: "ANL",     company_name: "AZGARD NINE LIMITED",                             qty: 150 },
  { ticker: "ANTM",    company_name: "AN TEXTILE MILLS LIMITED",                        qty: 50 },
  { ticker: "ASTL",    company_name: "AMRELI STEELS LIMITED",                           qty: 625 },
  // Page 2
  { ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            qty: 62 },
  { ticker: "BAFS",    company_name: "BABA FARID SUGAR MILLS LIMITED",                  qty: 2950 },
  { ticker: "BECO",    company_name: "BECO STEEL LIMITED",                              qty: 250 },
  { ticker: "BIPL",    company_name: "BANKISLAMI PAKISTAN LIMITED",                     qty: 4593 },
  { ticker: "BML",     company_name: "BANK MAKRAMAH LIMITED",                           qty: 49 },
  { ticker: "BOK",     company_name: "THE BANK OF KHYBER",                              qty: 4732 },
  { ticker: "BOP",     company_name: "THE BANK OF PUNJAB",                              qty: 30 },
  { ticker: "CCM",     company_name: "CRESCENT COTTON MILLS LIMITED",                   qty: 640147 },
  { ticker: "CHAS",    company_name: "CHASHMA SUGAR MILLS LIMITED",                     qty: 500 },
  { ticker: "CHBL",    company_name: "CHENAB LIMITED",                                  qty: 250 },
  { ticker: "CTM",     company_name: "COLONY TEXTILE MILLS LIMITED",                    qty: 250 },
  { ticker: "DCL",     company_name: "DEWAN CEMENT LIMITED",                            qty: 2062 },
  { ticker: "DFSM",    company_name: "DEWAN FAROOQUE SPINNING MILLS LIMITED",           qty: 250 },
  // Page 3
  { ticker: "DINT",    company_name: "DIN TEXTILE MILLS LIMITED",                       qty: 65 },
  { ticker: "DSFL",    company_name: "DEWAN SALMAN FIBRE LIMITED",                      qty: 3062 },
  { ticker: "DWSM",    company_name: "DEWAN SUGAR MILLS LIMITED",                       qty: 80 },
  { ticker: "EPCL",    company_name: "ENGRO POLYMER & CHEMICALS LIMITED",               qty: 159 },
  { ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 qty: 625 },
  { ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             qty: 404 },
  { ticker: "FATIMA",  company_name: "FATIMA FERTILIZER COMPANY LIMITED",               qty: 1125 },
  { ticker: "FCEPL",   company_name: "FRIESLANDCAMPINA ENGRO PAKISTAN LIMITED",         qty: 500 },
  { ticker: "FEM",     company_name: "FIRST EQUITY MODARABA",                           qty: 65526 },
  { ticker: "FRSM",    company_name: "FARAN SUGAR MILLS LIMITED",                       qty: 157 },
  { ticker: "FZCM",    company_name: "FAZAL CLOTH MILLS LIMITED",                       qty: 1183 },
  { ticker: "HABSM",   company_name: "HABIB SUGAR MILLS LIMITED",                       qty: 355 },
  { ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              qty: 2121 },
  // Page 4
  { ticker: "HIFA",    company_name: "HBL INVESTMENT FUND - CLASS A",                   qty: 62 },
  { ticker: "HWQS",    company_name: "HASEEB WAQAS SUGAR MILLS LIMITED",                qty: 125 },
  { ticker: "IDSM",    company_name: "IDEAL SPINNING MILLS LIMITED",                    qty: 252 },
  { ticker: "IGIHL",   company_name: "IGI HOLDINGS LIMITED",                            qty: 5 },
  { ticker: "IML",     company_name: "IMPERIAL LIMITED",                                qty: 375 },
  { ticker: "IREIT",   company_name: "IMAGE REIT",                                      qty: 1000 },
  { ticker: "IVIBL",   company_name: "INNOVATIVE INVESTMENT BANK LIMITED",              qty: 1225 },
  { ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         qty: 325 },
  { ticker: "JKSM",    company_name: "J. K. SPINNING MILLS LIMITED",                    qty: 4393 },
  { ticker: "JSCL",    company_name: "JAHANGIR SIDDIQUI & COMPANY LIMITED",             qty: 1200 },
  { ticker: "JSML",    company_name: "JAUHARABAD SUGAR MILLS LIMITED",                  qty: 157 },
  { ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  qty: 11875 },
  // Page 5
  { ticker: "MCB",     company_name: "MCB BANK LIMITED",                                qty: 51 },
  { ticker: "MEHT",    company_name: "MAHMOOD TEXTILE MILLS LIMITED",                   qty: 240 },
  { ticker: "MIRKS",   company_name: "MIRPURKHAS SUGAR MILLS LIMITED",                  qty: 13470 },
  { ticker: "MLCF",    company_name: "MAPLE LEAF CEMENT FACTORY LIMITED",               qty: 404 },
  { ticker: "MQTM",    company_name: "MAQBOOL TEXTILE MILLS LIMITED",                   qty: 200 },
  { ticker: "MSOT",    company_name: "MASOOD TEXTILE MILLS LIMITED",                    qty: 113 },
  { ticker: "MZSM",    company_name: "MIRZA SUGAR MILLS LIMITED",                       qty: 125 },
  { ticker: "NBP",     company_name: "NATIONAL BANK OF PAKISTAN",                       qty: 75 },
  { ticker: "NCL",     company_name: "NISHAT (CHUNIAN) LIMITED",                        qty: 467 },
  { ticker: "NCPL",    company_name: "NISHAT CHUNIAN POWER LIMITED",                    qty: 390 },
  { ticker: "NML",     company_name: "NISHAT MILLS LIMITED",                            qty: 244 },
  { ticker: "NONS",    company_name: "NOON SUGAR MILLS LIMITED",                        qty: 29124 },
  { ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            qty: 25 },
  // Page 6
  { ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           qty: 250 },
  { ticker: "PAEL",    company_name: "PAK ELEKTRON LIMITED",                            qty: 1044 },
  { ticker: "PINL",    company_name: "PREMIER INSURANCE LIMITED",                       qty: 73544 },
  { ticker: "PIOC",    company_name: "PIONEER CEMENT LIMITED",                          qty: 125 },
  { ticker: "PMRS",    company_name: "THE PREMIER SUGAR MILLS & DISTILLERY COMPANY LIMITED", qty: 275 },
  { ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      qty: 1026 },
  { ticker: "PRET",    company_name: "PREMIUM TEXTILE MILLS LIMITED",                   qty: 25 },
  { ticker: "PSO",     company_name: "PAKISTAN STATE OIL COMPANY LIMITED",              qty: 2570 },
  { ticker: "PTC",     company_name: "PAKISTAN TELECOMMUNICATION COMPANY LTD.",         qty: 100 },
  { ticker: "QUET",    company_name: "QUETTA TEXTILE MILLS LIMITED",                    qty: 25 },
  { ticker: "SANSM",   company_name: "SANGHAR SUGAR MILLS LIMITED",                     qty: 137 },
  { ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         qty: 125 },
  { ticker: "SEPL",    company_name: "SECURITY PAPERS LIMITED",                         qty: 180 },
  // Page 7
  { ticker: "SHCM",    company_name: "SHADMAN COTTON MILLS LIMITED",                    qty: 75 },
  { ticker: "SHSML",   company_name: "SHAHMURAD SUGAR MILLS LIMITED",                   qty: 200 },
  { ticker: "SITC",    company_name: "SITARA CHEMICAL INDUSTRIES LIMITED",               qty: 1288 },
  { ticker: "SJTM",    company_name: "SAJJAD TEXTILE MILLS LIMITED",                    qty: 125 },
  { ticker: "SRSM",    company_name: "SARGODHA SPINNING MILLS LIMITED",                 qty: 3643 },
  { ticker: "SSGC",    company_name: "SUI SOUTHERN GAS COMPANY LIMITED",                qty: 694 },
  { ticker: "SSML",    company_name: "SARITOW SPINNING MILLS LIMITED",                  qty: 168 },
  { ticker: "STYLERS", company_name: "STYLERS INTERNATIONAL LIMITED",                   qty: 75 },
  { ticker: "SURC",    company_name: "SURAJ COTTON MILLS LIMITED",                      qty: 3760 },
  { ticker: "SZTM",    company_name: "SHAHZAD TEXTILE MILLS LIMITED",                   qty: 141 },
  { ticker: "TATM",    company_name: "TATA TEXTILE MILLS LIMITED",                      qty: 25 },
  { ticker: "TCORP",   company_name: "TARIQ CORPORATION LIMITED",                       qty: 39268 },
  { ticker: "TRSM",    company_name: "TRUST MODARABA",                                  qty: 310 },
  // Page 8
  { ticker: "TSML",    company_name: "TANDLIANWALA SUGAR MILLS LIMITED",                qty: 600 },
  { ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             qty: 11882 },
  { ticker: "UDLI",    company_name: "UDL INTERNATIONAL LIMITED",                       qty: 12420 },
  { ticker: "WASL",    company_name: "WASL MOBILITY MODARABA",                          qty: 239 },
  { ticker: "WTL",     company_name: "WORLDCALL TELECOM LIMITED",                       qty: 626 },
  { ticker: "ZELP",    company_name: "ZEAL PAK CEMENT FACTORY LIMITED",                 qty: 1250 },
  { ticker: "ZUMA",    company_name: "ZUMA RESOURCES LIMITED",                          qty: 125 },
];

// First Equity Modaraba broker sub-account (Client 001321, Sub A/C #3033)
// Securities Balance Summary as at 29/06/2026.
// CCM, KAPCO, MCB, UBL also appear in CDC — quantities are additive.
const FEM_POSITIONS: Position[] = [
  { ticker: "ASL",     company_name: "AISHA STEEL LTD",                          qty: 6250 },
  { ticker: "CCM",     company_name: "CRESCENT COTTON MILLS LIMITED",             qty: 403638 },
  { ticker: "CSAP",    company_name: "CRESCENT STEEL & ALLIED PRODUCTS LIMITED",  qty: 76345 },
  { ticker: "FECM",    company_name: "FIRST ELITE CAPITAL MODARABA",              qty: 16296 },
  { ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LTD",               qty: 125 },
  { ticker: "MCB",     company_name: "MUSLIM COMMERCIAL BANK LTD.",               qty: 9 },
  { ticker: "OCTOPUS", company_name: "OCTOPUS DIGITAL LIMITED",                   qty: 575 },
  { ticker: "POWER",   company_name: "POWER CEMENT",                              qty: 250 },
  { ticker: "SBL",     company_name: "SAMBA BANK LIMITED",                        qty: 98040 },
  { ticker: "SFL",     company_name: "SAPPHIRE FIBRES LIMITED",                   qty: 896 },
  { ticker: "STML",    company_name: "SHAMS TEX MILLS LIMITED",                   qty: 27624 },
  { ticker: "UBL",     company_name: "UNITED BANK LIMITED",                       qty: 6 },
];

function buildRows() {
  const cdcRows = POSITIONS.map((p, i) => ({
    ticker: p.ticker,
    trade_date: CDC_DATE,
    type: "ADJUST",
    quantity: p.qty,
    price: 0,
    gross_amount: 0,
    commission: 0,
    tax: 0,
    net_amount: 0,
    source: "adjustment",
    notes: `CDC snapshot ${CDC_DATE}: ${p.qty} ${p.ticker} (cost basis unknown)`,
    row_hash: `${CDC_PREFIX}-pos-${p.ticker}-${i}`,
  }));
  const femRows = FEM_POSITIONS.map((p, i) => ({
    ticker: p.ticker,
    trade_date: FEM_DATE,
    type: "ADJUST",
    quantity: p.qty,
    price: 0,
    gross_amount: 0,
    commission: 0,
    tax: 0,
    net_amount: 0,
    source: "adjustment",
    notes: `FEM snapshot ${FEM_DATE}: ${p.qty} ${p.ticker} (cost basis unknown)`,
    row_hash: `${FEM_PREFIX}-pos-${p.ticker}-${i}`,
  }));
  return [...cdcRows, ...femRows];
}

// Expected combined quantities after aggregation (CDC + FEM where overlapping).
function expectedCombined(): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of POSITIONS)     m.set(p.ticker, (m.get(p.ticker) ?? 0) + p.qty);
  for (const p of FEM_POSITIONS) m.set(p.ticker, (m.get(p.ticker) ?? 0) + p.qty);
  return m;
}

async function resolveUserId(s: SupabaseClient): Promise<string> {
  const { data } = await s.auth.admin.listUsers();
  const u = data.users.find((x) => x.email?.toLowerCase() === EMAIL.toLowerCase());
  if (!u) throw new Error(`No user found for ${EMAIL}`);
  return u.id;
}

async function main() {
  const write = process.argv.includes("--write");
  const txns = buildRows();
  const combined = expectedCombined();

  console.log(`CDC (${CDC_DATE}): ${POSITIONS.length} positions`);
  console.log(`FEM (${FEM_DATE}): ${FEM_POSITIONS.length} positions`);
  console.log(`Total ADJUST rows: ${txns.length}  |  Combined unique tickers: ${combined.size}`);
  console.log(`Overlapping tickers (additive): CCM, KAPCO, MCB, UBL`);

  if (!write) {
    console.log(`\nDry run. Re-run with --write to persist.`);
    return;
  }

  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const userId = await resolveUserId(s);
  console.log(`\nUser ID: ${userId}`);

  // Idempotent: clear prior rows from both sources, then re-insert all.
  await s.from("transactions").delete().eq("user_id", userId).like("row_hash", `${CDC_PREFIX}-%`);
  await s.from("transactions").delete().eq("user_id", userId).like("row_hash", `${FEM_PREFIX}-%`);
  const ins = await s.from("transactions").insert(txns.map((t) => ({ ...t, user_id: userId })));
  if (ins.error) throw ins.error;
  console.log(`Inserted ${txns.length} ADJUST rows (${POSITIONS.length} CDC + ${FEM_POSITIONS.length} FEM).`);

  await recomputeHoldingsFromTransactions(s, userId);

  // Patch company_name for tickers the app may not know from stock_master.
  const companyMap = new Map([
    ...POSITIONS.map((p) => [p.ticker, p.company_name] as [string, string]),
    ...FEM_POSITIONS.map((p) => [p.ticker, p.company_name] as [string, string]),
  ]);
  const { data: holdings } = await s.from("holdings").select("ticker, company_name").eq("user_id", userId);
  for (const h of holdings ?? []) {
    if (!h.company_name && companyMap.has(h.ticker)) {
      await s
        .from("holdings")
        .update({ company_name: companyMap.get(h.ticker) })
        .eq("user_id", userId)
        .eq("ticker", h.ticker);
    }
  }

  // Verify recomputed quantities match combined expected totals.
  const { data: final } = await s.from("holdings").select("ticker, quantity").eq("user_id", userId);
  const got = new Map((final ?? []).map((h) => [h.ticker as string, Number(h.quantity)]));

  console.log("\n=== Reconciliation: recomputed vs combined (CDC + FEM) quantities ===");
  let ok = true;
  for (const [ticker, qty] of [...combined.entries()].sort()) {
    const g = Math.round(got.get(ticker) ?? 0);
    if (g !== qty) ok = false;
    console.log(`  ${ticker.padEnd(8)} recomputed ${String(g).padStart(7)}  expected ${String(qty).padStart(7)}  ${g === qty ? "ok" : "MISMATCH"}`);
  }
  console.log(ok ? "\nHoldings reconcile." : "\n! Holdings mismatch — check above.");
  console.log(`\nBackfill complete for ${EMAIL} (${userId}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
