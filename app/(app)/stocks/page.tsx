import { createClient, getUser } from "@/lib/supabase/server";
import { getScreenerData } from "@/lib/market/screener";
import { fmtPct, fmtInt, tone } from "@/lib/market/format";
import { ScreenerTable } from "@/components/features/stocks/screener-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Band } from "@/components/ui/band";
import { cn, formatNumber } from "@/lib/shared/format";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

const GUTTER = "px-3 sm:px-4 md:px-(--gutter-page)";

export default async function StockResearchPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [d] = await Promise.all([
    getScreenerData(supabase, user.id),
  ]);
  const indexTone = tone(d.index?.changePercent);
  const coveragePct = d.coverage.total ? Math.round((d.coverage.withSpark / d.coverage.total) * 100) : 0;

  if (!d.snapshotDate) {
    return (
      <div className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
        <Band tone="paper" rule="none" className={GUTTER}>
          <span className="mb-3.5 block h-0.75 w-11 bg-(--sp-violet)" />
          <h1 className="font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Stock Research</h1>
          <div className="mt-6">
            <EmptyState
              icon={Activity}
              title="No market data yet"
              description="The screener is powered by the daily market snapshot. Refresh prices to pull the whole PSX, then build deep data for trends and 52-week ranges."
            />
          </div>
        </Band>
      </div>
    );
  }

  const owned = d.stocks.filter((s) => s.owned).length;
  const watched = d.stocks.filter((s) => s.watched).length;
  const advancers = d.breadth?.advancers ?? 0;
  const decliners = d.breadth?.decliners ?? 0;

  return (
    <div className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
      {/* ── Hero ── */}
      <Band
        tone="paper"
        className={GUTTER}
        style={{ background: "color-mix(in oklab, var(--sp-violet) 11%, var(--surface-page))" }}
      >
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-(--sp-violet)" />
            <h1 className="font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Stock Research</h1>
            <div className="mt-4 flex items-end gap-5">
              <span>
                <span className="block text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
                  {d.index?.name ?? "KSE-100"}
                </span>
                <span className="figure mt-1.5 block text-(length:--text-display) font-semibold leading-none tracking-editorial text-text-strong">
                  {d.index?.value != null ? formatNumber(d.index.value, 0) : "—"}
                </span>
              </span>
              <span className="pb-1.5">
                <span className={cn("figure block text-(length:--text-h2) font-semibold", indexTone === "positive" ? "text-up" : indexTone === "negative" ? "text-down" : "text-text-muted")}>
                  {fmtPct(d.index?.changePercent)}
                </span>
                <span className="mt-0.5 block text-sm text-text-muted">across {fmtInt(d.coverage.total)} traded</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3 pb-1">
            <p className="text-(length:--text-2xs) text-text-faint">
              Snapshot {d.snapshotDate}{d.updatedLabel ? ` · updated ${d.updatedLabel} PKT` : ""} · via {d.source ?? "PSX"}
            </p>
          </div>
        </div>

        <div className="mt-7 grid border-t border-rule sm:grid-cols-2 lg:grid-cols-4">
          <HeroMetric label="Companies traded" value={fmtInt(d.coverage.total)} sub="in this snapshot" first />
          <HeroMetric label="Advancing" value={fmtInt(advancers)} sub={`${fmtInt(decliners)} declining`} tone="up" />
          <HeroMetric label="In your book" value={fmtInt(owned)} sub={watched > 0 ? `${fmtInt(watched)} watched` : "held positions"} />
          <HeroMetric label="Deep data" value={`${coveragePct}%`} sub={`${fmtInt(d.coverage.withSpark)} with trends`} last />
        </div>
      </Band>

      {/* ── Screener ── */}
      <Band tone="paper" rule="none" className={cn("dot-grid", GUTTER)}>
        <div className="mb-6">
          <p className="eyebrow">The whole board</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
            Every company, one screen
          </h2>
        </div>
        <ScreenerTable stocks={d.stocks} sectors={d.sectors} />
        <p className="mt-8 text-(length:--text-2xs) text-text-faint">
          Official PSX market-watch via {d.source ?? "PSX"}. Trends and 52-week ranges fill in as deep data is built; missing values are labelled, never invented.
        </p>
      </Band>
    </div>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  tone: metricTone,
  first,
  last,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-t border-rule py-4 first:border-t-0 sm:border-t-0 sm:border-l sm:px-5 sm:first:border-l-0",
        first && "sm:pl-0",
        last && "sm:pr-0"
      )}
    >
      <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
      <p className={cn("figure mt-1.5 text-(length:--text-h1) font-semibold", metricTone === "up" ? "text-up" : metricTone === "down" ? "text-down" : "text-text-strong")}>
        {value}
      </p>
      {sub && <p className="figure mt-0.5 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}
