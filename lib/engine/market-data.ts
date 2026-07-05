import { createAdminClient } from "@/lib/supabase/admin";
import { providerConfigs, psxTerminalConfig, type ProviderName } from "@/lib/providers/env";
import { RateLimitError, symbolVariants, type ProviderQuote, type ProviderHistory } from "@/lib/providers/types";
import {
  psxDpsQuote,
  psxDpsHistory,
  psxTerminalQuote,
  twelveDataQuote,
  twelveDataHistory,
  finnhubQuote,
  alphaVantageQuote,
  alphaVantageHistory,
} from "@/lib/providers/adapters";

/**
 * Market-data engine: layered fallback across providers, normalized writes to
 * market_quotes / company_price_history, provider health + symbol-map
 * bookkeeping. Every failure is recorded and skipped — one dead provider never
 * breaks the chain, and the UI only ever reads the normalized tables.
 */

function admin() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
}

async function recordStatus(provider: string, ok: boolean, error?: string, rateLimited = false) {
  const db = admin();
  if (!db) return;
  const now = new Date().toISOString();
  try {
    await db.from("data_provider_status").upsert(
      {
        provider,
        configured: providerConfigs().find((p) => p.name === provider)?.configured ?? true,
        healthy: ok,
        ...(ok ? { last_success_at: now, rate_limited: false } : { last_error_at: now, last_error: error ?? "unknown", rate_limited: rateLimited }),
        updated_at: now,
      },
      { onConflict: "provider" }
    );
  } catch {
    /* best-effort */
  }
}

async function recordSymbol(ticker: string, provider: string, symbol: string | null, works: boolean, caps: Record<string, boolean>, detail?: string) {
  const db = admin();
  if (!db) return;
  try {
    await db.from("provider_symbol_map").upsert(
      {
        ticker: ticker.toUpperCase(),
        provider,
        provider_symbol: symbol,
        works,
        capabilities: caps,
        last_tested_at: new Date().toISOString(),
        detail: detail ?? null,
      },
      { onConflict: "ticker,provider" }
    );
  } catch {
    /* best-effort */
  }
}

async function logFetch(ticker: string, section: string, source: string, status: "ok" | "empty" | "error", rows?: number, detail?: string) {
  const db = admin();
  if (!db) return;
  try {
    await db.from("data_fetch_logs").insert({ ticker: ticker.toUpperCase(), section, source, status, rows: rows ?? null, detail: detail?.slice(0, 300) ?? null });
  } catch {
    /* best-effort */
  }
}

type QuoteAttempt = { provider: ProviderName; run: () => Promise<ProviderQuote | null> };

function quoteChain(ticker: string): QuoteAttempt[] {
  const t = ticker.toUpperCase();
  const chain: QuoteAttempt[] = [];
  if (psxTerminalConfig().enabled) chain.push({ provider: "psx-terminal", run: () => psxTerminalQuote(t) });
  chain.push({ provider: "psx-dps", run: () => psxDpsQuote(t) });
  chain.push({ provider: "twelve-data", run: () => twelveDataQuote(t) });
  chain.push({
    provider: "finnhub",
    run: async () => {
      for (const sym of symbolVariants(t, "finnhub")) {
        const q = await finnhubQuote(t, sym);
        if (q) return q;
      }
      return null;
    },
  });
  chain.push({
    provider: "alpha-vantage",
    run: async () => {
      for (const sym of symbolVariants(t, "alpha-vantage")) {
        const q = await alphaVantageQuote(t, sym);
        if (q) return q;
      }
      return null;
    },
  });
  return chain;
}

/**
 * Best-available quote for a ticker, walking the provider chain. Persists the
 * winner to market_quotes and updates symbol-map/provider-status as a side
 * effect. Returns null only when every provider came up empty.
 */
export async function refreshQuote(ticker: string): Promise<ProviderQuote | null> {
  const t = ticker.toUpperCase();

  for (const attempt of quoteChain(t)) {
    try {
      const q = await attempt.run();
      if (!q) {
        await recordSymbol(t, attempt.provider, null, false, { quote: false }, "no quote coverage");
        continue;
      }
      await Promise.all([
        persistQuote(t, q),
        recordStatus(attempt.provider, true),
        recordSymbol(t, attempt.provider, q.providerSymbol, true, { quote: true }),
        logFetch(t, "quote", attempt.provider, "ok", 1),
      ]);
      return q;
    } catch (err) {
      const rateLimited = err instanceof RateLimitError;
      await recordStatus(attempt.provider, false, err instanceof Error ? err.message : String(err), rateLimited);
      await logFetch(t, "quote", attempt.provider, "error", 0, err instanceof Error ? err.message : String(err));
    }
  }

  await logFetch(t, "quote", "all", "empty", 0, "no provider has coverage");
  return null;
}

async function persistQuote(ticker: string, q: ProviderQuote) {
  const db = admin();
  if (!db) return;
  const dayChange = q.prevClose !== null ? q.price - q.prevClose : null;
  await db.from("market_quotes").upsert(
    {
      ticker,
      price: q.price,
      prev_close: q.prevClose,
      day_change: dayChange,
      day_change_pct: q.prevClose ? ((q.price - q.prevClose) / q.prevClose) * 100 : null,
      open: q.open,
      high: q.high,
      low: q.low,
      volume: q.volume,
      as_of: q.asOf,
      as_of_time: q.asOfTime,
      provider: q.provider,
      provider_symbol: q.providerSymbol,
      is_realtime: q.isRealtime,
      last_fetched_at: new Date().toISOString(),
    },
    { onConflict: "ticker" }
  );
}

/**
 * Best-available daily history (oldest first). PSX portal first (deepest PSX
 * coverage), then Twelve Data, then Alpha Vantage. Persists candles to the
 * shared company_price_history table.
 */
export async function refreshHistory(ticker: string): Promise<ProviderHistory | null> {
  const t = ticker.toUpperCase();
  const attempts: { provider: ProviderName; run: () => Promise<ProviderHistory | null> }[] = [
    { provider: "psx-dps", run: () => psxDpsHistory(t) },
    { provider: "twelve-data", run: () => twelveDataHistory(t) },
    {
      provider: "alpha-vantage",
      run: async () => {
        for (const sym of symbolVariants(t, "alpha-vantage")) {
          const h = await alphaVantageHistory(t, sym);
          if (h) return h;
        }
        return null;
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const h = await attempt.run();
      if (!h || h.candles.length === 0) {
        await recordSymbol(t, attempt.provider, null, false, { history: false }, "no history coverage");
        continue;
      }
      const db = admin();
      if (db) {
        const recent = h.candles.slice(-1300);
        const now = new Date().toISOString();
        await db.from("company_price_history").upsert(
          recent.map((c) => ({ ticker: t, price_date: c.date, close: c.close, volume: c.volume, source: h.provider, updated_at: now })),
          { onConflict: "ticker,price_date" }
        );
      }
      await Promise.all([
        recordStatus(attempt.provider, true),
        recordSymbol(t, attempt.provider, h.providerSymbol, true, { history: true }),
        logFetch(t, "history", attempt.provider, "ok", h.candles.length),
      ]);
      return h;
    } catch (err) {
      const rateLimited = err instanceof RateLimitError;
      await recordStatus(attempt.provider, false, err instanceof Error ? err.message : String(err), rateLimited);
      await logFetch(t, "history", attempt.provider, "error", 0, err instanceof Error ? err.message : String(err));
    }
  }
  await logFetch(t, "history", "all", "empty", 0, "no provider has coverage");
  return null;
}

/**
 * Diagnostic: probe every provider for a ticker and persist what works where.
 * Used by the coverage dashboard and the per-ticker "test coverage" action.
 */
export async function testProviderCoverage(ticker: string): Promise<
  { provider: string; symbol: string | null; quote: boolean; history: boolean; error?: string }[]
> {
  const t = ticker.toUpperCase();
  const results: { provider: string; symbol: string | null; quote: boolean; history: boolean; error?: string }[] = [];

  const probes: { provider: ProviderName; quote: () => Promise<ProviderQuote | null>; history?: () => Promise<ProviderHistory | null> }[] = [
    ...(psxTerminalConfig().enabled ? [{ provider: "psx-terminal" as const, quote: () => psxTerminalQuote(t) }] : []),
    { provider: "psx-dps", quote: () => psxDpsQuote(t), history: () => psxDpsHistory(t) },
    { provider: "twelve-data", quote: () => twelveDataQuote(t), history: () => twelveDataHistory(t) },
    {
      provider: "finnhub",
      quote: async () => {
        for (const sym of symbolVariants(t, "finnhub")) {
          const q = await finnhubQuote(t, sym);
          if (q) return q;
        }
        return null;
      },
    },
    {
      provider: "alpha-vantage",
      quote: async () => {
        for (const sym of symbolVariants(t, "alpha-vantage")) {
          const q = await alphaVantageQuote(t, sym);
          if (q) return q;
        }
        return null;
      },
      history: async () => {
        for (const sym of symbolVariants(t, "alpha-vantage")) {
          const h = await alphaVantageHistory(t, sym);
          if (h) return h;
        }
        return null;
      },
    },
  ];

  for (const probe of probes) {
    const r = { provider: probe.provider as string, symbol: null as string | null, quote: false, history: false, error: undefined as string | undefined };
    try {
      const q = await probe.quote();
      if (q) {
        r.quote = true;
        r.symbol = q.providerSymbol;
      }
      if (probe.history) {
        const h = await probe.history();
        if (h && h.candles.length > 0) {
          r.history = true;
          r.symbol = r.symbol ?? h.providerSymbol;
        }
      }
      await recordStatus(probe.provider, true);
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      await recordStatus(probe.provider, false, r.error, err instanceof RateLimitError);
    }
    await recordSymbol(t, probe.provider, r.symbol, r.quote || r.history, { quote: r.quote, history: r.history }, r.error);
    results.push(r);
  }

  // Roll the result up into the universe coverage map.
  const db = admin();
  if (db) {
    const hasQuote = results.some((r) => r.quote);
    const hasHistory = results.some((r) => r.history);
    await db
      .from("stock_universe")
      .update({ coverage: { quote: hasQuote, history: hasHistory }, last_updated: new Date().toISOString() })
      .eq("ticker", t);
  }

  return results;
}
