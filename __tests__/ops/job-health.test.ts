import { evaluateJobHealth } from "../../lib/ops/job-health";
import type { JobRun } from "../../lib/ops/job-runs";

const run = (job: string, started: string, status: JobRun["status"] = "ok", error: string | null = null): JobRun => ({
  id: `${job}-${started}`,
  job,
  started_at: started,
  finished_at: status === "running" ? null : started,
  status,
  summary: null,
  error,
});

// A Wednesday, 14:00 UTC: every weekday job is past its grace period.
const WED = new Date("2026-09-09T14:00:00Z");
// A Sunday at the same time: only the daily jobs are expected.
const SUN = new Date("2026-09-06T14:00:00Z");

describe("evaluateJobHealth", () => {
  test("a weekday with every job recorded is healthy", () => {
    const runs = ["backfill/fundamentals", "backfill/extract", "market", "engine", "outlook", "backfill", "market/macro", "daily", "market/payouts"]
      .map((j) => run(j, "2026-09-09T12:00:00Z"));
    expect(evaluateJobHealth(runs, WED).ok).toBe(true);
  });

  test("a missing weekday job is reported by name", () => {
    const runs = ["backfill/fundamentals", "backfill/extract", "market", "engine", "outlook", "backfill", "market/macro", "market/payouts"]
      .map((j) => run(j, "2026-09-09T12:00:00Z"));
    const report = evaluateJobHealth(runs, WED);
    expect(report.problems).toEqual([{ job: "daily", kind: "missing", detail: expect.stringContaining("12:30") }]);
  });

  test("at the weekend only the daily jobs are expected", () => {
    const runs = [run("daily", "2026-09-06T12:31:00Z"), run("market/macro", "2026-09-06T12:21:00Z")];
    expect(evaluateJobHealth(runs, SUN).ok).toBe(true);
  });

  test("a job that never finished past its grace period was killed", () => {
    const runs = [run("daily", "2026-09-09T12:30:00Z", "running"), run("market/macro", "2026-09-09T12:20:00Z")];
    const report = evaluateJobHealth(runs, new Date("2026-09-09T13:10:00Z"));
    expect(report.problems.find((p) => p.job === "daily")?.kind).toBe("still_running");
  });

  test("a job still inside its grace period is not judged yet", () => {
    const runs = [run("daily", "2026-09-09T12:30:00Z", "running"), run("market/macro", "2026-09-09T12:20:00Z")];
    const report = evaluateJobHealth(runs, new Date("2026-09-09T12:40:00Z"));
    expect(report.problems.find((p) => p.job === "daily")).toBeUndefined();
  });

  test("errors and partial runs carry their detail", () => {
    const runs = [run("daily", "2026-09-06T12:31:00Z", "error", "boom"), run("market/macro", "2026-09-06T12:21:00Z", "partial")];
    const report = evaluateJobHealth(runs, SUN);
    expect(report.problems.map((p) => [p.job, p.kind])).toEqual([["market/macro", "partial"], ["daily", "error"]]);
    expect(report.problems[1].detail).toBe("boom");
  });

  test("yesterday's run does not count for today", () => {
    const runs = [run("daily", "2026-09-05T12:31:00Z"), run("market/macro", "2026-09-06T12:21:00Z")];
    expect(evaluateJobHealth(runs, SUN).problems.map((p) => p.job)).toEqual(["daily"]);
  });
});
