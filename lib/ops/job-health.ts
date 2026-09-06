import type { JobRun } from "@/lib/ops/job-runs";

/**
 * Did every scheduled job finish today?
 *
 * The schedule below mirrors vercel.json. It is repeated here on purpose:
 * the health check must know what was supposed to happen, and reading
 * vercel.json at runtime would tie the check to the host. Keep the two in
 * step when a cron is added or moved.
 */
export interface ScheduledJob {
  job: string;
  /** UTC hour and minute the cron fires. */
  hourUtc: number;
  minuteUtc: number;
  weekdaysOnly: boolean;
  /** How long after firing the run is allowed to take before it counts as missing. */
  graceMinutes: number;
}

export const SCHEDULE: ScheduledJob[] = [
  { job: "backfill/fundamentals", hourUtc: 9, minuteUtc: 50, weekdaysOnly: true, graceMinutes: 20 },
  { job: "backfill/extract", hourUtc: 10, minuteUtc: 10, weekdaysOnly: true, graceMinutes: 20 },
  { job: "market", hourUtc: 11, minuteUtc: 40, weekdaysOnly: true, graceMinutes: 20 },
  { job: "engine", hourUtc: 11, minuteUtc: 45, weekdaysOnly: true, graceMinutes: 20 },
  { job: "outlook", hourUtc: 11, minuteUtc: 55, weekdaysOnly: true, graceMinutes: 20 },
  { job: "backfill", hourUtc: 12, minuteUtc: 5, weekdaysOnly: true, graceMinutes: 20 },
  { job: "market/macro", hourUtc: 12, minuteUtc: 20, weekdaysOnly: false, graceMinutes: 20 },
  { job: "daily", hourUtc: 12, minuteUtc: 30, weekdaysOnly: false, graceMinutes: 20 },
  { job: "market/payouts", hourUtc: 13, minuteUtc: 0, weekdaysOnly: true, graceMinutes: 20 },
];

export interface JobProblem {
  job: string;
  kind: "missing" | "error" | "partial" | "still_running";
  detail: string;
}

export interface JobHealthReport {
  checkedAt: string;
  problems: JobProblem[];
  ok: boolean;
}

/**
 * Pure evaluation, so the rule can be tested without a database. `runs` is
 * every run started in the last 26 hours; `now` is injected for tests.
 */
export function evaluateJobHealth(runs: JobRun[], now: Date = new Date()): JobHealthReport {
  const problems: JobProblem[] = [];
  const day = now.getUTCDay();
  const weekday = day >= 1 && day <= 5;
  const todayUtc = now.toISOString().slice(0, 10);

  for (const s of SCHEDULE) {
    if (s.weekdaysOnly && !weekday) continue;
    const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.hourUtc, s.minuteUtc));
    const deadline = new Date(due.getTime() + s.graceMinutes * 60_000);
    if (now < deadline) continue; // not expected yet

    const today = runs.filter((r) => r.job === s.job && r.started_at.slice(0, 10) === todayUtc);
    if (today.length === 0) {
      problems.push({ job: s.job, kind: "missing", detail: `No run recorded since ${s.hourUtc.toString().padStart(2, "0")}:${s.minuteUtc.toString().padStart(2, "0")} UTC.` });
      continue;
    }
    const latest = today.sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
    if (latest.status === "running") {
      const age = (now.getTime() - Date.parse(latest.started_at)) / 60_000;
      if (age > s.graceMinutes) problems.push({ job: s.job, kind: "still_running", detail: `Started ${Math.round(age)} minutes ago and never finished; the platform probably killed it.` });
    } else if (latest.status === "error") {
      problems.push({ job: s.job, kind: "error", detail: latest.error ?? "Failed without a message." });
    } else if (latest.status === "partial") {
      problems.push({ job: s.job, kind: "partial", detail: "Finished but skipped work (time budget or errors in the summary)." });
    }
  }
  return { checkedAt: now.toISOString(), problems, ok: problems.length === 0 };
}

/**
 * Tell the owner. A webhook URL (Pumble, Slack, or anything that accepts
 * {"text": ...}) is the only channel; there is no email provider in this
 * project. Without OWNER_ALERT_WEBHOOK_URL the report is still written to
 * job_runs and shown on the admin jobs page.
 */
export async function notifyOwner(report: JobHealthReport): Promise<{ sent: boolean; reason?: string }> {
  const url = process.env.OWNER_ALERT_WEBHOOK_URL?.trim();
  if (!url) return { sent: false, reason: "OWNER_ALERT_WEBHOOK_URL not set" };
  if (report.ok) return { sent: false, reason: "nothing to report" };
  const lines = report.problems.map((p) => `- ${p.job}: ${p.kind}. ${p.detail}`);
  const text = `PortfolioOS PK jobs: ${report.problems.length} problem(s) at ${report.checkedAt}\n${lines.join("\n")}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { sent: true } : { sent: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
