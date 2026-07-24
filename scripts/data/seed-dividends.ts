import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
config({ path: resolve(process.cwd(), ".env.local") });

const EMAIL = "eessashahid@gmail.com";

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
  // ── Group 1 (May 2026) ──────────────────────────────────────────────────
  { event_id: "PPL20261181",  ticker: "PPL",    company_name: "Pakistan Petroleum Limited",            payment_date: d("25/05/2026"), gross: 518.00,  net: 440.00,  status: "received", notes: null },
  { event_id: "MEBL20261101", ticker: "MEBL",   company_name: "Meezan Bank Limited",                  payment_date: d("16/05/2026"), gross: 4170.00, net: 3544.00, status: "received", notes: null },
  { event_id: "FFC20261130",  ticker: "FFC",    company_name: "Fauji Fertilizer Company Limited",     payment_date: d("20/05/2026"), gross: 765.00,  net: 650.00,  status: "received", notes: null },
  { event_id: "SYS20261025",  ticker: "SYS",    company_name: "Systems Limited",                      payment_date: d("22/05/2026"), gross: 1302.00, net: 1074.00, status: "received", notes: null },
  { event_id: "UBL2026970",   ticker: "UBL",    company_name: "United Bank Limited",                  payment_date: d("28/04/2026"), gross: 3584.00, net: 3046.00, status: "received", notes: null },
  { event_id: "MEBL2026681",  ticker: "MEBL",   company_name: "Meezan Bank Limited",                  payment_date: d("28/03/2026"), gross: 3367.00, net: 2742.00, status: "received", notes: null },
  { event_id: "UBL2026667",   ticker: "UBL",    company_name: "United Bank Limited",                  payment_date: d("30/03/2026"), gross: 2880.00, net: 2403.00, status: "received", notes: null },
  { event_id: "SCBPL2026628", ticker: "SCBPL",  company_name: "Standard Chartered Bank (Pakistan) Ltd", payment_date: d("07/04/2026"), gross: 660.00,  net: 506.00,  status: "received", notes: null },
  { event_id: "FFC2026482",   ticker: "FFC",    company_name: "Fauji Fertilizer Company Limited",     payment_date: d("25/03/2026"), gross: 518.50,  net: 426.00,  status: "received", notes: null },
  { event_id: "IREIT2026463", ticker: "IREIT",  company_name: "Image Reit",                           payment_date: null,            gross: 300.00,  net: 0,       status: "missing",  notes: "Unpaid — zakat deduction (Rs 361) exceeds gross dividend (Rs 300)" },

  // ── Group 2 (Oct–Dec 2025) ──────────────────────────────────────────────
  { event_id: "PPL2026361",      ticker: "PPL",    company_name: "Pakistan Petroleum Limited",        payment_date: d("12/03/2026"), gross: 234.00,  net: 170.00,  status: "received", notes: null },
  { event_id: "PPL20252801",     ticker: "PPL",    company_name: "Pakistan Petroleum Limited",        payment_date: d("24/11/2025"), gross: 234.00,  net: 199.00,  status: "received", notes: null },
  { event_id: "MEBL20252708",    ticker: "MEBL",   company_name: "Meezan Bank Limited",               payment_date: d("14/11/2025"), gross: 3185.00, net: 2707.00, status: "received", notes: null },
  { event_id: "FFC20252705",     ticker: "FFC",    company_name: "Fauji Fertilizer Company Limited",  payment_date: d("13/11/2025"), gross: 570.00,  net: 484.00,  status: "received", notes: null },
  { event_id: "AIRLINK20252685", ticker: "AIRLINK",company_name: "Air Link Communication Limited",    payment_date: d("17/11/2025"), gross: 360.00,  net: 306.00,  status: "received", notes: null },
  { event_id: "UBL20252561",     ticker: "UBL",    company_name: "United Bank Limited",               payment_date: d("30/10/2025"), gross: 2832.00, net: 2407.00, status: "received", notes: null },
  { event_id: "IMAGE20252542",   ticker: "IMAGE",  company_name: "Image Pakistan Limited",            payment_date: d("21/11/2025"), gross: 1100.00, net: 935.00,  status: "received", notes: null },
  { event_id: "PPL20252263",     ticker: "PPL",    company_name: "Pakistan Petroleum Limited",        payment_date: d("07/11/2025"), gross: 293.00,  net: 249.00,  status: "received", notes: null },
  { event_id: "AIRLINK20252201", ticker: "AIRLINK",company_name: "Air Link Communication Limited",    payment_date: d("05/11/2025"), gross: 405.00,  net: 344.00,  status: "received", notes: null },
  { event_id: "FCCL20251901",    ticker: "FCCL",   company_name: "Fauji Cement Company Limited",      payment_date: d("09/10/2025"), gross: 625.00,  net: 406.00,  status: "received", notes: null },

  // ── Group 3 (May–Sep 2025) ──────────────────────────────────────────────
  { event_id: "SCBPL20251682",  ticker: "SCBPL",  company_name: "Standard Chartered Bank (Pakistan) Ltd", payment_date: d("17/09/2025"), gross: 745.50,  net: 522.00,  status: "received", notes: null },
  { event_id: "MEBL20251582",   ticker: "MEBL",   company_name: "Meezan Bank Limited",               payment_date: d("08/09/2025"), gross: 3150.00, net: 2205.00, status: "received", notes: null },
  { event_id: "FFC20251441",    ticker: "FFC",    company_name: "Fauji Fertilizer Company Limited",  payment_date: d("18/08/2025"), gross: 516.00,  net: 361.00,  status: "received", notes: null },
  { event_id: "UBL20251321",    ticker: "UBL",    company_name: "United Bank Limited",               payment_date: d("25/07/2025"), gross: 2832.00, net: 1982.00, status: "received", notes: null },
  { event_id: "IMAGE20251044",  ticker: "IMAGE",  company_name: "Image Pakistan Limited",            payment_date: d("27/05/2025"), gross: 600.00,  net: 270.00,  status: "received", notes: null },
  { event_id: "FFC20251021",    ticker: "FFC",    company_name: "Fauji Fertilizer Company Limited",  payment_date: d("16/05/2025"), gross: 161.00,  net: 113.00,  status: "received", notes: null },
  { event_id: "MEBL2025901",    ticker: "MEBL",   company_name: "Meezan Bank Limited",               payment_date: d("14/05/2025"), gross: 1638.00, net: 1147.00, status: "received", notes: null },
  { event_id: "UBL2025883",     ticker: "UBL",    company_name: "United Bank Limited",               payment_date: d("05/05/2025"), gross: 1947.00, net: 1363.00, status: "received", notes: null },
  { event_id: "MEBL2025521",    ticker: "MEBL",   company_name: "Meezan Bank Limited",               payment_date: d("11/04/2025"), gross: 1638.00, net: 1088.00, status: "received", notes: null },
  { event_id: "FFC2025522",     ticker: "FFC",    company_name: "Fauji Fertilizer Company Limited",  payment_date: d("04/04/2025"), gross: 483.00,  net: 332.00,  status: "received", notes: null },

  // ── Group 4 (Aug 2024 – Apr 2025) ───────────────────────────────────────
  { event_id: "SCBPL2025443",   ticker: "SCBPL",  company_name: "Standard Chartered Bank (Pakistan) Ltd", payment_date: d("11/04/2025"), gross: 550.00,  net: 360.00,  status: "received", notes: null },
  { event_id: "UBL2025382",     ticker: "UBL",    company_name: "United Bank Limited",               payment_date: d("25/03/2025"), gross: 1947.00, net: 1319.00, status: "received", notes: null },
  { event_id: "AIRLINK2025361", ticker: "AIRLINK",company_name: "Air Link Communication Limited",    payment_date: d("24/03/2025"), gross: 75.00,   net: 44.00,   status: "received", notes: null },
  { event_id: "UBL20241916",    ticker: "UBL",    company_name: "United Bank Limited",               payment_date: d("14/11/2024"), gross: 1947.00, net: 1363.00, status: "received", notes: null },
  { event_id: "MEBL20241876",   ticker: "MEBL",   company_name: "Meezan Bank Limited",               payment_date: d("12/11/2024"), gross: 1582.00, net: 1107.00, status: "received", notes: null },
  { event_id: "FCCL20241597",   ticker: "FCCL",   company_name: "Fauji Cement Company Limited",      payment_date: d("30/10/2024"), gross: 500.00,  net: 225.00,  status: "received", notes: null },
  { event_id: "AIRLINK20241536",ticker: "AIRLINK",company_name: "Air Link Communication Limited",    payment_date: d("02/10/2024"), gross: 120.00,  net: 76.00,   status: "received", notes: null },
  { event_id: "SCBPL20241417",  ticker: "SCBPL",  company_name: "Standard Chartered Bank (Pakistan) Ltd", payment_date: d("20/09/2024"), gross: 200.00,  net: 140.00,  status: "received", notes: null },
  { event_id: "MEBL20241307",   ticker: "MEBL",   company_name: "Meezan Bank Limited",               payment_date: d("29/08/2024"), gross: 1582.00, net: 1107.00, status: "received", notes: null },
  { event_id: "UBL20241226",    ticker: "UBL",    company_name: "United Bank Limited",               payment_date: d("20/08/2024"), gross: 1837.00, net: 1286.00, status: "received", notes: null },

  // ── Group 5 (Mar–May 2024) ───────────────────────────────────────────────
  { event_id: "PPL2024771",   ticker: "PPL",  company_name: "Pakistan Petroleum Limited",           payment_date: d("24/05/2024"), gross: 56.00,  net: 39.00, status: "received", notes: null },
  { event_id: "MCB2024728",   ticker: "MCB",  company_name: "MCB Bank Limited",                    payment_date: d("14/05/2024"), gross: 54.00,  net: 38.00, status: "received", notes: null },
  { event_id: "MEBL2024685",  ticker: "MEBL", company_name: "Meezan Bank Limited",                  payment_date: d("11/05/2024"), gross: 112.00, net: 78.00, status: "received", notes: null },
  { event_id: "UBL2024666",   ticker: "UBL",  company_name: "United Bank Limited",                  payment_date: d("08/05/2024"), gross: 77.00,  net: 54.00, status: "received", notes: null },
  { event_id: "MEBL2024465",  ticker: "MEBL", company_name: "Meezan Bank Limited",                  payment_date: d("06/04/2024"), gross: 128.00, net: 86.00, status: "received", notes: null },
  { event_id: "MCB2024425",   ticker: "MCB",  company_name: "MCB Bank Limited",                    payment_date: d("28/03/2024"), gross: 54.00,  net: 36.00, status: "received", notes: null },
  { event_id: "MTL2024409",   ticker: "MTL",  company_name: "Millat Tractors Limited",              payment_date: d("20/03/2024"), gross: 50.00,  net: 35.00, status: "received", notes: null },
  { event_id: "UBL2024368",   ticker: "UBL",  company_name: "United Bank Limited",                  payment_date: d("21/03/2024"), gross: 77.00,  net: 52.00, status: "received", notes: null },
  { event_id: "PPL2024365",   ticker: "PPL",  company_name: "Pakistan Petroleum Limited",           payment_date: d("20/03/2024"), gross: 140.00, net: 84.00, status: "received", notes: null },
  { event_id: "MCB2023843",   ticker: "MCB",  company_name: "MCB Bank Limited",                    payment_date: d("16/11/2023"), gross: 48.00,  net: 34.00, status: "received", notes: null },

  // ── Group 6 (Aug–Nov 2023) ───────────────────────────────────────────────
  { event_id: "UBL2023845",   ticker: "UBL",  company_name: "United Bank Limited",                  payment_date: d("14/11/2023"), gross: 77.00,  net: 54.00, status: "received", notes: null },
  { event_id: "MEBL2023784",  ticker: "MEBL", company_name: "Meezan Bank Limited",                  payment_date: d("14/11/2023"), gross: 80.00,  net: 56.00, status: "received", notes: null },
  { event_id: "MTL2023660",   ticker: "MTL",  company_name: "Millat Tractors Limited",              payment_date: d("07/11/2023"), gross: 30.00,  net: 20.00, status: "received", notes: null },
  { event_id: "PPL2023642",   ticker: "PPL",  company_name: "Pakistan Petroleum Limited",           payment_date: d("13/11/2023"), gross: 84.00,  net: 59.00, status: "received", notes: null },
  { event_id: "MEBL2023321",  ticker: "MEBL", company_name: "Meezan Bank Limited",                  payment_date: d("06/09/2023"), gross: 64.00,  net: 45.00, status: "received", notes: null },
  { event_id: "MCB2023260",   ticker: "MCB",  company_name: "MCB Bank Limited",                    payment_date: d("23/08/2023"), gross: 42.00,  net: 29.00, status: "received", notes: null },
];

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: users } = await admin.auth.admin.listUsers();
  const user = users?.users.find((u) => u.email === EMAIL);
  if (!user) throw new Error(`User ${EMAIL} not found`);
  console.log(`User: ${user.id}`);

  const records = ROWS.map((r) => ({
    user_id: user.id,
    ticker: r.ticker,
    company_name: r.company_name,
    payment_date: r.payment_date,
    pay_date: r.payment_date,
    amount: r.gross,
    tax: +(r.gross - r.net).toFixed(2),
    net_amount: r.net > 0 ? r.net : 0,
    status: r.status,
    source: "manual" as const,
    notes: r.notes,
    row_hash: `cdc-event-${r.event_id}`,
  }));

  const { error, data } = await admin
    .from("dividends")
    .upsert(records, { onConflict: "user_id,row_hash", ignoreDuplicates: true })
    .select("id");

  if (error) throw error;
  console.log(`Inserted ${data?.length ?? 0} of ${records.length} records.`);

  const gross = ROWS.reduce((s, r) => s + r.gross, 0);
  const net   = ROWS.reduce((s, r) => s + Math.max(r.net, 0), 0);
  console.log(`Gross total: Rs ${gross.toLocaleString()}  |  Net received: Rs ${net.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
