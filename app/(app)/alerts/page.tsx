import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { DismissAlertButton } from "@/components/features/alerts/alert-actions";
import { cn } from "@/lib/shared/format";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  price_above_target: "Price vs target",
  price_below_review: "Below review level",
  allocation_above_target: "Allocation drift",
  allocation_below_target: "Allocation drift",
  missing_thesis: "Missing thesis",
  review_due: "Review due",
  negative_news: "Negative news",
  dividend_news: "Dividend announcement",
  result_news: "Financial result",
  concentration_risk: "Concentration risk",
  import_issue: "Import issue",
};

/**
 * Severity reads as a coloured edge on the row rather than a pill, so a long
 * list scans down its left margin instead of through a field of badges.
 */
const SEVERITY_EDGE: Record<string, string> = {
  critical: "var(--down-1)",
  high: "var(--down-1)",
  medium: "var(--saffron-2)",
  low: "var(--sp-steel)",
  info: "var(--sp-steel)",
};

const DATE_FMT = new Intl.DateTimeFormat("en-PK", { day: "2-digit", month: "short", year: "numeric" });
const shortDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? DATE_FMT.format(new Date(t)) : String(iso).slice(0, 10);
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "history" ? "history" : "open";
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  let query = supabase
    .from("alerts")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(80);
  if (view === "open") query = query.eq("status", "open");
  else query = query.neq("status", "open");
  const { data: alerts } = await query;
  const rows = alerts ?? [];

  return (
    <div className="settle mx-auto w-full max-w-(--content-max)">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">Signals</p>
            <h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">
              Alerts
            </h1>
          </div>
          <div className="flex gap-5 pb-1">
            {(["open", "history"] as const).map((v) => (
              <Link
                key={v}
                href={`/alerts${v === "history" ? "?view=history" : ""}`}
                className={cn(
                  "whitespace-nowrap border-b-2 pb-1.5 text-sm transition-colors",
                  view === v
                    ? "border-indigo font-semibold text-text-strong"
                    : "border-transparent font-medium text-text-muted hover:text-text-strong"
                )}
              >
                {v === "open" ? "Open" : "Dismissed and resolved"}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="mt-8 border-t border-rule pt-10">
          <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
            {view === "open"
              ? "Nothing needs your attention. Alerts appear here when a thesis is missing, an allocation drifts from its target, a review date passes, a price crosses a level you set, a position grows concentrated, or an import needs checking."
              : "Alerts you have dismissed, or that resolved themselves, will appear here."}
          </p>
        </section>
      ) : (
        <section className="mt-8 border-t border-rule">
          {rows.map((a) => (
            <article
              key={a.id}
              className="flex items-start justify-between gap-6 border-b border-rule py-3 pl-3.5"
              style={{ boxShadow: `inset 3px 0 0 ${SEVERITY_EDGE[a.severity] ?? "var(--sp-steel)"}` }}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-strong">{a.title}</p>
                {a.message && (
                  <p className="mt-1 max-w-(--measure) break-words text-sm leading-relaxed text-text-muted">
                    {a.message}
                  </p>
                )}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-(length:--text-2xs) text-text-faint">
                  <span>{TYPE_LABEL[a.alert_type] ?? a.alert_type}</span>
                  {a.ticker && (
                    <>
                      <span aria-hidden>·</span>
                      <Link
                        href={`/stocks/${a.ticker}`}
                        className="figure font-semibold text-indigo transition-colors hover:underline"
                      >
                        {a.ticker}
                      </Link>
                    </>
                  )}
                  <span aria-hidden>·</span>
                  <span className="figure">{shortDate(a.created_at)}</span>
                  {a.status !== "open" && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{a.status}</span>
                    </>
                  )}
                </p>
              </div>
              {a.status === "open" && <DismissAlertButton alertId={a.id} />}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
