import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyHeader } from "@/lib/company/service";
import { computeRatios, type RatioRow } from "@/lib/engine/ratios";
import { getPortfolio } from "@/lib/portfolio";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AskCopilotLink } from "@/components/ask-copilot-link";
import { formatNumber } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// Metrics shown side by side, with the direction that is conventionally more
// attractive for a long-term buyer. "neutral" rows are shown without emphasis.
const COMPARE_METRICS: { name: string; label: string; better: "low" | "high" | "neutral"; suffix?: string }[] = [
  { name: "P/E", label: "P/E", better: "low", suffix: "x" },
  { name: "P/B", label: "P/B", better: "low", suffix: "x" },
  { name: "Dividend yield (TTM)", label: "Dividend yield", better: "high", suffix: "%" },
  { name: "ROE", label: "ROE", better: "high", suffix: "%" },
  { name: "Net margin", label: "Net margin", better: "high", suffix: "%" },
  { name: "Revenue growth", label: "Revenue growth", better: "high", suffix: "%" },
  { name: "Debt-to-equity", label: "Debt / equity", better: "low", suffix: "x" },
  { name: "Interest coverage", label: "Interest coverage", better: "high", suffix: "x" },
];

type Column = {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  low52: number | null;
  high52: number | null;
  owned: boolean;
  ratios: Map<string, number | null>;
};

function parseTickers(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 4);
}

function metricValue(ratios: RatioRow[], name: string): number | null {
  const v = ratios.find((r) => r.ratio_name === name)?.ratio_value;
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
}

export default async function CompareStocksPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const tickers = parseTickers(t);
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  if (tickers.length < 2) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Research" title="Compare stocks" description="Put two to four PSX companies side by side on valuation, dividends and quality." />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Add at least two tickers to compare, for example <Link href="/stocks/compare?t=FCCL,MLCF" className="font-medium text-primary hover:underline">/stocks/compare?t=FCCL,MLCF</Link>.
            <p className="mt-2 text-xs">Open any stock and use its search to pick companies, or start from <Link href="/stocks" className="text-primary hover:underline">Stock Research</Link>.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const portfolio = await getPortfolio(supabase, user.id);
  const owned = new Set(portfolio.holdings.map((h) => h.ticker));

  const columns: Column[] = await Promise.all(
    tickers.map(async (ticker): Promise<Column> => {
      const [header, ratios] = await Promise.all([
        getCompanyHeader(supabase, ticker),
        computeRatios(supabase, ticker),
      ]);
      const map = new Map<string, number | null>();
      for (const m of COMPARE_METRICS) map.set(m.name, metricValue(ratios, m.name));
      return {
        ticker,
        companyName: header.metadata.companyName,
        sector: header.metadata.sector,
        price: header.quote.price,
        low52: header.technicals?.fiftyTwoWeekLow ?? null,
        high52: header.technicals?.fiftyTwoWeekHigh ?? null,
        owned: owned.has(ticker),
        ratios: map,
      };
    })
  );

  // For each metric, find the best column so it can be lightly emphasised.
  function bestTicker(name: string, better: "low" | "high" | "neutral"): string | null {
    if (better === "neutral") return null;
    let best: { ticker: string; value: number } | null = null;
    for (const col of columns) {
      const v = col.ratios.get(name);
      if (v === null || v === undefined) continue;
      if (!best || (better === "low" ? v < best.value : v > best.value)) best = { ticker: col.ticker, value: v };
    }
    return best?.ticker ?? null;
  }

  return (
    <div className="space-y-4">
      <Link href="/stocks" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Stock research
      </Link>
      <PageHeader eyebrow="Research" title={`Compare ${tickers.join(" · ")}`} description="Valuation, dividends and quality side by side. The most attractive value per row is emphasised; this is context, not a recommendation." />

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="p-3 text-left text-xs font-medium text-muted-foreground">Metric</th>
                {columns.map((col) => (
                  <th key={col.ticker} className="p-3 text-right align-bottom">
                    <Link href={`/stocks/${col.ticker}`} className="font-semibold hover:underline">{col.ticker}</Link>
                    {col.owned && <Badge variant="green" className="ml-1.5 align-middle">Owned</Badge>}
                    <p className="truncate text-[11px] font-normal text-muted-foreground">{col.companyName ?? ""}</p>
                    <p className="text-[10px] font-normal text-muted-foreground">{col.sector ?? ""}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="p-3 text-xs text-muted-foreground">Price</td>
                {columns.map((col) => (
                  <td key={col.ticker} className="p-3 text-right tabular-nums">{col.price !== null ? `PKR ${formatNumber(col.price)}` : "—"}</td>
                ))}
              </tr>
              <tr className="border-b border-border">
                <td className="p-3 text-xs text-muted-foreground">52-week range</td>
                {columns.map((col) => (
                  <td key={col.ticker} className="p-3 text-right text-xs tabular-nums text-muted-foreground">
                    {col.low52 !== null && col.high52 !== null ? `${formatNumber(col.low52)} – ${formatNumber(col.high52)}` : "—"}
                  </td>
                ))}
              </tr>
              {COMPARE_METRICS.map((m) => {
                const best = bestTicker(m.name, m.better);
                return (
                  <tr key={m.name} className="border-b border-border last:border-0">
                    <td className="p-3 text-xs text-muted-foreground">{m.label}</td>
                    {columns.map((col) => {
                      const v = col.ratios.get(m.name);
                      const isBest = best === col.ticker && columns.length > 1;
                      return (
                        <td key={col.ticker} className={`p-3 text-right tabular-nums ${isBest ? "font-semibold text-emerald-700" : ""}`}>
                          {v !== null && v !== undefined ? `${m.suffix === "%" ? v.toFixed(2) : v.toFixed(2)}${m.suffix ?? ""}` : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <AskCopilotLink question={`Compare ${tickers.join(", ")} for a long-term investor. Which has the more attractive valuation and dividend profile, and why?`} label="Ask Copilot to compare" />
      </div>
    </div>
  );
}
