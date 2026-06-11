import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { StockSearch } from "@/components/stock-search";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { formatNumber, formatSignedPct, cn } from "@/lib/utils";
import { Star, Briefcase } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StockResearchPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [{ data: watch }, { data: holdings }] = await Promise.all([
    supabase.from("stock_watchlist").select("ticker, status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("holdings").select("ticker, company_name, sector").eq("user_id", user.id).gt("quantity", 0).order("ticker"),
  ]);

  const watchTickers = (watch ?? []).map((w) => w.ticker.toUpperCase());
  const ownedTickers = new Set((holdings ?? []).map((h) => h.ticker.toUpperCase()));
  const allTickers = [...new Set([...watchTickers, ...(holdings ?? []).map((h) => h.ticker.toUpperCase())])];

  const { data: tech } = allTickers.length
    ? await supabase.from("company_technicals").select("ticker, latest_price, day_change_pct").in("ticker", allTickers)
    : { data: [] };
  const priceMap = new Map((tech ?? []).map((t) => [t.ticker.toUpperCase(), t]));

  function PriceTag({ ticker }: { ticker: string }) {
    const p = priceMap.get(ticker);
    if (!p?.latest_price) return null;
    return (
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums">{formatNumber(p.latest_price)}</p>
        {p.day_change_pct !== null && (
          <p className={cn("text-[11px] tabular-nums", p.day_change_pct > 0 ? "text-emerald-600" : p.day_change_pct < 0 ? "text-red-600" : "text-muted-foreground")}>
            {formatSignedPct(p.day_change_pct)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company intelligence"
        title="Stock Research"
        description="Search any PSX-listed company and open its cockpit — overview, financials, earnings, ratios, technicals, dividends, filings and AI analysis in one place."
      />

      <StockSearch autoFocus />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Star className="h-4 w-4 text-amber-500" /> Watchlist</CardTitle>
          <CardDescription>Stocks you are tracking. Add any company from its cockpit page.</CardDescription>
        </CardHeader>
        <CardContent>
          {watchTickers.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Your watchlist is empty. Search a stock above and tap “Watchlist” on its page.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {watchTickers.map((t) => (
                <Link key={t} href={`/stocks/${t}`} className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-accent">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{t}</span>
                    {ownedTickers.has(t) && <Briefcase className="h-3.5 w-3.5 text-emerald-600" />}
                  </div>
                  <PriceTag ticker={t} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Your holdings</CardTitle>
          <CardDescription>Jump straight to the cockpit for a stock you already own.</CardDescription>
        </CardHeader>
        <CardContent>
          {(holdings ?? []).length === 0 ? (
            <EmptyState title="No holdings yet" description="Import a statement or add a transaction to see your holdings here." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(holdings ?? []).map((h) => (
                <Link key={h.ticker} href={`/stocks/${h.ticker.toUpperCase()}`} className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-accent">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{h.ticker.toUpperCase()}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{h.company_name ?? h.sector ?? ""}</p>
                  </div>
                  <PriceTag ticker={h.ticker.toUpperCase()} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        Data is cached and served fast, then refreshed in the background. Each section shows its source and last-updated time. Missing data is labelled, never invented.
      </p>
    </div>
  );
}
