import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/shared/cron-auth";
import { runCron, recentJobRuns } from "@/lib/ops/job-runs";
import { evaluateJobHealth, notifyOwner } from "@/lib/ops/job-health";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDataHealth } from "@/lib/engine/data-health";
import { checkRegistryHealth, summariseRegistryHealth } from "@/lib/engine/registry-health";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled data-health audit.
 *
 * Every check here is a relationship BETWEEN stored rows rather than a
 * property of one row, which is why the write-time accounting-identity
 * validation cannot catch them: each row is individually well-formed while
 * the trailing-12m chain built from them is wrong. These defects were
 * previously found by hand, one company at a time, a quarter after the fact.
 *
 * Results are written to data_health_runs so regressions are visible as a
 * trend — a jump in NO_COMPARATIVE after a results season means the new
 * filings extracted badly, which is exactly the signal worth having early.
 *
 *   GET /api/cron/data-health            summary only
 *   GET /api/cron/data-health?detail=1   include findings (capped)
 */
async function handler(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  const db = createAdminClient();
  const started = Date.now();

  try {
    const health = await runDataHealth(db);

    // Best-effort history. The audit is useful even if the table is absent,
    // so a missing table must not fail the run.
    await db
      .from("data_health_runs")
      .insert({
        checked: health.checked,
        clean_companies: health.cleanCompanies,
        clean_market_cap: health.cleanMarketCap,
        clean_market_cap_pct: health.cleanMarketCapPct,
        summary: health.summary,
        duration_ms: Date.now() - started,
      })
      .then(
        () => undefined,
        () => undefined
      );

    // Health of the verified REGISTRY, as distinct from the data it points at.
    // The registry tells users a figure was independently checked, and that
    // claim decays two ways: it can start disagreeing with the reference
    // (drift, usually because a later extraction changed which rows the
    // trailing chain selects), or it can still agree while a newer filing has
    // landed (staleness, which a drift check never catches). Both were
    // previously invisible until someone looked by hand.
    //
    // Best-effort: a registry problem must not fail the data-health audit,
    // which is useful on its own.
    const registry = await checkRegistryHealth(db).catch(() => null);

    // Did every scheduled job run today? This is the last cron of the day,
    // so it is where a missing or killed run becomes a message to the owner.
    const jobs = evaluateJobHealth(await recentJobRuns(26));
    const notified = await notifyOwner(jobs);

    return NextResponse.json({
      jobs: { ok: jobs.ok, problems: jobs.problems, notified },
      checked: health.checked,
      cleanCompanies: health.cleanCompanies,
      cleanMarketCap: health.cleanMarketCap,
      cleanMarketCapPct: health.cleanMarketCapPct,
      summary: health.summary,
      findings: url.searchParams.get("detail")
        ? health.findings.sort((a, b) => b.marketCap - a.marketCap).slice(0, 200)
        : undefined,
      registry: registry
        ? {
            summary: summariseRegistryHealth(registry),
            entries: registry.entries,
            agreeing: registry.agreeing,
            drifted: registry.drifted.length,
            stale: registry.stale.length,
            missingData: registry.missingData.length,
            // Always include the offenders. These lists are small by
            // construction, and a count with no names cannot be acted on.
            driftedDetail: registry.drifted,
            staleDetail: registry.stale,
          }
        : undefined,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = (request: Request) => runCron("data-health", request, handler);
