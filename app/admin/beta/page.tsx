import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { createAdminClient } from "@/lib/supabase/admin";
import { summariseBeta } from "@/lib/telemetry/summary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Beta" };

/** The window the page reads, computed once per request outside render. */
function sinceIso(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString();
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border-t border-rule py-3">
      <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
      <p className="figure mt-1 text-lg font-semibold text-text-strong">{value}</p>
      {sub && <p className="text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

/**
 * The beta questions, answered from app_events, holdings and feedback.
 * Counts only; the point is to know what people do before deciding Phase 6.
 */
export default async function BetaPage() {
  const db = createAdminClient();
  const since = sinceIso();
  const [{ data: events }, { data: holders }, { data: errors }, { data: feedback }] = await Promise.all([
    db.from("app_events").select("user_id, surface, name, path, props, created_at").gte("created_at", since).limit(20000),
    db.from("holdings").select("user_id, source").gt("quantity", 0),
    db.from("client_errors").select("id, surface, message, path, user_id, created_at").order("created_at", { ascending: false }).limit(30),
    db.from("product_feedback").select("id, kind, message, page_path, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  const s = summariseBeta((events ?? []) as Parameters<typeof summariseBeta>[0], (holders ?? []) as { user_id: string; source: string | null }[]);


  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Beta</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">Last 30 days of events. These are the questions Phase 6 is decided on.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Adoption</h2>
            <Stat label="Accounts with a portfolio" value={s.usersWithHoldings} />
            <Stat label="Added by hand vs imported" value={`${s.holdingsBySource.manual} manual, ${s.holdingsBySource.transactions} ledger, ${s.holdingsBySource.import} import`} sub="holdings rows by source" />
            <Stat label="Onboarding completed" value={s.count("onboarding_completed")} />
            <Stat label="Holdings added" value={s.count("holding_added")} sub={`${s.propCount("holding_added", "method")}`} />
            <Stat label="Import opened / committed" value={`${s.count("import_opened")} / ${s.count("import_committed")}`} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Engagement</h2>
            <Stat label="Weekly active accounts" value={s.weeklyActive} sub="distinct users with any event in the last 7 days" />
            <Stat label="Web vs mobile events" value={`${s.bySurface.web} web, ${s.bySurface.mobile} mobile`} />
            <Stat label="Pages, by views" value={s.topRoutes.map(([r, n]) => `${r} ${n}`).join(" · ") || "none yet"} />
            <Stat label="Dividends vs Portfolio views" value={`${s.routeViews("/dividends")} vs ${s.routeViews("/holdings")}`} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Research</h2>
            <Stat label="Company pages, held vs not held" value={`${s.propValue("company_viewed", "held", true)} held, ${s.propValue("company_viewed", "held", false)} not held`} />
            <Stat label="Company tabs" value={s.propCount("company_tab_viewed", "tab") || "none yet"} />
            <Stat label="Ask questions" value={s.count("chat_asked")} sub={`by mode: ${s.propCount("chat_asked", "mode") || "none yet"}`} />
            <Stat label="Push interest / discrepancies reported" value={`${s.count("push_interest")} / ${s.count("discrepancy_reported")}`} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Recent feedback</h2>
            {(feedback ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">Nothing yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(feedback ?? []).map((f) => (
                  <li key={String(f.id)}>
                    <span className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{f.kind} · {f.page_path}</span>
                    <p className="text-text-strong">{String(f.message).slice(0, 240)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Client errors, newest first</h2>
          {(errors ?? []).length === 0 ? (
            <p className="text-sm text-text-muted">None recorded.</p>
          ) : (
            <Table variant="reader">
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Surface</TH>
                  <TH>Path</TH>
                  <TH>Message</TH>
                </TR>
              </THead>
              <TBody>
                {(errors ?? []).map((e) => (
                  <TR key={String(e.id)}>
                    <TD className="whitespace-nowrap text-text-muted">{new Date(String(e.created_at)).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}</TD>
                    <TD>{String(e.surface)}</TD>
                    <TD className="text-text-muted">{String(e.path ?? "")}</TD>
                    <TD className="max-w-lg truncate">{String(e.message)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
