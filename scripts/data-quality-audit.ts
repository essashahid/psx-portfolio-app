import { createAdminClient } from "@/lib/supabase/admin";
import { loadEnvLocal } from "./load-env";

type Row = { ticker: string };
type UniverseRow = { ticker: string; listing_status: string; instrument_type: string | null };
type PagedQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

const COMPANY_TYPES = new Set(["equity", "modaraba"]);

async function pageAll<T>(makeQuery: () => PagedQuery<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function setOf(rows: Row[] | null | undefined): Set<string> {
  return new Set((rows ?? []).map((row) => row.ticker.toUpperCase()));
}

async function main() {
  loadEnvLocal();
  const db = createAdminClient();

  // Universe with instrument classes (pre-0030 the column is absent — degrade).
  let universeRows: UniverseRow[];
  try {
    universeRows = await pageAll<UniverseRow>(() =>
      db.from("stock_universe").select("ticker, listing_status, instrument_type")
    );
  } catch {
    const plain = await pageAll<{ ticker: string; listing_status: string }>(() =>
      db.from("stock_universe").select("ticker, listing_status")
    );
    universeRows = plain.map((r) => ({ ...r, instrument_type: null }));
  }

  const active = universeRows.filter((r) => r.listing_status === "active");
  const companies = active
    .filter((r) => r.instrument_type === null || COMPANY_TYPES.has(r.instrument_type))
    .map((r) => r.ticker.toUpperCase())
    .sort();

  const byType = new Map<string, number>();
  for (const r of universeRows) {
    const key = `${r.instrument_type ?? "unclassified"}/${r.listing_status}`;
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }

  // Traded set from the latest market snapshot — the honest denominator for
  // "can we have fresh data on what actually trades".
  const { data: snap } = await db
    .from("market_snapshots")
    .select("id, snapshot_date, source_provider")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const tradedRows = snap?.id
    ? await pageAll<Row>(() => db.from("market_snapshot_items").select("ticker").eq("snapshot_id", snap.id))
    : [];
  const companySet = new Set(companies);
  const traded = [...setOf(tradedRows)].filter((t) => companySet.has(t)).sort();

  const [
    metadataRows,
    profileRows,
    quoteRows,
    techRows,
    incomeRows,
    balanceRows,
    cashRows,
    usableRatioRows,
    payoutRows,
    logsRes,
  ] = await Promise.all([
    pageAll<Row>(() => db.from("company_metadata").select("ticker")),
    pageAll<Row>(() => db.from("company_metadata").select("ticker").not("description", "is", null)),
    pageAll<Row & { as_of: string | null }>(() => db.from("market_quotes").select("ticker, as_of")),
    pageAll<Row>(() => db.from("company_technicals").select("ticker").not("as_of_date", "is", null)),
    pageAll<Row>(() => db.from("company_financials").select("ticker").eq("statement_type", "income_statement").eq("review_status", "published")),
    pageAll<Row>(() => db.from("company_financials").select("ticker").eq("statement_type", "balance_sheet").eq("review_status", "published")),
    pageAll<Row>(() => db.from("company_financials").select("ticker").eq("statement_type", "cash_flow").eq("review_status", "published")),
    pageAll<Row>(() => db.from("company_ratios").select("ticker").not("ratio_value", "is", null)),
    pageAll<Row>(() => db.from("company_payouts").select("ticker")),
    db.from("data_fetch_logs").select("ticker, section, source, status, detail, created_at").order("created_at", { ascending: false }).limit(15),
  ]);

  const sections: [string, Set<string>][] = [
    ["metadata", setOf(metadataRows)],
    ["profiles", setOf(profileRows)],
    ["quotes", setOf(quoteRows)],
    ["technicals", setOf(techRows)],
    ["income statements", setOf(incomeRows)],
    ["balance sheets", setOf(balanceRows)],
    ["cash flow statements", setOf(cashRows)],
    ["usable ratios", setOf(usableRatioRows)],
    ["payout history", setOf(payoutRows)],
  ];

  const latestQuoteDate = quoteRows.map((r) => r.as_of).filter(Boolean).sort().at(-1) ?? null;

  console.log("Data quality audit");
  console.log("==================");
  console.log(`Universe rows: ${universeRows.length} (${active.length} active)`);
  console.log(`Active companies (equity + modaraba): ${companies.length}`);
  console.log(`Latest snapshot: ${snap?.snapshot_date ?? "none"} (${snap?.source_provider ?? "n/a"}) — ${traded.length} traded companies`);
  console.log(`Latest quote date seen: ${latestQuoteDate ?? "none"}`);
  console.log("");
  console.log("Universe by instrument_type/status");
  for (const [key, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${n}`);
  console.log("");
  console.log(`Coverage (of ${companies.length} active companies | of ${traded.length} traded)`);
  const missingBySection = new Map<string, string[]>();
  for (const [label, present] of sections) {
    const c1 = companies.filter((t) => present.has(t)).length;
    const c2 = traded.filter((t) => present.has(t)).length;
    missingBySection.set(label, traded.filter((t) => !present.has(t)));
    const p1 = ((c1 / (companies.length || 1)) * 100).toFixed(1);
    const p2 = ((c2 / (traded.length || 1)) * 100).toFixed(1);
    console.log(`- ${label}: ${c1}/${companies.length} (${p1}%) | traded ${c2}/${traded.length} (${p2}%)`);
  }
  console.log("");
  console.log("Traded companies missing data (first 25 each)");
  for (const [label, missing] of missingBySection) {
    if (missing.length === 0) continue;
    console.log(`- ${label} (${missing.length}): ${missing.slice(0, 25).join(", ")}`);
  }
  console.log("");
  console.log("Recent fetch logs");
  for (const log of logsRes.data ?? []) {
    console.log(`- ${log.created_at} ${log.ticker ?? "*"} ${log.section}/${log.source}: ${log.status}${log.detail ? ` - ${log.detail}` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
