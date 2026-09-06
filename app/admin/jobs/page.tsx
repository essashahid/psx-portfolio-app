import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { latestJobRuns, recentJobRuns } from "@/lib/ops/job-runs";
import { evaluateJobHealth, SCHEDULE } from "@/lib/ops/job-health";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Jobs" };

/**
 * Every scheduled job, its last run, and what the health check thinks. This
 * is the page to open when a number looks stale: it says which job did not
 * finish rather than leaving that to be inferred from the data.
 */
export default async function JobsPage() {
  const [latest, recent] = await Promise.all([latestJobRuns(1), recentJobRuns(26)]);
  const health = evaluateJobHealth(recent);
  const byJob = new Map(latest.map((r) => [r.job, r]));
  const jobs = [...new Set([...SCHEDULE.map((s) => s.job), ...latest.map((r) => r.job)])];

  const tone = (status: string | undefined) =>
    status === "ok" ? "secondary" : status === "partial" ? "amber" : status === "error" ? "red" : "secondary";
  const when = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) : "never";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Scheduled jobs</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          One row per cron. A run left at &quot;running&quot; past its grace period was killed by the platform.
          The health check runs at the end of each day and posts to the owner webhook when configured.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Today</h2>
          {health.ok ? (
            <EmptyState icon={Activity} title="Every expected job has run" description="Nothing missing, failed or cut short so far today." />
          ) : (
            <ul className="space-y-2 text-sm">
              {health.problems.map((p) => (
                <li key={`${p.job}-${p.kind}`} className="flex items-start gap-3">
                  <Badge variant={p.kind === "partial" ? "amber" : "red"}>{p.kind.replace("_", " ")}</Badge>
                  <span>
                    <span className="font-medium text-text-strong">{p.job}</span>
                    <span className="text-text-muted"> {p.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Last run per job</h2>
          <Table variant="reader">
            <THead>
              <TR>
                <TH>Job</TH>
                <TH>Status</TH>
                <TH>Started (PKT)</TH>
                <TH className="text-right">Took</TH>
                <TH>Note</TH>
              </TR>
            </THead>
            <TBody>
              {jobs.map((job) => {
                const r = byJob.get(job);
                const took = r?.finished_at ? Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000) : null;
                return (
                  <TR key={job}>
                    <TD className="font-medium text-text-strong">{job}</TD>
                    <TD>
                      <Badge variant={tone(r?.status)}>{r?.status ?? "no record"}</Badge>
                    </TD>
                    <TD className="text-text-muted">{when(r?.started_at)}</TD>
                    <TD className="text-right tabular-nums text-text-muted">{took === null ? "—" : `${took}s`}</TD>
                    <TD className="max-w-md truncate text-text-muted">{r?.error ?? ""}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
