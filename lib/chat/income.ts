import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtCompact } from "@/lib/market/format";
import type { HoldingsSummary } from "@/lib/chat/data";

/**
 * Portfolio-level dividend income for the Research Copilot, pre-computed on TWO
 * clearly-labelled bases so the model never has to aggregate raw rows itself
 * (doing so is how a V4 Pro test run concluded UBL paid "75% of income" when
 * the received-cash share was 31%):
 *
 *  - RECEIVED: cash actually credited to the user in the trailing 12 months,
 *    from their own dividends ledger. This is the truth for "what income did I
 *    get" and for payer-concentration risk.
 *  - RUN-RATE: TTM cash DPS x current shares, from the market-wide
 *    company_payouts feed. A forward proxy for "what does the book yield at
 *    today's position sizes"; it differs from RECEIVED whenever shares were
 *    bought during the year.
 *
 * Plus the platform's own upcoming-payout calendar (announced + forecast
 * dividend_events), so "when is my next dividend" reads from the calendar
 * instead of being re-derived from payout history one ticker at a time.
 */

export interface DividendIncomeRow {
  ticker: string;
  quantity: number;
  ttmDps: number;
  annualIncome: number;
  yieldOnCostPct: number | null;
  yieldOnMarketPct: number | null;
  incomeSharePct: number;
}

export interface ReceivedIncomeRow {
  ticker: string;
  gross: number;
  net: number;
  sharePct: number; // of total gross received
}

export interface UpcomingPayout {
  ticker: string;
  status: "announced" | "forecasted";
  /** Best available date: payment_date, else estimated window start. */
  expectedDate: string | null;
  exDate: string | null;
  dpsText: string; // "PKR 11.00/sh" or "PKR 13 to 15/sh"
  netText: string | null; // "≈ PKR 4,208 net" or a low–high range
  confidence: string | null;
}

export interface DividendIncome {
  rows: DividendIncomeRow[]; // run-rate payers only, largest income first
  payerCount: number;
  nonPayerCount: number;
  totalAnnualIncome: number;
  totalCost: number;
  totalValue: number | null;
  portfolioYieldOnCostPct: number | null;
  portfolioYieldOnMarketPct: number | null;
  /** Cash actually received in the trailing 12 months (user ledger). */
  received: { rows: ReceivedIncomeRow[]; totalGross: number; totalNet: number } | null;
  /** Platform payout calendar: announced + forecast events from today on. */
  upcoming: UpcomingPayout[];
}

export async function getDividendIncome(
  supabase: SupabaseClient,
  userId: string,
  holdings: HoldingsSummary
): Promise<DividendIncome | null> {
  const tickers = holdings.holdings.map((h) => h.ticker.toUpperCase());
  if (tickers.length === 0) return null;

  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  const [{ data }, { data: receivedRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from("company_payouts")
      .select("ticker, dividend_per_share, announcement_date")
      .in("ticker", tickers)
      .eq("kind", "cash")
      .gte("announcement_date", cutoff),
    supabase
      .from("dividends")
      .select("ticker, amount, net_amount, pay_date")
      .eq("user_id", userId)
      .gte("pay_date", cutoff),
    supabase
      .from("dividend_events")
      .select(
        "ticker, event_type, status, ex_date, payment_date, estimated_payment_start, dividend_per_share, dps_low, dps_high, net_expected, net_low, net_high, confidence_level"
      )
      .eq("user_id", userId)
      .in("status", ["announced", "forecasted"]),
  ]);

  // Sum trailing-12-month cash DPS per ticker.
  const ttmByTicker = new Map<string, number>();
  for (const row of data ?? []) {
    const dps = Number(row.dividend_per_share);
    if (!Number.isFinite(dps) || dps <= 0) continue;
    const t = (row.ticker as string).toUpperCase();
    ttmByTicker.set(t, (ttmByTicker.get(t) ?? 0) + dps);
  }

  // Cash actually received, per payer (any ticker in the ledger, held or not).
  const receivedByTicker = new Map<string, { gross: number; net: number }>();
  for (const row of receivedRows ?? []) {
    const gross = Number(row.amount) || 0;
    const net = Number(row.net_amount) || gross;
    if (gross <= 0) continue;
    const t = (row.ticker as string).toUpperCase();
    const agg = receivedByTicker.get(t) ?? { gross: 0, net: 0 };
    agg.gross += gross;
    agg.net += net;
    receivedByTicker.set(t, agg);
  }
  const totalGross = [...receivedByTicker.values()].reduce((s, v) => s + v.gross, 0);
  const totalNet = [...receivedByTicker.values()].reduce((s, v) => s + v.net, 0);
  const received =
    totalGross > 0
      ? {
          rows: [...receivedByTicker.entries()]
            .map(([ticker, v]) => ({
              ticker,
              gross: Math.round(v.gross),
              net: Math.round(v.net),
              sharePct: (v.gross / totalGross) * 100,
            }))
            .sort((a, b) => b.gross - a.gross),
          totalGross: Math.round(totalGross),
          totalNet: Math.round(totalNet),
        }
      : null;

  // Upcoming calendar: keep events whose relevant date is today or later,
  // soonest first. An announced event with a passed pay date is history.
  const upcoming: UpcomingPayout[] = (eventRows ?? [])
    .map((e) => {
      const expectedDate = (e.payment_date as string | null) ?? (e.estimated_payment_start as string | null);
      const dps = e.dividend_per_share != null ? Number(e.dividend_per_share) : null;
      const low = e.dps_low != null ? Number(e.dps_low) : null;
      const high = e.dps_high != null ? Number(e.dps_high) : null;
      const dpsText =
        dps != null
          ? `PKR ${dps.toFixed(2)}/sh`
          : low != null && high != null
            ? `PKR ${low.toFixed(0)} to ${high.toFixed(0)}/sh`
            : "amount TBC";
      const net = e.net_expected != null ? Number(e.net_expected) : null;
      const netLow = e.net_low != null ? Number(e.net_low) : null;
      const netHigh = e.net_high != null ? Number(e.net_high) : null;
      const netText =
        net != null
          ? `~PKR ${Math.round(net).toLocaleString()} net to you`
          : netLow != null && netHigh != null
            ? `PKR ${Math.round(netLow).toLocaleString()} to ${Math.round(netHigh).toLocaleString()} net to you`
            : null;
      return {
        ticker: (e.ticker as string).toUpperCase(),
        status: e.status as "announced" | "forecasted",
        expectedDate,
        exDate: (e.ex_date as string | null) ?? null,
        dpsText,
        netText,
        confidence: (e.confidence_level as string | null) ?? null,
      };
    })
    .filter((e) => e.expectedDate != null && e.expectedDate >= todayIso)
    .sort((a, b) => (a.expectedDate! < b.expectedDate! ? -1 : 1))
    .slice(0, 10);

  if (ttmByTicker.size === 0 && !received && upcoming.length === 0) return null;

  let totalAnnualIncome = 0;
  let totalCost = 0;
  let totalValue = 0;
  let anyPriced = false;
  let payerCount = 0;
  let nonPayerCount = 0;

  interface Draft extends Omit<DividendIncomeRow, "incomeSharePct"> {
    cost: number;
  }
  const drafts: Draft[] = [];

  for (const h of holdings.holdings) {
    const ticker = h.ticker.toUpperCase();
    const cost = h.avgCost * h.quantity;
    totalCost += cost;
    if (h.marketValue != null) {
      totalValue += h.marketValue;
      anyPriced = true;
    }
    const ttmDps = ttmByTicker.get(ticker);
    if (!ttmDps) {
      nonPayerCount++;
      continue;
    }
    payerCount++;
    const annualIncome = ttmDps * h.quantity;
    totalAnnualIncome += annualIncome;
    drafts.push({
      ticker,
      quantity: h.quantity,
      ttmDps,
      annualIncome,
      yieldOnCostPct: cost > 0 ? (annualIncome / cost) * 100 : null,
      yieldOnMarketPct: h.marketValue != null && h.marketValue > 0 ? (annualIncome / h.marketValue) * 100 : null,
      cost,
    });
  }

  const rows: DividendIncomeRow[] = drafts
    .sort((a, b) => b.annualIncome - a.annualIncome)
    .map(({ cost, ...r }) => {
      void cost;
      return { ...r, incomeSharePct: totalAnnualIncome > 0 ? (r.annualIncome / totalAnnualIncome) * 100 : 0 };
    });

  return {
    rows,
    payerCount,
    nonPayerCount,
    totalAnnualIncome,
    totalCost,
    totalValue: anyPriced ? totalValue : null,
    portfolioYieldOnCostPct: totalCost > 0 ? (totalAnnualIncome / totalCost) * 100 : null,
    portfolioYieldOnMarketPct: anyPriced && totalValue > 0 ? (totalAnnualIncome / totalValue) * 100 : null,
    received,
    upcoming,
  };
}

/** Render both income bases plus the payout calendar, with mixing forbidden. */
export function briefFromDividendIncome(income: DividendIncome): string {
  const out: string[] = [
    `## Dividend income (pre-computed on two bases; quote these figures, never re-aggregate raw dividend rows, and never mix the bases in one number)`,
  ];

  if (income.received) {
    const r = income.received;
    const payers = r.rows
      .map((row) => `${row.ticker} ${fmtCompact(row.gross)} (${row.sharePct.toFixed(0)}%)`)
      .join(", ");
    out.push(
      `RECEIVED (cash actually credited to the user, trailing 12 months): ${fmtCompact(r.totalGross)} PKR gross / ${fmtCompact(r.totalNet)} PKR net after tax. By payer, largest first: ${payers}. Use this basis for "what income did I get" and for payer-concentration risk.`
    );
  }

  if (income.rows.length > 0) {
    const yoc = income.portfolioYieldOnCostPct;
    const yom = income.portfolioYieldOnMarketPct;
    out.push(
      `RUN-RATE (TTM cash DPS x current shares, a forward proxy at today's position sizes): about ${fmtCompact(income.totalAnnualIncome)} PKR/year from ${income.payerCount} payer${income.payerCount === 1 ? "" : "s"}${income.nonPayerCount ? ` (${income.nonPayerCount} holding${income.nonPayerCount === 1 ? " pays" : "s pay"} no cash dividend)` : ""}; yield on cost ${yoc != null ? `${yoc.toFixed(1)}%` : "n/a"}${yom != null ? `, yield on market ${yom.toFixed(1)}%` : ""}. It exceeds RECEIVED whenever shares were bought during the year; it is not a guarantee.`
    );

    const rows = income.rows
      .map(
        (r) =>
          `| ${r.ticker} | ${r.ttmDps.toFixed(2)} | ${fmtCompact(r.annualIncome)} | ${r.yieldOnCostPct != null ? `${r.yieldOnCostPct.toFixed(1)}%` : "n/a"} | ${r.yieldOnMarketPct != null ? `${r.yieldOnMarketPct.toFixed(1)}%` : "n/a"} | ${r.incomeSharePct.toFixed(0)}% |`
      )
      .join("\n");
    out.push(
      `Run-rate detail:\n| Ticker | TTM DPS | Annual income | Yield on cost | Yield on market | Share of run-rate |\n|---|---|---|---|---|---|\n${rows}`
    );
  }

  if (income.upcoming.length > 0) {
    const lines = income.upcoming.map((u) => {
      const bits = [
        `- ${u.ticker}: ${u.status === "announced" ? "ANNOUNCED" : "forecast"} ${u.dpsText}`,
        u.expectedDate ? `expected ${u.status === "announced" ? "payment" : "around"} ${u.expectedDate}` : null,
        u.exDate ? `ex-date ${u.exDate}` : null,
        u.netText,
        u.confidence && u.status === "forecasted" ? `${u.confidence} confidence` : null,
      ].filter(Boolean);
      return bits.join(", ");
    });
    out.push(
      `### Upcoming payouts (platform calendar; answer "next dividend" questions from this, soonest first)\n${lines.join("\n")}`
    );
  }

  return out.join("\n\n");
}
