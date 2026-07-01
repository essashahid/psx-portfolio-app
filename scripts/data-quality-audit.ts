import { createAdminClient } from "@/lib/supabase/admin";
import { loadEnvLocal } from "./load-env";

type Row = { ticker: string };
type PagedQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

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

function missingFrom(universe: string[], present: Set<string>, limit = 30): string[] {
  return universe.filter((ticker) => !present.has(ticker)).slice(0, limit);
}

async function main() {
  loadEnvLocal();
  const db = createAdminClient();

  const [
    universeRows,
    masterRows,
    metadataRows,
    profileRows,
    quoteRows,
    techRows,
    financialRows,
    incomeRows,
    balanceRows,
    cashRows,
    ratioRows,
    usableRatioRows,
    payoutRows,
    snapshotRes,
    logsRes,
  ] = await Promise.all([
    pageAll<Row>(() => db.from("stock_universe").select("ticker").eq("listing_status", "active")),
    pageAll<Row>(() => db.from("stock_master").select("ticker")),
    pageAll<Row>(() => db.from("company_metadata").select("ticker")),
    pageAll<Row>(() => db.from("company_metadata").select("ticker").not("description", "is", null)),
    pageAll<Row & { as_of: string | null; last_fetched_at: string | null }>(() => db.from("market_quotes").select("ticker, as_of, last_fetched_at")),
    pageAll<Row & { as_of_date: string | null; updated_at: string | null }>(() => db.from("company_technicals").select("ticker, as_of_date, updated_at").not("as_of_date", "is", null)),
    pageAll<Row>(() => db.from("company_financials").select("ticker")),
    pageAll<Row>(() => db.from("company_financials").select("ticker").eq("statement_type", "income_statement")),
    pageAll<Row>(() => db.from("company_financials").select("ticker").eq("statement_type", "balance_sheet")),
    pageAll<Row>(() => db.from("company_financials").select("ticker").eq("statement_type", "cash_flow")),
    pageAll<Row>(() => db.from("company_ratios").select("ticker")),
    pageAll<Row>(() => db.from("company_ratios").select("ticker").not("ratio_value", "is", null)),
    pageAll<Row>(() => db.from("company_payouts").select("ticker")),
    db.from("market_snapshots").select("snapshot_date, snapshot_time, source_provider").eq("market", "PSX").order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
    db.from("data_fetch_logs").select("ticker, section, source, status, detail, created_at").order("created_at", { ascending: false }).limit(20),
  ]);

  const universe = [...setOf(universeRows)].sort();
  const denominator = universe.length || 1;

  const sets = {
    master: setOf(masterRows),
    metadata: setOf(metadataRows),
    profiles: setOf(profileRows),
    quotes: setOf(quoteRows),
    technicals: setOf(techRows),
    financials: setOf(financialRows),
    income: setOf(incomeRows),
    balance: setOf(balanceRows),
    cash: setOf(cashRows),
    ratios: setOf(ratioRows),
    usableRatios: setOf(usableRatioRows),
    payouts: setOf(payoutRows),
  };

  const covered = (present: Set<string>) => universe.filter((ticker) => present.has(ticker)).length;
  const pct = (n: number) => `${((n / denominator) * 100).toFixed(1)}%`;
  const latestQuoteDates = quoteRows
    .map((row) => row.as_of)
    .filter((value): value is string => Boolean(value));
  const quoteDate = latestQuoteDates.sort().at(-1) ?? null;

  console.log("Data quality audit");
  console.log("==================");
  console.log(`Universe active tickers: ${universe.length}`);
  console.log(`Latest market snapshot: ${snapshotRes.data?.snapshot_date ?? "none"} (${snapshotRes.data?.source_provider ?? "n/a"})`);
  console.log(`Latest quote date seen: ${quoteDate ?? "none"}`);
  console.log("");
  console.log("Coverage");
  console.log(`- stock_master identity: ${covered(sets.master)}/${universe.length} (${pct(covered(sets.master))})`);
  console.log(`- company_metadata rows: ${covered(sets.metadata)}/${universe.length} (${pct(covered(sets.metadata))})`);
  console.log(`- generated profiles: ${covered(sets.profiles)}/${universe.length} (${pct(covered(sets.profiles))})`);
  console.log(`- market quotes: ${covered(sets.quotes)}/${universe.length} (${pct(covered(sets.quotes))})`);
  console.log(`- technical history: ${covered(sets.technicals)}/${universe.length} (${pct(covered(sets.technicals))})`);
  console.log(`- any financial rows: ${covered(sets.financials)}/${universe.length} (${pct(covered(sets.financials))})`);
  console.log(`- income statements: ${covered(sets.income)}/${universe.length} (${pct(covered(sets.income))})`);
  console.log(`- balance sheets: ${covered(sets.balance)}/${universe.length} (${pct(covered(sets.balance))})`);
  console.log(`- cash flow statements: ${covered(sets.cash)}/${universe.length} (${pct(covered(sets.cash))})`);
  console.log(`- usable ratios: ${covered(sets.usableRatios)}/${universe.length} (${pct(covered(sets.usableRatios))})`);
  console.log(`- payout history: ${covered(sets.payouts)}/${universe.length} (${pct(covered(sets.payouts))})`);
  console.log("");
  console.log("Missing samples");
  console.log(`- profiles: ${missingFrom(universe, sets.profiles).join(", ") || "none"}`);
  console.log(`- quotes: ${missingFrom(universe, sets.quotes).join(", ") || "none"}`);
  console.log(`- technicals: ${missingFrom(universe, sets.technicals).join(", ") || "none"}`);
  console.log(`- income statements: ${missingFrom(universe, sets.income).join(", ") || "none"}`);
  console.log(`- usable ratios: ${missingFrom(universe, sets.usableRatios).join(", ") || "none"}`);
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
