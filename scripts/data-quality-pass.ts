import { createAdminClient } from "@/lib/supabase/admin";
import { loadEnvLocal } from "./load-env";
import { fetchPsxSymbols } from "@/lib/market-data/psx-dps";
import { buildMarketSnapshot } from "@/lib/market/snapshot";
import { refreshTechnicals } from "@/lib/company/technicals";
import { refreshQuote } from "@/lib/engine/market-data";
import { populateCheapFundamentals } from "@/lib/engine/fundamentals";
import { refreshRatios } from "@/lib/engine/ratios";
import { buildExchangeSourcedProfile } from "@/lib/company/profile";

type Args = {
  all: boolean;
  syncUniverse: boolean;
  snapshot: boolean;
  profiles: boolean;
  quotes: number;
  technicals: number;
  fundamentals: number;
  ratios: number;
  concurrency: number;
};
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

function readArgs(): Args {
  const args = new Map<string, string | boolean>();
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--") && raw.includes("=")) {
      const [key, value] = raw.slice(2).split("=", 2);
      args.set(key, value);
    } else if (raw.startsWith("--")) {
      args.set(raw.slice(2), true);
    }
  }
  const all = args.has("all");
  const num = (key: string, fallback: number) => {
    const value = Number(args.get(key) ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    all,
    syncUniverse: !args.has("no-sync-universe"),
    snapshot: !args.has("no-snapshot"),
    profiles: !args.has("no-profiles"),
    quotes: all ? Number.MAX_SAFE_INTEGER : Math.max(0, num("quotes", 300)),
    technicals: all ? Number.MAX_SAFE_INTEGER : Math.max(0, num("technicals", 120)),
    fundamentals: all ? Number.MAX_SAFE_INTEGER : Math.max(0, num("fundamentals", 120)),
    ratios: all ? Number.MAX_SAFE_INTEGER : Math.max(0, num("ratios", 300)),
    concurrency: Math.max(1, Math.min(10, num("concurrency", 5))),
  };
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      out.push(await worker(item));
    }
  });
  await Promise.all(runners);
  return out;
}

async function syncUniverse() {
  const db = createAdminClient();
  const directory = await fetchPsxSymbols();
  const now = new Date().toISOString();
  const rows = [...directory.entries()].map(([ticker, info]) => ({
    ticker,
    company_name: info.name,
    psx_name: info.name,
    sector: info.sector || null,
    listing_status: "active",
    last_updated: now,
  }));
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await db.from("stock_universe").upsert(chunk, { onConflict: "ticker" });
    await db.from("stock_master").upsert(
      chunk.map((row) => ({ ticker: row.ticker, company_name: row.company_name, sector: row.sector })),
      { onConflict: "ticker" }
    );
  }
  return rows.length;
}

async function activeUniverse(): Promise<string[]> {
  const db = createAdminClient();
  const data = await pageAll<{ ticker: string }>(() => db.from("stock_universe").select("ticker").eq("listing_status", "active"));
  return [...new Set(data.map((row) => String(row.ticker).toUpperCase()))].sort();
}

async function missingOrOldest(table: string, tickers: string[], limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  if (limit >= tickers.length) return tickers;
  const db = createAdminClient();
  const updated = new Map<string, string>();
  for (let i = 0; i < tickers.length; i += 500) {
    const chunk = tickers.slice(i, i + 500);
    const { data } = await db.from(table).select("ticker, updated_at, last_fetched_at").in("ticker", chunk);
    for (const row of data ?? []) {
      updated.set(String(row.ticker).toUpperCase(), String(row.updated_at ?? row.last_fetched_at ?? ""));
    }
  }
  return [...tickers]
    .sort((a, b) => (updated.get(a) ?? "").localeCompare(updated.get(b) ?? ""))
    .slice(0, limit);
}

async function missingUsableRatios(tickers: string[], limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const db = createAdminClient();
  const present = new Set<string>();
  for (let i = 0; i < tickers.length; i += 500) {
    const chunk = tickers.slice(i, i + 500);
    const { data } = await db.from("company_ratios").select("ticker").not("ratio_value", "is", null).in("ticker", chunk);
    for (const row of data ?? []) present.add(String(row.ticker).toUpperCase());
  }
  const missing = tickers.filter((ticker) => !present.has(ticker));
  return (limit >= missing.length ? missing : missing.slice(0, limit));
}

async function generateProfiles(tickers: string[]) {
  const db = createAdminClient();
  let written = 0;
  for (let i = 0; i < tickers.length; i += 400) {
    const chunk = tickers.slice(i, i + 400);
    const [{ data: universe }, { data: metadata }] = await Promise.all([
      db.from("stock_universe").select("ticker, company_name, sector, industry, exchange, face_value").in("ticker", chunk),
      db.from("company_metadata").select("ticker, face_value, website").in("ticker", chunk),
    ]);
    const existing = new Map((metadata ?? []).map((row) => [String(row.ticker).toUpperCase(), row]));
    const rows = (universe ?? []).map((row) => {
      const t = String(row.ticker).toUpperCase();
      const meta = existing.get(t);
      const profile = buildExchangeSourcedProfile({
        ticker: t,
        companyName: row.company_name,
        sector: row.sector,
        industry: row.industry,
        exchange: row.exchange,
        faceValue: Number(row.face_value ?? meta?.face_value) || null,
      });
      return {
        ticker: t,
        company_name: row.company_name,
        sector: row.sector,
        industry: profile.industry ?? row.industry,
        exchange: profile.exchange,
        face_value: row.face_value ?? meta?.face_value ?? null,
        website: meta?.website ?? null,
        description: profile.description,
        business_lines: profile.business_lines ?? null,
        source: "psx-directory",
        confidence: 0.9,
        last_fetched_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
    });
    if (rows.length) {
      const { error } = await db.from("company_metadata").upsert(rows, { onConflict: "ticker" });
      if (error) throw error;
      await db.from("stock_master").upsert(
        rows
          .filter((row) => row.company_name)
          .map((row) => ({ ticker: row.ticker, company_name: row.company_name, sector: row.sector })),
        { onConflict: "ticker" }
      );
      written += rows.length;
    }
  }
  return written;
}

async function main() {
  loadEnvLocal();
  const args = readArgs();
  const db = createAdminClient();

  console.log("Starting data-quality pass");
  console.log(JSON.stringify(args));

  if (args.syncUniverse) {
    const synced = await syncUniverse();
    console.log(`Universe synced: ${synced}`);
  }

  const tickers = await activeUniverse();
  console.log(`Active universe: ${tickers.length}`);

  if (args.profiles) {
    const written = await generateProfiles(tickers);
    console.log(`Profiles generated: ${written}`);
  }

  if (args.snapshot) {
    const snap = await buildMarketSnapshot(db);
    console.log(`Market snapshot: ${snap.items} items, index=${snap.index ?? "n/a"}, errors=${snap.errors.join("; ") || "none"}`);
  }

  const quoteQueue = await missingOrOldest("market_quotes", tickers, Math.min(args.quotes, tickers.length));
  if (quoteQueue.length) {
    let ok = 0;
    await runPool(quoteQueue, args.concurrency, async (ticker) => {
      const result = await refreshQuote(ticker).catch(() => null);
      if (result?.price != null) ok++;
    });
    console.log(`Quotes refreshed: ${ok}/${quoteQueue.length}`);
  }

  const technicalQueue = await missingOrOldest("company_technicals", tickers, Math.min(args.technicals, tickers.length));
  if (technicalQueue.length) {
    let ok = 0;
    await runPool(technicalQueue, args.concurrency, async (ticker) => {
      const result = await refreshTechnicals(ticker).catch(() => null);
      if (result?.asOfDate) ok++;
    });
    console.log(`Technicals refreshed: ${ok}/${technicalQueue.length}`);
  }

  const fundamentalsQueue = await missingOrOldest("company_payouts", tickers, Math.min(args.fundamentals, tickers.length));
  if (fundamentalsQueue.length) {
    let pageRows = 0;
    let payouts = 0;
    let usable = 0;
    await runPool(fundamentalsQueue, Math.min(args.concurrency, 5), async (ticker) => {
      const result = await populateCheapFundamentals(ticker, db).catch(() => null);
      pageRows += result?.pagePeriods ?? 0;
      payouts += result?.payouts ?? 0;
      usable += result?.ratios?.available ?? 0;
    });
    console.log(`Cheap fundamentals refreshed: ${fundamentalsQueue.length} tickers, page periods=${pageRows}, payouts=${payouts}, usable ratio rows=${usable}`);
  }

  const ratioQueue = await missingUsableRatios(tickers, Math.min(args.ratios, tickers.length));
  if (ratioQueue.length) {
    let ok = 0;
    await runPool(ratioQueue, args.concurrency, async (ticker) => {
      const result = await refreshRatios(db, ticker).catch(() => null);
      if (result) ok++;
    });
    console.log(`Ratios recomputed for missing usable-ratio tickers: ${ok}/${ratioQueue.length}`);
  }

  console.log("Data-quality pass complete. Run `npx tsx scripts/data-quality-audit.ts` for coverage.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
