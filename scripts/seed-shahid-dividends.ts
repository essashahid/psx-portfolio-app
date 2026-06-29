// Seeds dividend history for shahid@crescentcotton.com from the CDC ePayment
// ledger (IBAN PK26UNIL0112017810074238), covering Nov 2023 – Jun 2026.
//
// Duplicate event_ids (same dividend paid across CDC + FEM sub-accounts) get
// a "-b" suffix on the row_hash for the second occurrence so both rows land.
// One HBL entry had no event_id in the source — a synthetic id is assigned.
//
// Upsert is idempotent: safe to re-run; existing rows are skipped (ignoreDuplicates).
//
//   npx tsx scripts/seed-shahid-dividends.ts          # dry run
//   npx tsx scripts/seed-shahid-dividends.ts --write   # persist

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
config({ path: resolve(process.cwd(), ".env.local") });

const EMAIL = "shahid@crescentcotton.com";

interface DivRow {
  event_id: string;
  ticker: string;
  company_name: string;
  payment_date: string | null;
  gross: number;
  net: number;
  status: "received" | "missing";
  notes: string | null;
}

function d(dd: string): string | null {
  if (!dd || dd === '"N/A"' || dd === "N/A") return null;
  const [day, mon, year] = dd.split("/");
  return `${year}-${mon.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

const ROWS: DivRow[] = [
  // ── Jun 2026 ────────────────────────────────────────────────────────────────
  { event_id: "AABS20261241",    ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("11/06/2026"), gross: 937.50,      net: 796.50,     status: "received", notes: null },
  { event_id: "JDWS20261221",    ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("02/06/2026"), gross: 1625.00,     net: 1381.00,    status: "received", notes: null },
  // ── May 2026 ────────────────────────────────────────────────────────────────
  { event_id: "PPL20261181",     ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("25/05/2026"), gross: 2052.00,     net: 1744.00,    status: "received", notes: null },
  { event_id: "MCB20261161",     ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("15/05/2026"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "MCB20261161-b",   ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("15/05/2026"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "BAFL20261162",    ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("18/05/2026"), gross: 93.00,       net: 79.00,      status: "received", notes: null },
  { event_id: "NCPL20261123",    ticker: "NCPL",    company_name: "NISHAT CHUNIAN POWER LIMITED",                    payment_date: d("19/05/2026"), gross: 585.00,      net: 541.00,     status: "received", notes: null },
  { event_id: "NPL20261124",     ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("20/05/2026"), gross: 37.50,       net: 34.69,      status: "received", notes: null },
  { event_id: "OGDC20261131",    ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("22/05/2026"), gross: 812.50,      net: 690.50,     status: "received", notes: null },
  { event_id: "AKBL20261081",    ticker: "AKBL",    company_name: "ASKARI BANK LIMITED",                             payment_date: d("19/05/2026"), gross: 108.00,      net: 92.00,      status: "received", notes: null },
  { event_id: "JDWS20261047",    ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("11/05/2026"), gross: 5688.00,     net: 4835.00,    status: "received", notes: null },
  { event_id: "JDWS20261047-b",  ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("11/05/2026"), gross: 813.00,      net: 752.00,     status: "received", notes: null },
  { event_id: "STYLERS20261048", ticker: "STYLERS", company_name: "STYLERS INTERNATIONAL LIMITED",                   payment_date: d("13/05/2026"), gross: 37.50,       net: 32.00,      status: "received", notes: null },
  { event_id: "FABL20261022",    ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("08/05/2026"), gross: 606.00,      net: 515.00,     status: "received", notes: null },
  { event_id: "ABL20261023",     ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("11/05/2026"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "HBL20261001",     ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("05/05/2026"), gross: 12726.00,    net: 10817.00,   status: "received", notes: null },
  // ── Apr 2026 ────────────────────────────────────────────────────────────────
  { event_id: "UBL2026970",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("28/04/2026"), gross: 48.00,       net: 41.00,      status: "received", notes: null },
  { event_id: "UBL2026970-b",    ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("28/04/2026"), gross: 95056.00,    net: 80798.00,   status: "received", notes: null },
  { event_id: "IGIHL2026964",    ticker: "IGIHL",   company_name: "IGI HOLDINGS LIMITED",                            payment_date: d("08/05/2026"), gross: 28.00,       net: 24.00,      status: "received", notes: null },
  { event_id: "FCEPL2026881",    ticker: "FCEPL",   company_name: "FRIESLANDCAMPINA ENGRO PAKISTAN LIMITED",         payment_date: d("07/05/2026"), gross: 1750.00,     net: 1487.00,    status: "received", notes: null },
  { event_id: "FATIMA2026742",   ticker: "FATIMA",  company_name: "FATIMA FERTILIZER COMPANY LIMITED",               payment_date: d("28/04/2026"), gross: 2812.50,     net: 2390.50,    status: "received", notes: null },
  // ── Mar–Apr 2026 ────────────────────────────────────────────────────────────
  { event_id: "KAPCO2026741",    ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("30/03/2026"), gross: 187.50,      net: 160.00,     status: "received", notes: null },
  { event_id: "KAPCO2026741-b",  ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("30/03/2026"), gross: 17812.50,    net: 15141.00,   status: "received", notes: null },
  { event_id: "NBP2026627",      ticker: "NBP",     company_name: "NATIONAL BANK OF PAKISTAN",                       payment_date: d("24/04/2026"), gross: 2625.00,     net: 2231.00,    status: "received", notes: null },
  { event_id: "BOK2026662",      ticker: "BOK",     company_name: "THE BANK OF KHYBER",                              payment_date: d("13/04/2026"), gross: 8044.40,     net: 6837.00,    status: "received", notes: null },
  { event_id: "HBL2026661",      ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("02/04/2026"), gross: 12726.00,    net: 10817.00,   status: "received", notes: null },
  { event_id: "BIPL2026665",     ticker: "BIPL",    company_name: "BANKISLAMI PAKISTAN LIMITED",                     payment_date: d("07/04/2026"), gross: 5741.25,     net: 4880.25,    status: "received", notes: null },
  { event_id: "FABL2026664",     ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("03/04/2026"), gross: 808.00,      net: 687.00,     status: "received", notes: null },
  { event_id: "BOP2026663",      ticker: "BOP",     company_name: "THE BANK OF PUNJAB",                              payment_date: d("08/04/2026"), gross: 45.00,       net: 38.00,      status: "received", notes: null },
  { event_id: "UBL2026667",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("30/03/2026"), gross: 48.00,       net: 41.00,      status: "received", notes: null },
  { event_id: "UBL2026667-b",    ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("30/03/2026"), gross: 95056.00,    net: 80798.00,   status: "received", notes: null },
  { event_id: "EPQL2026623",     ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("30/03/2026"), gross: 781.00,      net: 722.00,     status: "received", notes: null },
  { event_id: "SCBPL2026628",    ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("07/04/2026"), gross: 375.00,      net: 319.00,     status: "received", notes: null },
  { event_id: "ABL2026624",      ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("04/04/2026"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "MCB2026626",      ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("27/03/2026"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "MCB2026626-b",    ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("27/03/2026"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "BAFL2026601",     ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("02/04/2026"), gross: 93.00,       net: 79.00,      status: "received", notes: null },
  { event_id: "NCL2026504",      ticker: "NCL",     company_name: "NISHAT (CHUNIAN) LIMITED",                        payment_date: d("18/03/2026"), gross: 467.00,      net: 396.95,     status: "received", notes: null },
  { event_id: "AKBL2026501",     ticker: "AKBL",    company_name: "ASKARI BANK LIMITED",                             payment_date: d("27/03/2026"), gross: 95.00,       net: 81.00,      status: "received", notes: null },
  { event_id: "STYLERS2026502",  ticker: "STYLERS", company_name: "STYLERS INTERNATIONAL LIMITED",                   payment_date: d("13/03/2026"), gross: 18.75,       net: 16.00,      status: "received", notes: null },
  // ── Feb–Mar 2026 ────────────────────────────────────────────────────────────
  { event_id: "OGDC2026481",     ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("17/03/2026"), gross: 1062.50,     net: 903.50,     status: "received", notes: null },
  { event_id: "IREIT2026463",    ticker: "IREIT",   company_name: "IMAGE REIT",                                      payment_date: d("16/03/2026"), gross: 200.00,      net: 170.00,     status: "received", notes: null },
  { event_id: "CSAP2026421",     ticker: "CSAP",    company_name: "CRESCENT STEEL & ALLIED PRODUCTS LIMITED",        payment_date: d("02/03/2026"), gross: 152690.00,   net: 129786.00,  status: "received", notes: null },
  { event_id: "PPL2026361",      ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("12/03/2026"), gross: 2052.00,     net: 1744.00,    status: "received", notes: null },
  { event_id: "AABS2026141",     ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("10/02/2026"), gross: 1625.00,     net: 1381.00,    status: "received", notes: null },
  { event_id: "ALNRS2026121",    ticker: "ALNRS",   company_name: "AL-NOOR SUGAR MILLS LIMITED",                     payment_date: d("12/02/2026"), gross: 424.00,      net: 360.00,     status: "received", notes: null },
  { event_id: "SHSML2026123",    ticker: "SHSML",   company_name: "SHAHMURAD SUGAR MILLS LIMITED",                   payment_date: d("12/02/2026"), gross: 1200.00,     net: 1020.00,    status: "received", notes: null },
  { event_id: "NONS2026122",     ticker: "NONS",    company_name: "NOON SUGAR MILLS LIMITED",                        payment_date: d("02/02/2026"), gross: 116496.00,   net: 99022.00,   status: "received", notes: null },
  { event_id: "BAFS2026102",     ticker: "BAFS",    company_name: "BABA FARID SUGAR MILLS LIMITED",                  payment_date: d("04/02/2026"), gross: 5900.00,     net: 5015.00,    status: "received", notes: null },
  // ── Jan 2026 ────────────────────────────────────────────────────────────────
  { event_id: "JDWS202642",      ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("27/01/2026"), gross: 5850.00,     net: 4972.00,    status: "received", notes: null },
  { event_id: "JDWS202642-b",    ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("27/01/2026"), gross: 2275.00,     net: 2104.00,    status: "received", notes: null },
  { event_id: "HABSM202641",     ticker: "HABSM",   company_name: "HABIB SUGAR MILLS LIMITED",                       payment_date: null,            gross: 2130.00,     net: 1810.00,    status: "missing",  notes: "Payment failed: TRANSACTION TIMED OUT" },
  // ── Dec 2025 ────────────────────────────────────────────────────────────────
  { event_id: "SSGC20252841",    ticker: "SSGC",    company_name: "SUI SOUTHERN GAS COMPANY LIMITED",                payment_date: d("02/12/2025"), gross: 347.00,      net: 295.00,     status: "received", notes: null },
  // ── Nov 2025 ────────────────────────────────────────────────────────────────
  { event_id: "PPL20252801",     ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("24/11/2025"), gross: 2052.00,     net: 1744.00,    status: "received", notes: null },
  { event_id: "OGDC20252783",    ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("21/11/2025"), gross: 875.00,      net: 744.00,     status: "received", notes: null },
  { event_id: "AKBL20252761",    ticker: "AKBL",    company_name: "ASKARI BANK LIMITED",                             payment_date: d("18/11/2025"), gross: 68.00,       net: 58.00,      status: "received", notes: null },
  { event_id: "AIRLINK20252685", ticker: "AIRLINK", company_name: "AIR LINK COMMUNICATION LIMITED",                  payment_date: d("17/11/2025"), gross: 1074.00,     net: 913.00,     status: "received", notes: null },
  { event_id: "FABL20252721",    ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("13/11/2025"), gross: 606.00,      net: 515.00,     status: "received", notes: null },
  { event_id: "EPQL20252682",    ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("13/11/2025"), gross: 313.00,      net: 290.00,     status: "received", notes: null },
  { event_id: "ABL20252683",     ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("13/11/2025"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "BAFL20252703",    ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("14/11/2025"), gross: 77.50,       net: 66.00,      status: "received", notes: null },
  { event_id: "HBL20252680auto", ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("11/11/2025"), gross: 10605.00,    net: 9014.00,    status: "received", notes: "event_id absent in source — synthetic id assigned" },
  { event_id: "MCB20252662",     ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("11/11/2025"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "MCB20252662-b",   ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("11/11/2025"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "OGDC20252541",    ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("07/11/2025"), gross: 1250.00,     net: 1062.00,    status: "received", notes: null },
  { event_id: "PPL20252263",     ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("07/11/2025"), gross: 2565.00,     net: 2180.00,    status: "received", notes: null },
  { event_id: "CSAP20252481",    ticker: "CSAP",    company_name: "CRESCENT STEEL & ALLIED PRODUCTS LIMITED",        payment_date: d("07/11/2025"), gross: 190863.00,   net: 162234.00,  status: "received", notes: null },
  { event_id: "SITC20252141",    ticker: "SITC",    company_name: "SITARA CHEMICAL INDUSTRIES LIMITED",               payment_date: d("06/11/2025"), gross: 14168.00,    net: 12043.00,   status: "received", notes: null },
  { event_id: "SURC20252323",    ticker: "SURC",    company_name: "SURAJ COTTON MILLS LIMITED",                      payment_date: d("06/11/2025"), gross: 18800.00,    net: 15980.00,   status: "received", notes: null },
  { event_id: "SFL20252302",     ticker: "SFL",     company_name: "SAPPHIRE FIBRES LIMITED",                         payment_date: d("06/11/2025"), gross: 8960.00,     net: 7616.00,    status: "received", notes: null },
  { event_id: "KAPCO20252242",   ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("06/11/2025"), gross: 29687.50,    net: 25235.00,   status: "received", notes: null },
  { event_id: "KAPCO20252242-b", ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("06/11/2025"), gross: 312.50,      net: 266.00,     status: "received", notes: null },
  { event_id: "PSO20252224",     ticker: "PSO",     company_name: "PAKISTAN STATE OIL COMPANY LIMITED",              payment_date: d("04/11/2025"), gross: 25700.00,    net: 21845.00,   status: "received", notes: null },
  { event_id: "UDLI20252282",    ticker: "UDLI",    company_name: "UDL INTERNATIONAL LIMITED",                       payment_date: d("04/11/2025"), gross: 6210.00,     net: 5278.00,    status: "received", notes: null },
  { event_id: "PIOC20252324",    ticker: "PIOC",    company_name: "PIONEER CEMENT LIMITED",                          payment_date: d("04/11/2025"), gross: 625.00,      net: 531.00,     status: "received", notes: null },
  { event_id: "AIRLINK20252201", ticker: "AIRLINK", company_name: "AIR LINK COMMUNICATION LIMITED",                  payment_date: d("05/11/2025"), gross: 2416.50,     net: 2054.50,    status: "received", notes: null },
  { event_id: "JKSM20252223",    ticker: "JKSM",    company_name: "J.K. SPINNING MILLS LIMITED",                     payment_date: d("31/10/2025"), gross: 8786.00,     net: 7468.00,    status: "received", notes: null },
  { event_id: "UBL20252561",     ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("30/10/2025"), gross: 48.00,       net: 41.00,      status: "received", notes: null },
  { event_id: "UBL20252561-b",   ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("30/10/2025"), gross: 95056.00,    net: 80798.00,   status: "received", notes: null },
  { event_id: "NCL20252101",     ticker: "NCL",     company_name: "NISHAT (CHUNIAN) LIMITED",                        payment_date: d("31/10/2025"), gross: 467.00,      net: 396.95,     status: "received", notes: null },
  { event_id: "NML20252384",     ticker: "NML",     company_name: "NISHAT MILLS LIMITED",                            payment_date: d("10/11/2025"), gross: 454.00,      net: 329.00,     status: "received", notes: null },
  { event_id: "NML20252384-b",   ticker: "NML",     company_name: "NISHAT MILLS LIMITED",                            payment_date: d("10/11/2025"), gross: 488.00,      net: 354.00,     status: "received", notes: null },
  { event_id: "PRET20252361",    ticker: "PRET",    company_name: "PREMIUM TEXTILE MILLS LIMITED",                   payment_date: d("05/11/2025"), gross: 50.00,       net: 43.00,      status: "received", notes: null },
  { event_id: "STYLERS20252421", ticker: "STYLERS", company_name: "STYLERS INTERNATIONAL LIMITED",                   payment_date: d("11/05/2025"), gross: 56.25,       net: 48.00,      status: "received", notes: null },
  // ── Oct 2025 ────────────────────────────────────────────────────────────────
  { event_id: "SEPL20251863",    ticker: "SEPL",    company_name: "SECURITY PAPERS LIMITED",                         payment_date: d("03/10/2025"), gross: 1620.00,     net: 1377.00,    status: "received", notes: null },
  // ── Sep 2025 ────────────────────────────────────────────────────────────────
  { event_id: "FATIMA20251702",  ticker: "FATIMA",  company_name: "FATIMA FERTILIZER COMPANY LIMITED",               payment_date: d("19/09/2025"), gross: 3937.50,     net: 3346.50,    status: "received", notes: null },
  { event_id: "BOK20251683",     ticker: "BOK",     company_name: "THE BANK OF KHYBER",                              payment_date: d("19/09/2025"), gross: 7098.00,     net: 6033.00,    status: "received", notes: null },
  { event_id: "SCBPL20251682",   ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("17/09/2025"), gross: 437.50,      net: 372.00,     status: "received", notes: null },
  { event_id: "FABL20251761",    ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("18/09/2025"), gross: 606.00,      net: 515.00,     status: "received", notes: null },
  { event_id: "IGIHL20251681",   ticker: "IGIHL",   company_name: "IGI HOLDINGS LIMITED",                            payment_date: d("15/09/2025"), gross: 13.00,       net: 11.00,      status: "received", notes: null },
  { event_id: "BIPL20251603",    ticker: "BIPL",    company_name: "BANKISLAMI PAKISTAN LIMITED",                     payment_date: d("12/09/2025"), gross: 6889.50,     net: 5856.50,    status: "received", notes: null },
  { event_id: "AKBL20251602",    ticker: "AKBL",    company_name: "ASKARI BANK LIMITED",                             payment_date: d("10/09/2025"), gross: 108.00,      net: 92.00,      status: "received", notes: null },
  { event_id: "ABL20251601",     ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("11/09/2025"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "BOP20251781",     ticker: "BOP",     company_name: "THE BANK OF PUNJAB",                              payment_date: d("22/09/2025"), gross: 30.00,       net: 25.00,      status: "received", notes: null },
  // ── Aug 2025 ────────────────────────────────────────────────────────────────
  { event_id: "AABS20251465",    ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("25/08/2025"), gross: 3125.00,     net: 2656.00,    status: "received", notes: null },
  { event_id: "SHSML20251404",   ticker: "SHSML",   company_name: "SHAHMURAD SUGAR MILLS LIMITED",                   payment_date: d("19/08/2025"), gross: 1400.00,     net: 1190.00,    status: "received", notes: null },
  { event_id: "HBL20251464",     ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("19/08/2025"), gross: 9544.50,     net: 8112.50,    status: "received", notes: null },
  { event_id: "EPQL20251463",    ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("20/08/2025"), gross: 1563.00,     net: 1446.00,    status: "received", notes: null },
  { event_id: "BAFL20251461",    ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("21/08/2025"), gross: 77.50,       net: 66.00,      status: "received", notes: null },
  { event_id: "MCB20251521",     ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("26/08/2025"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "MCB20251521-b",   ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("26/08/2025"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  // ── Jul–Aug 2025 ────────────────────────────────────────────────────────────
  { event_id: "JDWS20251421",    ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("08/08/2025"), gross: 3250.00,     net: 2762.00,    status: "received", notes: null },
  { event_id: "JDWS20251421-b",  ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("08/08/2025"), gross: 3250.00,     net: 3006.00,    status: "received", notes: null },
  { event_id: "UBL20251321",     ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("25/07/2025"), gross: 95056.00,    net: 80798.00,   status: "received", notes: null },
  { event_id: "UBL20251321-b",   ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("25/07/2025"), gross: 48.00,       net: 41.00,      status: "received", notes: null },
  { event_id: "HIFA20251302",    ticker: "HIFA",    company_name: "HBL INVESTMENT FUND - CLASS A",                   payment_date: d("21/07/2025"), gross: 20.46,       net: 17.00,      status: "received", notes: null },
  // ── May–Jun 2025 ────────────────────────────────────────────────────────────
  { event_id: "AABS20251141",    ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("19/06/2025"), gross: 1500.00,     net: 1275.00,    status: "received", notes: null },
  { event_id: "SHSML20251121",   ticker: "SHSML",   company_name: "SHAHMURAD SUGAR MILLS LIMITED",                   payment_date: d("19/06/2025"), gross: 1400.00,     net: 1190.00,    status: "received", notes: null },
  { event_id: "CSAP20251042",    ticker: "CSAP",    company_name: "CRESCENT STEEL & ALLIED PRODUCTS LIMITED",        payment_date: d("26/05/2025"), gross: 229035.00,   net: 194680.00,  status: "received", notes: null },
  { event_id: "OGDC20251045",    ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("23/05/2025"), gross: 750.00,      net: 637.00,     status: "received", notes: null },
  { event_id: "PPL20251046",     ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("23/05/2025"), gross: 1026.00,     net: 872.00,     status: "received", notes: null },
  { event_id: "NCPL2025989",     ticker: "NCPL",    company_name: "NISHAT CHUNIAN POWER LIMITED",                    payment_date: d("19/05/2025"), gross: 780.00,      net: 721.00,     status: "received", notes: null },
  { event_id: "NPL2025990",      ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("16/05/2025"), gross: 50.00,       net: 46.25,      status: "received", notes: null },
  { event_id: "HBL2025984",      ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("14/05/2025"), gross: 9544.50,     net: 8112.50,    status: "received", notes: null },
  { event_id: "FABL2025982",     ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("14/05/2025"), gross: 606.00,      net: 515.00,     status: "received", notes: null },
  { event_id: "ABL2025983",      ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("15/05/2025"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "STYLERS2025986",  ticker: "STYLERS", company_name: "STYLERS INTERNATIONAL LIMITED",                   payment_date: d("15/05/2025"), gross: 18.75,       net: 16.00,      status: "received", notes: null },
  { event_id: "MCB2025922",      ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("15/05/2025"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "MCB2025922-b",    ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("15/05/2025"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "BAFL2025881",     ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("09/05/2025"), gross: 77.50,       net: 66.00,      status: "received", notes: null },
  // ── Apr–May 2025 ────────────────────────────────────────────────────────────
  { event_id: "EPQL2025861",     ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("07/05/2025"), gross: 4688.00,     net: 4336.00,    status: "received", notes: null },
  { event_id: "UBL2025883",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("05/05/2025"), gross: 33.00,       net: 28.00,      status: "received", notes: null },
  { event_id: "UBL2025883-b",    ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("05/05/2025"), gross: 65351.00,    net: 55548.00,   status: "received", notes: null },
  { event_id: "IGIHL2025823",    ticker: "IGIHL",   company_name: "IGI HOLDINGS LIMITED",                            payment_date: d("05/05/2025"), gross: 20.00,       net: 17.00,      status: "received", notes: null },
  { event_id: "FCEPL2025681",    ticker: "FCEPL",   company_name: "FRIESLANDCAMPINA ENGRO PAKISTAN LIMITED",         payment_date: d("05/05/2025"), gross: 1400.00,     net: 1190.00,    status: "received", notes: null },
  { event_id: "FATIMA2025641",   ticker: "FATIMA",  company_name: "FATIMA FERTILIZER COMPANY LIMITED",               payment_date: d("30/04/2025"), gross: 4781.25,     net: 4064.25,    status: "received", notes: null },
  { event_id: "BOK2025502",      ticker: "BOK",     company_name: "THE BANK OF KHYBER",                              payment_date: d("10/04/2025"), gross: 8044.40,     net: 6837.00,    status: "received", notes: null },
  { event_id: "BIPL2025482",     ticker: "BIPL",    company_name: "BANKISLAMI PAKISTAN LIMITED",                     payment_date: d("07/04/2025"), gross: 5741.25,     net: 4880.25,    status: "received", notes: null },
  { event_id: "HBL2025447",      ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("10/04/2025"), gross: 9014.25,     net: 7662.25,    status: "received", notes: null },
  { event_id: "FABL2025448",     ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("04/04/2025"), gross: 1010.00,     net: 858.00,     status: "received", notes: null },
  { event_id: "BOP2025446",      ticker: "BOP",     company_name: "THE BANK OF PUNJAB",                              payment_date: d("09/04/2025"), gross: 54.00,       net: 46.00,      status: "received", notes: null },
  { event_id: "SCBPL2025443",    ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("11/04/2025"), gross: 687.50,      net: 585.00,     status: "received", notes: null },
  { event_id: "NBP2025441",      ticker: "NBP",     company_name: "NATIONAL BANK OF PAKISTAN",                       payment_date: d("09/04/2025"), gross: 600.00,      net: 510.00,     status: "received", notes: null },
  { event_id: "MCB2025442",      ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("27/03/2025"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "MCB2025442-b",    ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("27/03/2025"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "AKBL2025445",     ticker: "AKBL",    company_name: "ASKARI BANK LIMITED",                             payment_date: d("25/03/2025"), gross: 162.00,      net: 138.00,     status: "received", notes: null },
  { event_id: "ABL2025421",      ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("26/03/2025"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "PPL2025401",      ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("27/03/2025"), gross: 2052.00,     net: 1744.00,    status: "received", notes: null },
  { event_id: "UBL2025382",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("25/03/2025"), gross: 65296.00,    net: 55502.00,   status: "received", notes: null },
  { event_id: "AIRLINK2025361",  ticker: "AIRLINK", company_name: "AIR LINK COMMUNICATION LIMITED",                  payment_date: d("24/03/2025"), gross: 1342.50,     net: 1141.50,    status: "received", notes: null },
  // ── Mar 2025 ────────────────────────────────────────────────────────────────
  { event_id: "OGDC2025365",     ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("24/03/2025"), gross: 1012.50,     net: 860.50,     status: "received", notes: null },
  { event_id: "NPL2025364",      ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("24/03/2025"), gross: 50.00,       net: 46.25,      status: "received", notes: null },
  { event_id: "KAPCO2025363",    ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("24/03/2025"), gross: 562.50,      net: 479.00,     status: "received", notes: null },
  { event_id: "KAPCO2025363-b",  ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("24/03/2025"), gross: 53437.50,    net: 45422.00,   status: "received", notes: null },
  { event_id: "BAFL2025366",     ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("25/03/2025"), gross: 77.50,       net: 66.00,      status: "received", notes: null },
  { event_id: "NCL2025344",      ticker: "NCL",     company_name: "NISHAT (CHUNIAN) LIMITED",                        payment_date: d("20/03/2025"), gross: 467.00,      net: 396.95,     status: "received", notes: null },
  { event_id: "PIOC2025321",     ticker: "PIOC",    company_name: "PIONEER CEMENT LIMITED",                          payment_date: d("19/03/2025"), gross: 625.00,      net: 531.00,     status: "received", notes: null },
  // ── Feb 2025 ────────────────────────────────────────────────────────────────
  { event_id: "CSAP2025181",     ticker: "CSAP",    company_name: "CRESCENT STEEL & ALLIED PRODUCTS LIMITED",        payment_date: d("28/02/2025"), gross: 152690.00,   net: 129786.00,  status: "received", notes: null },
  { event_id: "SEPL2025145",     ticker: "SEPL",    company_name: "SECURITY PAPERS LIMITED",                         payment_date: d("19/02/2025"), gross: 450.00,      net: 382.00,     status: "received", notes: null },
  { event_id: "AABS202582",      ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("10/02/2025"), gross: 3125.00,     net: 2656.00,    status: "received", notes: null },
  // ── Jan 2025 ────────────────────────────────────────────────────────────────
  { event_id: "JDWS202583",      ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("30/01/2025"), gross: 6337.50,     net: 5386.50,    status: "received", notes: null },
  { event_id: "JDWS202583-b",    ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("30/01/2025"), gross: 3412.50,     net: 3156.50,    status: "received", notes: null },
  { event_id: "HABSM202541",     ticker: "HABSM",   company_name: "HABIB SUGAR MILLS LIMITED",                       payment_date: d("31/01/2025"), gross: 2130.00,     net: 1810.00,    status: "received", notes: null },
  // ── Dec 2024 ────────────────────────────────────────────────────────────────
  { event_id: "NCPL20242196",    ticker: "NCPL",    company_name: "NISHAT CHUNIAN POWER LIMITED",                    payment_date: d("03/12/2024"), gross: 1950.00,     net: 1804.00,    status: "received", notes: null },
  // ── Nov 2024 ────────────────────────────────────────────────────────────────
  { event_id: "PPL20242076",     ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("21/11/2024"), gross: 2052.00,     net: 1744.00,    status: "received", notes: null },
  { event_id: "ABL20242057",     ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("22/11/2024"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "NPL20242056",     ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("20/11/2024"), gross: 50.00,       net: 46.25,      status: "received", notes: null },
  { event_id: "OGDC20242036",    ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("20/11/2024"), gross: 750.00,      net: 637.00,     status: "received", notes: null },
  { event_id: "FABL20241980",    ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("13/11/2024"), gross: 606.00,      net: 515.00,     status: "received", notes: null },
  { event_id: "UBL20241916",     ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("14/11/2024"), gross: 65296.00,    net: 55502.00,   status: "received", notes: null },
  { event_id: "MCB20241896",     ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("12/11/2024"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "MCB20241896-b",   ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("12/11/2024"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "BAFL20241877",    ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("07/11/2024"), gross: 62.00,       net: 53.00,      status: "received", notes: null },
  { event_id: "HBL20241837",     ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("06/11/2024"), gross: 8484.00,     net: 7211.00,    status: "received", notes: null },
  { event_id: "EPQL20241836",    ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("05/11/2024"), gross: 1563.00,     net: 1446.00,    status: "received", notes: null },
  { event_id: "SFL20241784",     ticker: "SFL",     company_name: "SAPPHIRE FIBRES LIMITED",                         payment_date: d("08/11/2024"), gross: 8960.00,     net: 7616.00,    status: "received", notes: null },
  { event_id: "STYLERS20241782", ticker: "STYLERS", company_name: "STYLERS INTERNATIONAL LIMITED",                   payment_date: d("06/11/2024"), gross: 56.25,       net: 48.00,      status: "received", notes: null },
  { event_id: "SURC20241780",    ticker: "SURC",    company_name: "SURAJ COTTON MILLS LIMITED",                      payment_date: d("11/11/2024"), gross: 18800.00,    net: 15980.00,   status: "received", notes: null },
  { event_id: "NML20241767",     ticker: "NML",     company_name: "NISHAT MILLS LIMITED",                            payment_date: d("06/11/2024"), gross: 681.00,      net: 579.00,     status: "received", notes: null },
  { event_id: "NML20241767-b",   ticker: "NML",     company_name: "NISHAT MILLS LIMITED",                            payment_date: d("06/11/2024"), gross: 732.00,      net: 622.00,     status: "received", notes: null },
  { event_id: "PIOC20241763",    ticker: "PIOC",    company_name: "PIONEER CEMENT LIMITED",                          payment_date: d("05/11/2024"), gross: 1250.00,     net: 1062.00,    status: "received", notes: null },
  { event_id: "OGDC20241712",    ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("07/11/2024"), gross: 1000.00,     net: 850.00,     status: "received", notes: null },
  { event_id: "SITC20241711",    ticker: "SITC",    company_name: "SITARA CHEMICAL INDUSTRIES LIMITED",               payment_date: d("07/11/2024"), gross: 12880.00,    net: 10948.00,   status: "received", notes: null },
  { event_id: "PPL20241718",     ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("07/11/2024"), gross: 2565.00,     net: 2180.00,    status: "received", notes: null },
  { event_id: "KAPCO20241705",   ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("05/11/2024"), gross: 500.00,      net: 425.00,     status: "received", notes: null },
  { event_id: "KAPCO20241705-b", ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("05/11/2024"), gross: 47500.00,    net: 40375.00,   status: "received", notes: null },
  { event_id: "NPL20241697",     ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("01/11/2024"), gross: 125.00,      net: 115.62,     status: "received", notes: null },
  { event_id: "CSAP20241704",    ticker: "CSAP",    company_name: "CRESCENT STEEL & ALLIED PRODUCTS LIMITED",        payment_date: d("11/11/2024"), gross: 267208.00,   net: 227127.00,  status: "received", notes: null },
  { event_id: "PSO20241696",     ticker: "PSO",     company_name: "PAKISTAN STATE OIL COMPANY LIMITED",              payment_date: d("04/11/2024"), gross: 25700.00,    net: 21845.00,   status: "received", notes: null },
  { event_id: "PMI20241636",     ticker: "PMI",     company_name: "FIRST PRUDENTIAL MODARABA",                       payment_date: d("07/11/2024"), gross: 71.70,       net: 60.70,      status: "received", notes: null },
  // ── Oct 2024 ────────────────────────────────────────────────────────────────
  { event_id: "TRSM20241599",    ticker: "TRSM",    company_name: "TRUST MODARABA",                                  payment_date: d("18/10/2024"), gross: 155.00,      net: 131.75,     status: "received", notes: null },
  { event_id: "AIRLINK20241536", ticker: "AIRLINK", company_name: "AIR LINK COMMUNICATION LIMITED",                  payment_date: d("02/10/2024"), gross: 2148.00,     net: 1826.00,    status: "received", notes: null },
  { event_id: "SEPL20241496",    ticker: "SEPL",    company_name: "SECURITY PAPERS LIMITED",                         payment_date: d("04/10/2024"), gross: 1800.00,     net: 1530.00,    status: "received", notes: null },
  // ── Sep 2024 ────────────────────────────────────────────────────────────────
  { event_id: "FABL20241422",    ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("19/09/2024"), gross: 808.00,      net: 687.00,     status: "received", notes: null },
  { event_id: "IGIHL20241418",   ticker: "IGIHL",   company_name: "IGI HOLDINGS LIMITED",                            payment_date: d("18/09/2024"), gross: 10.00,       net: 8.00,       status: "received", notes: null },
  { event_id: "SCBPL20241417",   ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("20/09/2024"), gross: 250.00,      net: 212.00,     status: "received", notes: null },
  { event_id: "BIPL20241416",    ticker: "BIPL",    company_name: "BANKISLAMI PAKISTAN LIMITED",                     payment_date: d("18/09/2024"), gross: 6889.50,     net: 5856.50,    status: "received", notes: null },
  { event_id: "FATIMA20241408",  ticker: "FATIMA",  company_name: "FATIMA FERTILIZER COMPANY LIMITED",               payment_date: d("18/09/2024"), gross: 3093.75,     net: 2629.75,    status: "received", notes: null },
  { event_id: "HBL20241413",     ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("16/09/2024"), gross: 8484.00,     net: 7211.00,    status: "received", notes: null },
  { event_id: "ABL20241386",     ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("12/09/2024"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  // ── Aug 2024 ────────────────────────────────────────────────────────────────
  { event_id: "AABS20241105",    ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("12/08/2024"), gross: 1250.00,     net: 1062.00,    status: "received", notes: null },
  { event_id: "MCB20241306",     ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("28/08/2024"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "MCB20241306-b",   ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("28/08/2024"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "EPQL20241285",    ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("21/08/2024"), gross: 2188.00,     net: 2024.00,    status: "received", notes: null },
  { event_id: "BAFL20241265",    ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("21/08/2024"), gross: 62.00,       net: 53.00,      status: "received", notes: null },
  { event_id: "UBL20241226",     ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("20/08/2024"), gross: 65296.00,    net: 55502.00,   status: "received", notes: null },
  // ── Jul 2024 ────────────────────────────────────────────────────────────────
  { event_id: "HIFA2024946",     ticker: "HIFA",    company_name: "HBL INVESTMENT FUND - CLASS A",                   payment_date: d("10/07/2024"), gross: 16.12,       net: 14.00,      status: "received", notes: null },
  // ── Jun 2024 ────────────────────────────────────────────────────────────────
  { event_id: "JDWS2024845",     ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("10/06/2024"), gross: 5687.50,     net: 4835.00,    status: "received", notes: null },
  { event_id: "JDWS2024845-b",   ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("10/06/2024"), gross: 812.50,      net: 752.00,     status: "received", notes: null },
  { event_id: "AABS2024826",     ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("11/06/2024"), gross: 1875.00,     net: 1594.00,    status: "received", notes: null },
  // ── May 2024 ────────────────────────────────────────────────────────────────
  { event_id: "PPL2024771",      ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("24/05/2024"), gross: 1026.00,     net: 872.00,     status: "received", notes: null },
  { event_id: "OGDC2024756",     ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("22/05/2024"), gross: 500.00,      net: 425.00,     status: "received", notes: null },
  { event_id: "SCBPL2024755",    ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("23/05/2024"), gross: 187.50,      net: 160.00,     status: "received", notes: null },
  { event_id: "FABL2024745",     ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("16/05/2024"), gross: 404.00,      net: 343.00,     status: "received", notes: null },
  { event_id: "NPL2024727",      ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("16/05/2024"), gross: 50.00,       net: 46.25,      status: "received", notes: null },
  { event_id: "ABL2024729",      ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("16/05/2024"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "BAFL2024730",     ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("15/05/2024"), gross: 62.00,       net: 53.00,      status: "received", notes: null },
  { event_id: "MCB2024728",      ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("14/05/2024"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "MCB2024728-b",    ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("14/05/2024"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "HBL2024732",      ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("16/05/2024"), gross: 8484.00,     net: 7211.00,    status: "received", notes: null },
  { event_id: "UBL2024666",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("08/05/2024"), gross: 65296.00,    net: 55502.00,   status: "received", notes: null },
  { event_id: "FATIMA2024646",   ticker: "FATIMA",  company_name: "FATIMA FERTILIZER COMPANY LIMITED",               payment_date: d("10/05/2024"), gross: 3093.75,     net: 2629.75,    status: "received", notes: null },
  { event_id: "IGIHL2024634",    ticker: "IGIHL",   company_name: "IGI HOLDINGS LIMITED",                            payment_date: d("07/05/2024"), gross: 20.00,       net: 17.00,      status: "received", notes: null },
  // ── Apr 2024 ────────────────────────────────────────────────────────────────
  { event_id: "SCBPL2024427",    ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("15/04/2024"), gross: 312.50,      net: 266.00,     status: "received", notes: null },
  { event_id: "BOP2024469",      ticker: "BOP",     company_name: "THE BANK OF PUNJAB",                              payment_date: d("15/04/2024"), gross: 30.00,       net: 25.00,      status: "received", notes: null },
  { event_id: "BOK2024467",      ticker: "BOK",     company_name: "THE BANK OF KHYBER",                              payment_date: d("16/04/2024"), gross: 6793.50,     net: 5775.00,    status: "received", notes: null },
  { event_id: "AKBL2024468",     ticker: "AKBL",    company_name: "ASKARI BANK LIMITED",                             payment_date: d("09/04/2024"), gross: 135.00,      net: 115.00,     status: "received", notes: null },
  { event_id: "BIPL2024453",     ticker: "BIPL",    company_name: "BANKISLAMI PAKISTAN LIMITED",                     payment_date: d("05/04/2024"), gross: 4593.00,     net: 3904.00,    status: "received", notes: null },
  { event_id: "EPCL2024449",     ticker: "EPCL",    company_name: "ENGRO POLYMER & CHEMICALS LIMITED",               payment_date: d("02/04/2024"), gross: 159.00,      net: 135.00,     status: "received", notes: null },
  { event_id: "ABL2024450",      ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("03/04/2024"), gross: 176.00,      net: 150.00,     status: "received", notes: null },
  { event_id: "HBL2024445",      ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("04/04/2024"), gross: 8484.00,     net: 7211.00,    status: "received", notes: null },
  // ── Mar–Apr 2024 ────────────────────────────────────────────────────────────
  { event_id: "EPQL2024446",     ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("01/04/2024"), gross: 938.00,      net: 868.00,     status: "received", notes: null },
  { event_id: "STYLERS2024428",  ticker: "STYLERS", company_name: "STYLERS INTERNATIONAL LIMITED",                   payment_date: d("19/03/2024"), gross: 75.00,       net: 64.00,      status: "received", notes: null },
  { event_id: "MCB2024425",      ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("27/03/2024"), gross: 459.00,      net: 390.00,     status: "received", notes: null },
  { event_id: "MCB2024425-b",    ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("27/03/2024"), gross: 81.00,       net: 69.00,      status: "received", notes: null },
  { event_id: "KAPCO2024429",    ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("19/03/2024"), gross: 562.50,      net: 479.00,     status: "received", notes: null },
  { event_id: "KAPCO2024429-b",  ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("19/03/2024"), gross: 53437.50,    net: 45422.00,   status: "received", notes: null },
  { event_id: "OGDC2024406",     ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("22/03/2024"), gross: 625.00,      net: 531.00,     status: "received", notes: null },
  { event_id: "PIOC2024369",     ticker: "PIOC",    company_name: "PIONEER CEMENT LIMITED",                          payment_date: d("20/03/2024"), gross: 625.00,      net: 531.00,     status: "received", notes: null },
  { event_id: "UBL2024368",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("21/03/2024"), gross: 65296.00,    net: 55502.00,   status: "received", notes: null },
  { event_id: "PPL2024365",      ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("20/03/2024"), gross: 2565.00,     net: 2180.00,    status: "received", notes: null },
  { event_id: "FABL2024268",     ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("08/03/2024"), gross: 808.00,      net: 687.00,     status: "received", notes: null },
  { event_id: "NPL2024327",      ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("07/03/2024"), gross: 62.50,       net: 57.81,      status: "received", notes: null },
  { event_id: "SEPL2024328",     ticker: "SEPL",    company_name: "SECURITY PAPERS LIMITED",                         payment_date: d("14/03/2024"), gross: 450.00,      net: 382.00,     status: "received", notes: null },
  { event_id: "CSAP2024265",     ticker: "CSAP",    company_name: "CRESCENT STEEL & ALLIED PRODUCTS LIMITED",        payment_date: d("14/03/2024"), gross: 152690.00,   net: 129786.00,  status: "received", notes: null },
  // ── Feb 2024 ────────────────────────────────────────────────────────────────
  { event_id: "AIRLINK2024165",  ticker: "AIRLINK", company_name: "AIR LINK COMMUNICATION LIMITED",                  payment_date: d("22/02/2024"), gross: 1074.00,     net: 913.00,     status: "received", notes: null },
  { event_id: "NONS2024107",     ticker: "NONS",    company_name: "NOON SUGAR MILLS LIMITED",                        payment_date: d("07/02/2024"), gross: 116496.00,   net: 99022.00,   status: "received", notes: null },
  { event_id: "JDWS2024106",     ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("12/02/2024"), gross: 2193.75,     net: 2029.00,    status: "received", notes: null },
  { event_id: "JDWS2024106-b",   ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("12/02/2024"), gross: 2681.25,     net: 2279.00,    status: "received", notes: null },
  { event_id: "FRSM2024105",     ticker: "FRSM",    company_name: "FARAN SUGAR MILLS LIMITED",                       payment_date: d("09/02/2024"), gross: 392.50,      net: 333.50,     status: "received", notes: null },
  { event_id: "ALNRS2024104",    ticker: "ALNRS",   company_name: "AL-NOOR SUGAR MILLS LIMITED",                     payment_date: d("07/02/2024"), gross: 954.00,      net: 811.00,     status: "received", notes: null },
  { event_id: "SHSML2024102",    ticker: "SHSML",   company_name: "SHAHMURAD SUGAR MILLS LIMITED",                   payment_date: d("07/02/2024"), gross: 4000.00,     net: 3400.00,    status: "received", notes: null },
  { event_id: "AABS202481",      ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("12/02/2024"), gross: 750.00,      net: 637.00,     status: "received", notes: null },
  { event_id: "HABSM202442",     ticker: "HABSM",   company_name: "HABIB SUGAR MILLS LIMITED",                       payment_date: d("02/02/2024"), gross: 2130.00,     net: 1810.00,    status: "received", notes: null },
  { event_id: "JSML2024108",     ticker: "JSML",    company_name: "JAUHARABAD SUGAR MILLS LIMITED",                  payment_date: d("06/02/2024"), gross: 157.00,      net: 133.00,     status: "received", notes: null },
  { event_id: "CHAS2024202",     ticker: "CHAS",    company_name: "CHASHMA SUGAR MILLS LIMITED",                     payment_date: d("08/03/2024"), gross: 2500.00,     net: 2125.00,    status: "received", notes: null },
  // ── Nov 2023 ────────────────────────────────────────────────────────────────
  { event_id: "OGDC2023882",     ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("24/11/2023"), gross: 400.00,      net: 340.00,     status: "received", notes: null },
  { event_id: "AIRLINK2023675",  ticker: "AIRLINK", company_name: "AIR LINK COMMUNICATION LIMITED",                  payment_date: d("13/11/2023"), gross: 1342.50,     net: 1141.50,    status: "received", notes: null },
  { event_id: "BIPL2023853",     ticker: "BIPL",    company_name: "BANKISLAMI PAKISTAN LIMITED",                     payment_date: d("16/11/2023"), gross: 8037.75,     net: 6831.75,    status: "received", notes: null },
  { event_id: "FABL2023852",     ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("17/11/2023"), gross: 404.00,      net: 343.00,     status: "received", notes: null },
  { event_id: "SCBPL2023804",    ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("17/11/2023"), gross: 312.50,      net: 266.00,     status: "received", notes: null },
  { event_id: "HBL2023805",      ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("17/11/2023"), gross: 4772.25,     net: 4056.25,    status: "received", notes: null },
  { event_id: "ABL2023849",      ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("17/11/2023"), gross: 132.00,      net: 112.00,     status: "received", notes: null },
  { event_id: "UBL2023845",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("14/11/2023"), gross: 65296.00,    net: 55502.00,   status: "received", notes: null },
  { event_id: "MCB2023843",      ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("15/11/2023"), gross: 408.00,      net: 347.00,     status: "received", notes: null },
  { event_id: "MCB2023843-b",    ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("15/11/2023"), gross: 72.00,       net: 61.00,      status: "received", notes: null },
  { event_id: "PPL2023642",      ticker: "PPL",     company_name: "PAKISTAN PETROLEUM LIMITED",                      payment_date: d("13/11/2023"), gross: 1539.00,     net: 1308.00,    status: "received", notes: null },
  { event_id: "SURC2023691",     ticker: "SURC",    company_name: "SURAJ COTTON MILLS LIMITED",                      payment_date: d("08/11/2023"), gross: 3450.00,     net: 2932.00,    status: "received", notes: null },
  { event_id: "SFL2023663",      ticker: "SFL",     company_name: "SAPPHIRE FIBRES LIMITED",                         payment_date: d("07/11/2023"), gross: 8960.00,     net: 7616.00,    status: "received", notes: null },
  { event_id: "OGDC2023656",     ticker: "OGDC",    company_name: "OIL & GAS DEVELOPMENT COMPANY LIMITED",           payment_date: d("08/11/2023"), gross: 687.50,      net: 584.50,     status: "received", notes: null },
  { event_id: "EPCL2023762",     ticker: "EPCL",    company_name: "ENGRO POLYMER & CHEMICALS LIMITED",               payment_date: d("08/11/2023"), gross: 398.00,      net: 338.00,     status: "received", notes: null },
  { event_id: "PSO2023645",      ticker: "PSO",     company_name: "PAKISTAN STATE OIL COMPANY LIMITED",              payment_date: d("08/11/2023"), gross: 19275.00,    net: 16384.00,   status: "received", notes: null },
  { event_id: "SITC2023584",     ticker: "SITC",    company_name: "SITARA CHEMICAL INDUSTRIES LIMITED",               payment_date: d("03/11/2023"), gross: 12880.00,    net: 10948.00,   status: "received", notes: null },
  { event_id: "SEPL2023589",     ticker: "SEPL",    company_name: "SECURITY PAPERS LIMITED",                         payment_date: d("03/11/2023"), gross: 1980.00,     net: 1683.00,    status: "received", notes: null },
  { event_id: "EPQL2023722",     ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("01/11/2023"), gross: 1250.00,     net: 1156.00,    status: "received", notes: null },
  { event_id: "NPL2023644",      ticker: "NPL",     company_name: "NISHAT POWER LIMITED",                            payment_date: d("03/11/2023"), gross: 75.00,       net: 69.37,      status: "received", notes: null },
  { event_id: "PRET2023643",     ticker: "PRET",    company_name: "PREMIUM TEXTILE MILLS LIMITED",                   payment_date: d("01/11/2023"), gross: 625.00,      net: 531.00,     status: "received", notes: null },
  { event_id: "NML2023604",      ticker: "NML",     company_name: "NISHAT MILLS LIMITED",                            payment_date: d("06/11/2023"), gross: 1220.00,     net: 1037.00,    status: "received", notes: null },
  { event_id: "NML2023604-b",    ticker: "NML",     company_name: "NISHAT MILLS LIMITED",                            payment_date: d("06/11/2023"), gross: 1135.00,     net: 965.00,     status: "received", notes: null },
  { event_id: "KAPCO2023605",    ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("06/11/2023"), gross: 625.00,      net: 531.00,     status: "received", notes: null },
  { event_id: "KAPCO2023605-b",  ticker: "KAPCO",   company_name: "KOT ADDU POWER COMPANY LIMITED",                  payment_date: d("06/11/2023"), gross: 59375.00,    net: 50469.00,   status: "received", notes: null },
  { event_id: "PMI2023598",      ticker: "PMI",     company_name: "FIRST PRUDENTIAL MODARABA",                       payment_date: d("14/11/2023"), gross: 71.70,       net: 60.70,      status: "received", notes: null },
  { event_id: "TATM2023564",     ticker: "TATM",    company_name: "TATA TEXTILE MILLS LIMITED",                      payment_date: d("25/10/2023"), gross: 75.00,       net: 64.00,      status: "received", notes: null },
  // ── Sep–Oct 2023 ────────────────────────────────────────────────────────────
  { event_id: "AABS2023502",     ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("27/09/2023"), gross: 3125.00,     net: 2656.00,    status: "received", notes: null },
  { event_id: "SCBPL2023368",    ticker: "SCBPL",   company_name: "STANDARD CHARTERED BANK (PAKISTAN) LTD.",         payment_date: d("21/09/2023"), gross: 500.00,      net: 425.00,     status: "received", notes: null },
  { event_id: "FATIMA2023369",   ticker: "FATIMA",  company_name: "FATIMA FERTILIZER COMPANY LIMITED",               payment_date: d("19/09/2023"), gross: 1968.75,     net: 1673.75,    status: "received", notes: null },
  { event_id: "FABL2023362",     ticker: "FABL",    company_name: "FAYSAL BANK LIMITED",                             payment_date: d("15/09/2023"), gross: 404.00,      net: 343.00,     status: "received", notes: null },
  { event_id: "IGIHL2023360",    ticker: "IGIHL",   company_name: "IGI HOLDINGS LIMITED",                            payment_date: d("08/09/2023"), gross: 10.00,       net: 8.00,       status: "received", notes: null },
  { event_id: "ABL2023341",      ticker: "ABL",     company_name: "ALLIED BANK LIMITED",                             payment_date: d("07/09/2023"), gross: 110.00,      net: 93.00,      status: "received", notes: null },
  // ── Aug–Sep 2023 ────────────────────────────────────────────────────────────
  { event_id: "BAFL2023322",     ticker: "BAFL",    company_name: "BANK ALFALAH LIMITED",                            payment_date: d("01/09/2023"), gross: 93.00,       net: 79.00,      status: "received", notes: null },
  { event_id: "EPCL2023300",     ticker: "EPCL",    company_name: "ENGRO POLYMER & CHEMICALS LIMITED",               payment_date: d("30/08/2023"), gross: 239.00,      net: 203.00,     status: "received", notes: null },
  { event_id: "EPQL2023280",     ticker: "EPQL",    company_name: "ENGRO POWERGEN QADIRPUR LIMITED",                 payment_date: d("24/08/2023"), gross: 938.00,      net: 868.00,     status: "received", notes: null },
  { event_id: "HBL2023246",      ticker: "HBL",     company_name: "HABIB BANK LIMITED",                              payment_date: d("22/08/2023"), gross: 4242.00,     net: 3606.00,    status: "received", notes: null },
  { event_id: "MCB2023260",      ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("22/08/2023"), gross: 63.00,       net: 54.00,      status: "received", notes: null },
  { event_id: "MCB2023260-b",    ticker: "MCB",     company_name: "MCB BANK LIMITED",                                payment_date: d("22/08/2023"), gross: 357.00,      net: 303.00,     status: "received", notes: null },
  { event_id: "SHSML2023244",    ticker: "SHSML",   company_name: "SHAHMURAD SUGAR MILLS LIMITED",                   payment_date: d("21/08/2023"), gross: 3000.00,     net: 2550.00,    status: "received", notes: null },
  // ── Aug 2023 ────────────────────────────────────────────────────────────────
  { event_id: "JDWS2023222",     ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("11/08/2023"), gross: 650.00,      net: 552.00,     status: "received", notes: null },
  { event_id: "JDWS2023222-b",   ticker: "JDWS",    company_name: "JDW SUGAR MILLS LIMITED",                         payment_date: d("10/08/2023"), gross: 4225.00,     net: 3908.00,    status: "received", notes: null },
  { event_id: "AABS2023221",     ticker: "AABS",    company_name: "AL-ABBAS SUGAR MILLS LIMITED",                    payment_date: d("10/08/2023"), gross: 1875.00,     net: 1594.00,    status: "received", notes: null },
  { event_id: "UBL2023203",      ticker: "UBL",     company_name: "UNITED BANK LIMITED",                             payment_date: d("08/08/2023"), gross: 65296.00,    net: 55502.00,   status: "received", notes: null },
  // ── Jun–Jul 2023 ────────────────────────────────────────────────────────────
  { event_id: "HIFA2023194",     ticker: "HIFA",    company_name: "HBL INVESTMENT FUND - CLASS A",                   payment_date: d("19/07/2023"), gross: 24.80,       net: 21.00,      status: "received", notes: null },
  { event_id: "SHSML2023173",    ticker: "SHSML",   company_name: "SHAHMURAD SUGAR MILLS LIMITED",                   payment_date: d("19/06/2023"), gross: 3000.00,     net: 2550.00,    status: "received", notes: null },
];

async function main() {
  const write = process.argv.includes("--write");

  const grossTotal = ROWS.reduce((s, r) => s + r.gross, 0);
  const netTotal   = ROWS.reduce((s, r) => s + (r.status === "received" ? r.net : 0), 0);
  console.log(`Rows: ${ROWS.length}  |  Gross total: Rs ${grossTotal.toLocaleString()}  |  Net received: Rs ${netTotal.toLocaleString()}`);

  if (!write) {
    console.log(`\nDry run. Re-run with --write to persist.`);
    return;
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: users } = await admin.auth.admin.listUsers();
  const user = users?.users.find((u) => u.email === EMAIL);
  if (!user) throw new Error(`User ${EMAIL} not found`);
  console.log(`User ID: ${user.id}`);

  const records = ROWS.map((r) => ({
    user_id: user.id,
    ticker: r.ticker,
    company_name: r.company_name,
    payment_date: r.payment_date,
    pay_date: r.payment_date,
    amount: r.gross,
    tax: +(r.gross - r.net).toFixed(2),
    net_amount: r.status === "received" ? r.net : 0,
    status: r.status,
    source: "manual" as const,
    notes: r.notes,
    row_hash: `shahid-div-${r.event_id}`,
  }));

  const { error, data } = await admin
    .from("dividends")
    .upsert(records, { onConflict: "user_id,row_hash", ignoreDuplicates: true })
    .select("id");

  if (error) throw error;
  console.log(`Inserted ${data?.length ?? 0} of ${records.length} records.`);
  console.log(`Gross total: Rs ${grossTotal.toLocaleString()}  |  Net received: Rs ${netTotal.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
