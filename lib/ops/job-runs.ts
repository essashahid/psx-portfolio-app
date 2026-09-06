import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A record of every scheduled job, so "did it run" is a query and not a guess.
 *
 * Each cron route wraps its handler in runCron(). A row is written when the
 * job starts and updated when it ends, with the handler's JSON summary. A
 * platform kill (the 300 second ceiling) leaves the row at "running", which
 * the health check treats as a failure once the job's expected window has
 * passed. That is the case nothing recorded before.
 */

export type JobStatus = "running" | "ok" | "error" | "partial";

export interface JobRun {
  id: string;
  job: string;
  started_at: string;
  finished_at: string | null;
  status: JobStatus;
  summary: Record<string, unknown> | null;
  error: string | null;
}

function admin() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
}

export async function startJobRun(job: string): Promise<string | null> {
  const db = admin();
  if (!db) return null;
  try {
    const { data } = await db.from("job_runs").insert({ job, status: "running" }).select("id").single();
    return data?.id ? String(data.id) : null;
  } catch {
    return null;
  }
}

export async function finishJobRun(
  id: string | null,
  status: Exclude<JobStatus, "running">,
  summary: Record<string, unknown> | null,
  error?: string
): Promise<void> {
  const db = admin();
  if (!db || !id) return;
  try {
    await db
      .from("job_runs")
      .update({ status, finished_at: new Date().toISOString(), summary, error: error ?? null })
      .eq("id", id);
  } catch {
    /* best effort */
  }
}

/**
 * Wrap a cron handler. Auth failures (401, 503) are not recorded as runs: the
 * job did not run, and a probe by a stranger is not a job. Anything the
 * handler reports with `errors` or `partial` in its body is marked partial so
 * a job that finished but skipped work is distinguishable from a clean one.
 */
export async function runCron(job: string, request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
  const started = Date.now();
  let res: Response;
  try {
    res = await handler(request);
  } catch (err) {
    const id = await startJobRun(job);
    await finishJobRun(id, "error", { elapsed_ms: Date.now() - started }, err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  if (res.status === 401 || res.status === 503) return res;

  const id = await startJobRun(job);
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.clone().json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const summary = { ...(body ?? {}), elapsed_ms: Date.now() - started };
  const failed = res.status >= 400 || body?.ok === false;
  const partial = !failed && hasProblems(body);
  await finishJobRun(id, failed ? "error" : partial ? "partial" : "ok", summary, failed ? String(body?.error ?? `HTTP ${res.status}`) : undefined);
  return res;
}

function hasProblems(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  const s = JSON.stringify(body);
  return /"errors":\[(?!\])/.test(s) || /"users_deferred":[1-9]/.test(s) || /"skipped":"time budget"/.test(s);
}

/** Every run started in the last `hours`, newest first. */
export async function recentJobRuns(hours: number): Promise<JobRun[]> {
  const db = admin();
  if (!db) return [];
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data } = await db.from("job_runs").select("*").gte("started_at", since).order("started_at", { ascending: false }).limit(500);
  return (data ?? []) as JobRun[];
}

/** The most recent run of each job, newest first. */
export async function latestJobRuns(limitPerJob = 1): Promise<JobRun[]> {
  const db = admin();
  if (!db) return [];
  const { data } = await db.from("job_runs").select("*").order("started_at", { ascending: false }).limit(400);
  const seen = new Map<string, number>();
  const out: JobRun[] = [];
  for (const r of (data ?? []) as JobRun[]) {
    const n = seen.get(r.job) ?? 0;
    if (n >= limitPerJob) continue;
    seen.set(r.job, n + 1);
    out.push(r);
  }
  return out;
}
