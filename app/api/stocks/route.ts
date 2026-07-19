import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { verificationStatus } from "@/lib/engine/verified";

export const maxDuration = 60;

/**
 * GET /api/stocks — the universe index.
 *
 * One row per live company with the headline numbers and, critically, the
 * provenance of each: which period the valuation rests on and whether the
 * company has been cross-checked against an external source. A consumer that
 * cannot see "this P/E is computed from a 2024 annual" will present a stale
 * number as a current one, which is the failure this endpoint exists to
 * prevent.
 *
 *   ?sector=Cement        filter by sector
 *   ?verified=1           only hand-verified companies
 *   ?q=luck               ticker/name search
 *   ?limit=50&offset=0    paging (default 100, max 500)
 *   ?sort=marketCap|ticker|pe   (default marketCap desc)
 *
 *   {
 *     "total": 474,
 *     "returned": 100,
 *     "stocks": [
 *       { "ticker": "OGDC", "name": "...", "sector": "Oil & Gas Exploration Companies",
 *         "price": 348.72, "marketCap": 1.5e12,
 *         "pe": 9.64, "eps": 36.17, "pb": 1.07, "dividendYield": 4.59,
 *         "basis": "TTM to 2026 9M", "verified": "verified" }
 *     ]
 *   }
 */
const round = (v: unknown, dp = 2): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(dp)) : null;
};

export async function GET(request: Request) {
  const { supabase, error } = await requireUser();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const sector = url.searchParams.get("sector");
    const onlyVerified = url.searchParams.get("verified") === "1";
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 100)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    const sort = url.searchParams.get("sort") ?? "marketCap";

    const page = async <T,>(table: string, cols: string): Promise<T[]> => {
      const out: T[] = [];
      for (let o = 0; ; o += 1000) {
        const { data } = await supabase.from(table).select(cols).range(o, o + 999);
        if (!data?.length) break;
        out.push(...(data as unknown as T[]));
        if (data.length < 1000) break;
      }
      return out;
    };

    type Master = { ticker: string; company_name: string | null; sector: string | null };
    type Quote = { ticker: string; price: number | null; market_cap: number | null; day_change_pct: number | null; as_of: string | null };
    type Ratio = { ticker: string; ratio_name: string; ratio_value: number | null; inputs: { eps?: number } | null; source_period: string | null };

    const [masters, quotes, ratios] = await Promise.all([
      page<Master>("stock_master", "ticker,company_name,sector"),
      page<Quote>("market_quotes", "ticker,price,market_cap,day_change_pct,as_of"),
      page<Ratio>("company_ratios", "ticker,ratio_name,ratio_value,inputs,source_period"),
    ]);

    const quoteBy = new Map(quotes.map((r) => [r.ticker, r]));
    const ratioBy = new Map<string, Map<string, Ratio>>();
    for (const r of ratios) {
      if (!ratioBy.has(r.ticker)) ratioBy.set(r.ticker, new Map());
      ratioBy.get(r.ticker)!.set(r.ratio_name, r);
    }

    let rows = masters.map((m) => {
      const qt = quoteBy.get(m.ticker);
      const rs = ratioBy.get(m.ticker);
      const pe = rs?.get("P/E");
      // verificationStatus compares against a bare period label ("2026 9M");
      // the ratio's source_period is prefixed for trailing figures
      // ("TTM to 2026 9M"), so strip that before asking. Returns null when the
      // company was never hand-verified, which is the common case.
      const period = (pe?.source_period ?? null)?.replace(/^TTM to /, "") ?? null;
      const v = verificationStatus(m.ticker, period);
      return {
        ticker: m.ticker,
        name: m.company_name,
        sector: m.sector,
        price: round(qt?.price),
        dayChangePct: round(qt?.day_change_pct),
        marketCap: qt?.market_cap ?? null,
        asOf: qt?.as_of ?? null,
        pe: round(pe?.ratio_value),
        eps: round(pe?.inputs?.eps),
        pb: round(rs?.get("P/B")?.ratio_value),
        dividendYield: round(rs?.get("Dividend yield")?.ratio_value),
        // The period the valuation rests on. A value starting with "TTM" is a
        // trailing twelve months; anything else (e.g. "2024 FY") means the
        // ratio is computed from that period alone and may be stale.
        basis: pe?.source_period ?? null,
        verified: v?.status ?? "unverified",
      };
    });

    if (sector) rows = rows.filter((r) => r.sector === sector);
    if (onlyVerified) rows = rows.filter((r) => r.verified === "verified");
    if (q) rows = rows.filter((r) => r.ticker.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q));

    rows.sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "pe") return (a.pe ?? Infinity) - (b.pe ?? Infinity);
      return (b.marketCap ?? 0) - (a.marketCap ?? 0);
    });

    return NextResponse.json({
      total: rows.length,
      returned: Math.min(limit, Math.max(0, rows.length - offset)),
      offset,
      stocks: rows.slice(offset, offset + limit),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
