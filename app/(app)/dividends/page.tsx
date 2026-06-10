import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDividends, summarizeDividends } from "@/lib/dividends";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { DividendManager } from "@/components/dividend-form";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

type Search = { ticker?: string };

export default async function DividendsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const summary = await getPortfolio(supabase, user.id);
  const dividends = await getDividends(supabase, user.id, { ticker: sp.ticker });
  const allDividends = sp.ticker ? await getDividends(supabase, user.id) : dividends;
  const dividendSummary = summarizeDividends(allDividends);
  const tickers = summary.holdings.map((h) => h.ticker);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dividend Tracker"
        description="Track announced, expected and received dividends without turning the app into a tax system."
        actions={
          <Link href="/api/export/dividends">
            <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> Export CSV</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Net received" value={`PKR ${dividendSummary.netReceived.toLocaleString("en-PK")}`} />
        <StatCard label="Expected net" value={`PKR ${dividendSummary.expectedNet.toLocaleString("en-PK")}`} />
        <StatCard label="Pending dividends" value={String(dividendSummary.pendingCount)} tone={dividendSummary.pendingCount > 0 ? "negative" : "neutral"} />
        <StatCard label="Tax deducted" value={`PKR ${dividendSummary.totalTax.toLocaleString("en-PK")}`} />
        <StatCard label="Received records" value={String(dividendSummary.receivedCount)} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium text-muted-foreground">Ticker</span>
        <Link
          href="/dividends"
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${!sp.ticker ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
        >
          All
        </Link>
        {tickers.map((ticker) => (
          <Link
            key={ticker}
            href={`/dividends?ticker=${encodeURIComponent(ticker)}`}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${sp.ticker === ticker ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
          >
            {ticker}
          </Link>
        ))}
      </div>

      <DividendManager dividends={dividends} holdings={summary.holdings} />
    </div>
  );
}
