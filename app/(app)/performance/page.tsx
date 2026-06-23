import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPerformanceAnalytics } from "@/lib/engine/performance";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { CostBasisTable } from "@/components/cost-basis-table";
import { ActionButton } from "@/components/action-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatMoney, formatNumber, plColor } from "@/lib/utils";
import { AlertTriangle, RefreshCw, TrendingUp, Upload } from "lucide-react";

export const dynamic = "force-dynamic";

// Known corporate actions that need manual correction (CDC allotments and
// the FFBL→FFC scheme of arrangement that don't appear in the AKD ledger).
const KNOWN_GAPS = [
  {
    id: "IREIT-ipo",
    label: "IREIT IPO allotment",
    detail: "1,500 shares @ PKR 10.00 — CDC allotment Oct 6, 2025",
    rowHash: "corp-action-IREIT-2025-10-06-BUY-1500",
    body: { action: "ipoBuy", ticker: "IREIT", trade_date: "2025-10-06", quantity: 1500, price: 10, notes: "IPO allotment via CDC" },
  },
  {
    id: "SLM-ipo",
    label: "SLM IPO allotment",
    detail: "1,000 shares @ PKR 19.95 — CDC allotment Jun 15, 2026",
    rowHash: "corp-action-SLM-2026-06-15-BUY-1000",
    body: { action: "ipoBuy", ticker: "SLM", trade_date: "2026-06-15", quantity: 1000, price: 19.95, notes: "IPO allotment via CDC" },
  },
  {
    id: "FFBL-FFC-merger",
    label: "FFBL→FFC scheme of arrangement",
    detail: "100 FFBL converted to 23 FFC — LHC sanctioned Dec 5, 2024",
    rowHash: "corp-action-FFBL-2024-12-05-SELL-100",
    body: { action: "merger", fromTicker: "FFBL", fromQty: 100, toTicker: "FFC", toQty: 23, date: "2024-12-05" },
  },
] as const;

export default async function PerformancePage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  // Resolve analytics and check which known gaps are already fixed in parallel.
  const gapHashes = KNOWN_GAPS.map((g) => g.rowHash);
  const [analytics, { data: fixedRows }] = await Promise.all([
    getPerformanceAnalytics(supabase, user.id),
    supabase
      .from("transactions")
      .select("row_hash")
      .eq("user_id", user.id)
      .in("row_hash", gapHashes),
  ]);

  const fixedSet = new Set((fixedRows ?? []).map((r) => r.row_hash as string));
  const openGaps = KNOWN_GAPS.filter((g) => !fixedSet.has(g.rowHash));

  if (!analytics) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Portfolio"
          title="Performance"
          description="Money-weighted returns, cost basis and portfolio analytics derived from your AKD ledger."
        />
        <EmptyState
          icon={TrendingUp}
          title="No analytics available"
          description="Import an AKD Statement Of Account to see XIRR, cost basis with bonus-share adjustments, friction autopsy, capital deployment stats and concentration analysis."
          action={
            <Link href="/import">
              <Button>
                <Upload className="h-4 w-4" /> Import statement
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { returns: r, costBasis, friction: f, byYear, deployment: d, concentration: c } = analytics;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Portfolio"
        title="Performance"
        description="Money-weighted returns, cost basis and analytics from your AKD Statement Of Account."
        actions={
          <ActionButton
            endpoint="/api/import/sync-cash"
            label={<><RefreshCw className="h-3.5 w-3.5" /> Sync cash ledger</>}
            variant="outline"
            size="sm"
            onSuccessMessage="Cash ledger synced."
          />
        }
      />

      {/* ── Data quality panel ── */}
      {openGaps.length > 0 && (
        <Card className="rise border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-sm text-amber-900 dark:text-amber-300">
                {openGaps.length} holding{openGaps.length > 1 ? "s" : ""} need a corrective entry
              </CardTitle>
            </div>
            <CardDescription className="text-amber-800/70 dark:text-amber-400/70">
              These shares were obtained outside the AKD statement (IPO allotments via CDC or a court-sanctioned merger).
              Adding them fixes your cost basis and holdings rebuild.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2.5">
              {openGaps.map((gap) => (
                <div
                  key={gap.id}
                  className="flex flex-col gap-2 rounded-lg border border-amber-200/60 bg-white/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/30 dark:bg-black/10"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-300">{gap.label}</p>
                    <p className="text-xs text-amber-700/80 dark:text-amber-500">{gap.detail}</p>
                  </div>
                  <ActionButton
                    endpoint="/api/corporate-actions"
                    body={gap.body as Record<string, unknown>}
                    label="Add transaction"
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:bg-transparent dark:text-amber-300"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Returns hero ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 rise">
        <StatCard
          label="Net Worth"
          value={formatMoney(r.netWorth)}
          sub={`mkt ${formatNumber(r.marketValue, 0)} + cash ${formatNumber(r.cashBalance, 0)}`}
        />
        <StatCard
          label="Total Gain"
          value={`${r.totalReturnPct >= 0 ? "+" : ""}${r.totalReturnPct}%`}
          sub={formatMoney(r.totalGain)}
          tone={r.totalGain >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="XIRR"
          value={r.xirrPct !== null ? `${r.xirrPct}%/yr` : "—"}
          sub={`${r.holdingPeriodYears} yrs, money-weighted`}
          tone={r.xirrPct !== null && r.xirrPct > 0 ? "positive" : "neutral"}
        />
        <StatCard
          label="Realized P/L"
          value={formatMoney(r.realizedPl)}
          tone={r.realizedPl > 0 ? "positive" : r.realizedPl < 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Unrealized P/L"
          value={formatMoney(r.unrealizedPl)}
          tone={r.unrealizedPl > 0 ? "positive" : r.unrealizedPl < 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Total Friction"
          value={formatMoney(r.totalFriction)}
          sub={`${f.pctOfDeposits}% of deposits`}
        />
      </div>

      {/* ── Cost basis ── */}
      <Card className="rise rise-1">
        <CardHeader>
          <CardTitle>Cost Basis</CardTitle>
          <CardDescription>
            Weighted-average cost from the AKD ledger. Bonus shares lower the effective average cost.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CostBasisTable rows={costBasis} />
        </CardContent>
      </Card>

      {/* ── By year + Friction ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 rise rise-2">
        {/* By year */}
        <Card>
          <CardHeader>
            <CardTitle>Performance by Year</CardTitle>
            <CardDescription>
              Deposits, capital deployed, realized gains and friction per calendar year.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="scroll-touch -mx-2 overflow-x-auto px-2">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 text-left">Year</th>
                    <th className="pb-2 pr-3 text-right">Deposits</th>
                    <th className="pb-2 pr-3 text-right">Deployed</th>
                    <th className="pb-2 pr-3 text-right">Sells</th>
                    <th className="pb-2 pr-3 text-right">Realized</th>
                    <th className="pb-2 pr-3 text-right">Friction</th>
                    <th className="pb-2 text-right">Trades</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byYear.map((y) => (
                    <tr key={y.year} className="hover:bg-accent/40 transition-colors">
                      <td className="py-2.5 pr-3 font-medium tabular-nums">{y.year}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {y.deposits > 0 ? formatNumber(y.deposits, 0) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {y.buys > 0 ? formatNumber(y.buys, 0) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {y.sells > 0 ? formatNumber(y.sells, 0) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pr-3 text-right tabular-nums font-medium",
                          plColor(y.realizedPl)
                        )}
                      >
                        {y.realizedPl !== 0
                          ? `${y.realizedPl > 0 ? "+" : ""}${formatNumber(y.realizedPl, 0)}`
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatNumber(y.friction, 0)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{y.tradeCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Friction autopsy */}
        <Card>
          <CardHeader>
            <CardTitle>Friction Autopsy</CardTitle>
            <CardDescription>
              Every basis point paid to participate: brokerage, taxes, regulatory and custody fees.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Commission", value: f.commission },
                { label: "SST", value: f.sst },
                { label: "CDC", value: f.cdc },
                { label: "CGT", value: f.cgt },
                { label: "Account fees", value: f.accountFees },
                { label: "Trade fees", value: f.tradeFeesTotal },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-muted/60 px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatNumber(value, 0)}</p>
                </div>
              ))}
            </div>

            <div className="flex items-baseline justify-between border-t border-border pt-3">
              <span className="text-sm font-medium">Total friction</span>
              <span className="text-base font-semibold tabular-nums">{formatMoney(f.total)}</span>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              {f.pctOfDeposits}% of deposits
              {f.pctOfGains !== null ? ` · ${f.pctOfGains}% of gross gains` : ""}
            </p>

            {f.bySize.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  By trade size
                </p>
                <div className="space-y-1.5">
                  {f.bySize.map((b) => (
                    <div key={b.bucket} className="flex items-center gap-3 text-xs">
                      <span className="w-32 shrink-0 text-muted-foreground">{b.bucket}</span>
                      <span className="tabular-nums">{b.trades} trades</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {b.avgFeePct}% avg fee
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {d.buysTotal > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{d.pctDeployedWithin24h}%</span> of buys
                within 24h of a deposit
                {d.medianDaysDepositToBuy !== null && (
                  <>
                    {" "}
                    · median lag{" "}
                    <span className="font-medium text-foreground">
                      {d.medianDaysDepositToBuy}d
                    </span>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Concentration ── */}
      <Card className="rise rise-3">
        <CardHeader>
          <CardTitle>Portfolio Concentration</CardTitle>
          <CardDescription>
            Sector allocation, diversification index and one-decision-away risk scenarios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            {/* Sector bars — 3/5 */}
            <div className="lg:col-span-3 space-y-3">
              <p className="mb-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Sector allocation
              </p>
              {c.sectorWeights.map((s) => (
                <div key={s.sector}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm">{s.sector}</span>
                    <span className="tabular-nums text-sm font-medium text-muted-foreground">
                      {s.weightPct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#3450c8] transition-all"
                      style={{ width: `${Math.min(s.weightPct, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Key metrics — 2/5 */}
            <div className="lg:col-span-2 space-y-5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Key metrics
              </p>
              <div className="space-y-3">
                {[
                  {
                    label: "Largest holding",
                    value: c.topHolding
                      ? `${c.topHolding.ticker} (${c.topHolding.weightPct}%)`
                      : "—",
                  },
                  {
                    label: "Top-2 banks weight",
                    value: `${c.top2BanksWeightPct}%`,
                    note: "MEBL + UBL",
                  },
                  {
                    label: "HHI (diversification)",
                    value: formatNumber(c.hhi, 2),
                    note:
                      c.hhi < 0.1
                        ? "well diversified"
                        : c.hhi < 0.25
                        ? "moderately concentrated"
                        : "highly concentrated",
                  },
                  {
                    label: "Tail positions (< 3%)",
                    value: `${c.positionsBelow3pct} holdings`,
                    note: `combined ${c.smallTailWeightPct}% of portfolio`,
                  },
                ].map(({ label, value, note }) => (
                  <div key={label}>
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
                    {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
                  </div>
                ))}
              </div>

              {c.topTwoShock && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/20">
                  <p className="font-medium text-amber-900 dark:text-amber-300">
                    One-decision-away scenario
                  </p>
                  <p className="mt-1 text-amber-800 dark:text-amber-400">
                    A {c.topTwoShock.dropPct}% drop in your top two holdings would erase{" "}
                    <span className="font-semibold">{c.topTwoShock.portfolioImpactPct}%</span> of
                    total portfolio value.
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
