import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import type { StockRow, StocksResponse } from "@psx/shared/api/stocks";

/**
 * A screener page, for the phone.
 *
 * /api/stocks pages the whole universe plus every published ratio into memory
 * and slices afterwards. On the desk that is tolerable; measured from the
 * emulator it took 39 seconds, which is not a screen anyone waits for. This
 * asks the database for one page, ordered and filtered there, then reads
 * ratios only for the tickers on that page.
 */
const PAGE_MAX = 60;

export async function GET(request: Request) {
  const { supabase, error } = await requireUser();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const sector = url.searchParams.get("sector");
    const sort = url.searchParams.get("sort") ?? "marketCap";
    const limit = Math.max(1, Math.min(PAGE_MAX, Number(url.searchParams.get("limit") ?? 40)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    // Narrow by name or sector first: those live on stock_master, and a search
    // should look at the whole universe rather than only the priced part.
    let tickerFilter: string[] | null = null;
    if (q || sector) {
      let master = supabase.from("stock_master").select("ticker").limit(400);
      if (sector) master = master.eq("sector", sector);
      if (q) master = master.or(`ticker.ilike.%${q}%,company_name.ilike.%${q}%`);
      const { data } = await master;
      tickerFilter = (data ?? []).map((r) => r.ticker as string);
      if (tickerFilter.length === 0) {
        return NextResponse.json({ total: 0, returned: 0, offset, stocks: [] } satisfies StocksResponse);
      }
    }

    let quotes = supabase
      .from("market_quotes")
      .select("ticker, price, market_cap, day_change_pct, as_of", { count: "exact" });
    if (tickerFilter) quotes = quotes.in("ticker", tickerFilter);
    quotes =
      sort === "ticker"
        ? quotes.order("ticker", { ascending: true })
        : quotes.order("market_cap", { ascending: false, nullsFirst: false });

    const { data: quoteRows, count } = await quotes.range(offset, offset + limit - 1);
    const tickers = (quoteRows ?? []).map((r) => r.ticker as string);
    if (tickers.length === 0) {
      return NextResponse.json({ total: count ?? 0, returned: 0, offset, stocks: [] } satisfies StocksResponse);
    }

    // Names and ratios for this page only.
    const [{ data: masters }, { data: ratios }] = await Promise.all([
      supabase.from("stock_master").select("ticker, company_name, sector").in("ticker", tickers),
      supabase
        .from("company_ratios")
        .select("ticker, ratio_name, ratio_value, inputs, source_period")
        .in("ticker", tickers)
        .in("ratio_name", ["P/E", "P/B", "Dividend yield"]),
    ]);

    type RatioRow = {
      ticker: string;
      ratio_name: string;
      ratio_value: number | null;
      inputs: { eps?: number } | null;
      source_period: string | null;
    };

    const masterBy = new Map((masters ?? []).map((m) => [m.ticker as string, m]));
    const ratioBy = new Map<string, Map<string, RatioRow>>();
    for (const r of (ratios ?? []) as unknown as RatioRow[]) {
      const key = r.ticker;
      if (!ratioBy.has(key)) ratioBy.set(key, new Map());
      ratioBy.get(key)!.set(r.ratio_name, r);
    }

    const round = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(4)) : null;

    let stocks: StockRow[] = (quoteRows ?? []).map((quote) => {
      const ticker = quote.ticker as string;
      const master = masterBy.get(ticker);
      const rs = ratioBy.get(ticker);
      const pe = rs?.get("P/E");
      return {
        ticker,
        name: (master?.company_name as string | null) ?? null,
        sector: (master?.sector as string | null) ?? null,
        price: round(quote.price),
        dayChangePct: round(quote.day_change_pct),
        marketCap: (quote.market_cap as number | null) ?? null,
        asOf: (quote.as_of as string | null) ?? null,
        pe: round(pe?.ratio_value),
        eps: round(pe?.inputs?.eps),
        pb: round(rs?.get("P/B")?.ratio_value),
        dividendYield: round(rs?.get("Dividend yield")?.ratio_value),
        basis: (pe?.source_period as string | null) ?? null,
        // Hand verification is a desk concern; the phone does not surface it.
        verified: "unverified",
      };
    });

    // P/E is not a column on market_quotes, so it is ordered within the page.
    // The page is still the largest companies, which is the set worth ranking.
    if (sort === "pe") {
      stocks = stocks.sort((a, b) => (a.pe ?? Infinity) - (b.pe ?? Infinity));
    }

    const body: StocksResponse = {
      total: count ?? stocks.length,
      returned: stocks.length,
      offset,
      stocks,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
