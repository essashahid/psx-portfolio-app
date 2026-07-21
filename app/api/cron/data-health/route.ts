import { NextResponse } from "next/server";
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
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    return NextResponse.json({
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
