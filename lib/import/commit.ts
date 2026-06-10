import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedRow, StatementType } from "@/lib/types";
import { recomputeHoldingsFromTransactions } from "@/lib/portfolio";

export interface CommitResult {
  committed: number;
  duplicates: number;
  holdingsTouched: string[];
  pricesUpdated: number;
  message: string;
}

interface CommitRow {
  id: string;
  row_hash: string;
  normalized: NormalizedRow;
}

/**
 * Applies the confirmed rows of an import batch to the portfolio.
 * Row-hash duplicate protection: a row already committed (any prior batch) is
 * skipped, so re-importing the same statement never double-counts.
 */
export async function commitBatch(
  supabase: SupabaseClient,
  userId: string,
  batchId: string,
  statementType: StatementType,
  rows: CommitRow[]
): Promise<CommitResult> {
  const tickers = [
    ...new Set(rows.map((r) => r.normalized.ticker).filter((t): t is string => !!t)),
  ];
  const { data: master } = tickers.length
    ? await supabase
        .from("stock_master")
        .select("ticker, company_name, sector")
        .in("ticker", tickers)
    : { data: [] as { ticker: string; company_name: string; sector: string | null }[] };
  const masterMap = new Map((master ?? []).map((m) => [m.ticker, m]));

  let committed = 0;
  let duplicates = 0;
  let pricesUpdated = 0;
  const holdingsTouched = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  if (statementType === "holdings") {
    // Snapshot semantics: statement quantity/avg-cost wins. No trade history invented.
    for (const row of rows) {
      const n = row.normalized;
      if (!n.ticker || n.quantity == null) continue;
      const m = masterMap.get(n.ticker);
      const avgCost = n.avg_cost ?? (n.total_cost != null && n.quantity > 0 ? n.total_cost / n.quantity : 0);
      const { error } = await supabase.from("holdings").upsert(
        {
          user_id: userId,
          ticker: n.ticker,
          company_name: n.company_name ?? m?.company_name ?? null,
          sector: n.sector ?? m?.sector ?? null,
          quantity: n.quantity,
          avg_cost: avgCost,
          total_cost: n.total_cost ?? n.quantity * avgCost,
          source: "statement_snapshot",
          last_updated: new Date().toISOString(),
        },
        { onConflict: "user_id,ticker" }
      );
      if (error) throw error;
      committed++;
      holdingsTouched.add(n.ticker);

      if (n.market_price != null && n.market_price > 0) {
        const { error: pErr } = await supabase.from("prices").upsert(
          {
            user_id: userId,
            ticker: n.ticker,
            price: n.market_price,
            price_date: n.trade_date ?? today,
            source: "statement",
          },
          { onConflict: "user_id,ticker,price_date" }
        );
        if (!pErr) pricesUpdated++;
      }
    }
    return {
      committed,
      duplicates,
      holdingsTouched: [...holdingsTouched],
      pricesUpdated,
      message: `Holdings snapshot applied: ${committed} position(s) updated${pricesUpdated ? `, ${pricesUpdated} price(s) captured from statement` : ""}.`,
    };
  }

  if (statementType === "trades") {
    const hashes = rows.map((r) => r.row_hash);
    const { data: existing } = hashes.length
      ? await supabase.from("transactions").select("row_hash").eq("user_id", userId).in("row_hash", hashes)
      : { data: [] };
    const existingHashes = new Set((existing ?? []).map((e) => e.row_hash));

    for (const row of rows) {
      const n = row.normalized;
      if (!n.ticker) continue;
      if (existingHashes.has(row.row_hash)) {
        duplicates++;
        continue;
      }
      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        batch_id: batchId,
        ticker: n.ticker,
        trade_date: n.trade_date ?? null,
        settlement_date: n.settlement_date ?? null,
        type: n.type ?? "UNKNOWN",
        quantity: n.quantity ?? null,
        price: n.price ?? n.avg_cost ?? null,
        gross_amount: n.gross_amount ?? null,
        commission: n.commission ?? null,
        tax: n.tax ?? null,
        net_amount: n.net_amount ?? null,
        row_hash: row.row_hash,
        source: "import",
      });
      if (error) throw error;
      committed++;
      holdingsTouched.add(n.ticker);
      existingHashes.add(row.row_hash);

      // Dividend rows inside a trade file also land in the dividends table
      if (n.type === "DIVIDEND") {
        await supabase.from("dividends").insert({
          user_id: userId,
          batch_id: batchId,
          ticker: n.ticker,
          pay_date: n.trade_date ?? null,
          amount: n.dividend_amount ?? n.gross_amount ?? n.net_amount ?? 0,
          tax: n.tax ?? null,
          net_amount: n.net_amount ?? null,
          row_hash: row.row_hash,
        });
      }
    }
    await recomputeHoldingsFromTransactions(supabase, userId);
    return {
      committed,
      duplicates,
      holdingsTouched: [...holdingsTouched],
      pricesUpdated,
      message: `${committed} transaction(s) imported, ${duplicates} duplicate(s) skipped. Holdings recalculated with weighted average cost.`,
    };
  }

  // dividends / cash statement (also the fallback for generic)
  const hashes = rows.map((r) => r.row_hash);
  const { data: existingDiv } = hashes.length
    ? await supabase.from("dividends").select("row_hash").eq("user_id", userId).in("row_hash", hashes)
    : { data: [] };
  const { data: existingCash } = hashes.length
    ? await supabase.from("cash_movements").select("row_hash").eq("user_id", userId).in("row_hash", hashes)
    : { data: [] };
  const seen = new Set([
    ...(existingDiv ?? []).map((e) => e.row_hash),
    ...(existingCash ?? []).map((e) => e.row_hash),
  ]);

  for (const row of rows) {
    const n = row.normalized;
    if (seen.has(row.row_hash)) {
      duplicates++;
      continue;
    }
    const amount = n.dividend_amount ?? n.net_amount ?? n.gross_amount;
    const type = n.type ?? "UNKNOWN";

    if (n.dividend_amount != null || type === "DIVIDEND") {
      if (amount == null) continue;
      const { error } = await supabase.from("dividends").insert({
        user_id: userId,
        batch_id: batchId,
        ticker: n.ticker ?? null,
        pay_date: n.trade_date ?? null,
        amount,
        tax: n.tax ?? null,
        net_amount: n.net_amount ?? null,
        row_hash: row.row_hash,
        notes: n.description ?? null,
      });
      if (error) throw error;
      committed++;
      if (n.ticker) holdingsTouched.add(n.ticker);
    } else if (amount != null) {
      const { error } = await supabase.from("cash_movements").insert({
        user_id: userId,
        batch_id: batchId,
        movement_date: n.trade_date ?? null,
        type: ["CASH_IN", "CASH_OUT", "FEE", "TAX"].includes(type) ? type : amount >= 0 ? "CASH_IN" : "CASH_OUT",
        amount,
        description: n.description ?? null,
        row_hash: row.row_hash,
      });
      if (error) throw error;
      committed++;
    }
    seen.add(row.row_hash);
  }

  return {
    committed,
    duplicates,
    holdingsTouched: [...holdingsTouched],
    pricesUpdated,
    message: `${committed} dividend/cash record(s) imported, ${duplicates} duplicate(s) skipped.`,
  };
}
