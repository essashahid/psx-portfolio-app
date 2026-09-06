import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { DismissAlertButton } from "@/components/features/alerts/alert-actions";
import { cn } from "@/lib/shared/format";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  price_above_target: "Price reached your target",
  price_below_review: "Price below your review level",
  allocation_above_target: "Holding larger than planned",
  allocation_below_target: "Holding smaller than planned",
  missing_thesis: "No reason recorded for holding",
  review_due: "Review date passed",
  negative_news: "Bad news",
  dividend_news: "Dividend announced",
  result_news: "Results announced",
  concentration_risk: "Too much in one place",
  corporate_action_check: "Corporate action to check",
  import_issue: "Import needs checking",
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
            <p className="eyebrow">Watch</p>
            <h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">
              Alerts
            </h1>
            <p className="mt-1.5 text-sm text-text-muted">Results, dividends, announcements and concentration for what you hold.</p>
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
              ? "Nothing needs your attention. Alerts appear here when a company you hold announces results or a dividend, when a price crosses a level you set, when one holding grows to a large share of your portfolio, or when an import needs checking."
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
