import type { SupabaseClient } from "@supabase/supabase-js";
import snapshots from "@/data/sarmaaya-snapshots.json";
import registryJson from "@/data/verified-tickers.json";
import { latestPeriodLabel, verificationStatus } from "@/lib/engine/verified";

/**
 * Health of the verified registry itself.
 *
 * The registry tells users a figure was independently checked. That claim
 * decays in two different ways, and only one of them looks like a failure:
 *
 *   DRIFT      the served figure no longer agrees with the reference.
 *              Something broke — usually a later extraction rewrote the rows
 *              the trailing chain is built from, changing which rows the
 *              engine selects. The mark then describes a selection that no
 *              longer exists.
 *
 *   STALENESS  the served figure still agrees with the reference and is
 *              internally consistent, but a newer filing has landed since the
 *              check. Nothing is wrong with the number; it simply is not the
 *              latest one, and a drift check stays green the entire time.
 *
 * Both were previously invisible. Verification was treated as a permanent
 * property of a company when it is really a snapshot of one row selection at
 * one moment, which quarterly filings age automatically.
 *
 * Run from scripts/check-verified-drift.ts, scripts/check-verified-freshness.ts
 * and the scheduled data-health audit, so all three agree by construction
 * rather than by three copies of the same arithmetic staying in step.
 */

const TOLERANCE = 0.03;

/** Entries whose reference is genuinely not the yardstick, with the reason.
 *  Keep short and evidenced: each suppresses a real alarm. */
const EXPECTED_DIVERGENCE: Record<string, string> = {
  ADAMS: "reference chains a superseded pre-restatement comparative; we hold the corrected figure per IAS 8",
};

type Snapshot = { eps?: number | null };
type RegistryEntry = { throughPeriod?: string; basis?: string; source?: string };

const SNAPSHOTS = (snapshots as { snapshots: Record<string, Snapshot> }).snapshots;
const REGISTRY = (registryJson as { verified: Record<string, RegistryEntry> }).verified;

export interface RegistryHealth {
  entries: number;
  agreeing: number;
  drifted: { ticker: string; served: number; reference: number; gapPct: number; source: string }[];
  expectedDivergence: string[];
  noReference: number;
  missingData: string[];
  current: number;
  stale: { ticker: string; through: string; held: string; source: string }[];
}

/** Page past the 1000-row default cap. A bare select silently truncates, which
 *  on this table means quietly auditing only the alphabetically-first slice. */
async function pageAll<T>(
  db: SupabaseClient,
  table: string,
  select: string,
  filter?: (q: ReturnType<SupabaseClient["from"]>) => unknown
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(select).range(from, from + PAGE - 1) as unknown;
    if (filter) q = filter(q as ReturnType<SupabaseClient["from"]>);
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function checkRegistryHealth(db: SupabaseClient): Promise<RegistryHealth> {
  const peRows = await pageAll<{ ticker: string; inputs: unknown }>(
    db,
    "company_ratios",
    "ticker,inputs",
    (q) => (q as unknown as { eq: (a: string, b: string) => unknown }).eq("ratio_name", "P/E")
  );
  const servedEps = new Map<string, number | null>(
    peRows.map((r) => [r.ticker, (r.inputs as { eps?: number } | null)?.eps ?? null])
  );

  const finRows = await pageAll<{ ticker: string; fiscal_year: number | null; fiscal_period: string | null }>(
    db,
    "company_financials",
    "ticker,fiscal_year,fiscal_period",
    (q) => (q as unknown as { eq: (a: string, b: string) => unknown }).eq("statement_type", "income_statement")
  );
  const periodsBy = new Map<string, { fiscal_year: number | null; fiscal_period: string | null }[]>();
  for (const r of finRows) {
    const list = periodsBy.get(r.ticker);
    if (list) list.push(r);
    else periodsBy.set(r.ticker, [r]);
  }

  const health: RegistryHealth = {
    entries: 0,
    agreeing: 0,
    drifted: [],
    expectedDivergence: [],
    noReference: 0,
    missingData: [],
    current: 0,
    stale: [],
  };

  for (const [ticker, entry] of Object.entries(REGISTRY)) {
    health.entries++;
    const source = entry.source ?? "?";

    // --- drift -------------------------------------------------------------
    const served = servedEps.get(ticker) ?? null;
    const reference = SNAPSHOTS[ticker]?.eps ?? null;
    if (served == null) {
      health.missingData.push(ticker);
    } else if (reference == null) {
      health.noReference++;
    } else {
      const gap = Math.abs(served - reference) / Math.abs(reference);
      if (gap < TOLERANCE) health.agreeing++;
      else if (EXPECTED_DIVERGENCE[ticker]) health.expectedDivergence.push(ticker);
      else health.drifted.push({ ticker, served, reference, gapPct: gap * 100, source });
    }

    // --- staleness ---------------------------------------------------------
    const held = latestPeriodLabel(periodsBy.get(ticker) ?? []);
    const status = verificationStatus(ticker, held);
    if (status?.status === "stale") {
      health.stale.push({ ticker, through: entry.throughPeriod ?? "?", held: held ?? "?", source });
    } else if (status) {
      health.current++;
    }
  }

  health.drifted.sort((a, b) => b.gapPct - a.gapPct);
  return health;
}

/** One-line summary for logs and the stored audit row. */
export function summariseRegistryHealth(h: RegistryHealth): string {
  return [
    `${h.entries} verified`,
    `${h.agreeing} agree`,
    `${h.drifted.length} drifted`,
    `${h.stale.length} stale`,
    h.missingData.length ? `${h.missingData.length} missing data` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
