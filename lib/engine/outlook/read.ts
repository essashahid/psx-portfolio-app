import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAlignedInputs } from "@/lib/engine/outlook/inputs";
import { buildForecastDataset } from "@/lib/engine/outlook/walkforward";
import { buildExperimentalOutlook, type GateDecision } from "@/lib/engine/outlook/experimental-outlook";
import { buildCustomerOutlook, type CustomerOutlook, type SectorRow } from "@/lib/engine/outlook/customer-outlook";
import evaluation from "@/data/outlook-phase3-evaluation.json";

/**
 * Cached read model for the Market Outlook page.
 *
 * The underlying series are end-of-day and identical for every user, so
 * reading them per request wastes several seconds on every page load for data
 * that changes once a day. This reads through the service-role client, caches
 * the assembled outlook, and is invalidated either by the tag or by its own
 * expiry.
 *
 * Gate decisions come from the committed Phase 3 evaluation rather than being
 * recomputed: which outputs are trustworthy was settled by a walk-forward that
 * takes minutes, and must not be silently re-decided on a page load.
 */

export const OUTLOOK_TAG = "market-outlook";

/** End-of-day data; an hour keeps the page fast without ever showing a stale session. */
const REVALIDATE_SECONDS = 3600;

async function build(): Promise<CustomerOutlook> {
  const admin = createAdminClient();
  const inputs = await loadAlignedInputs(admin);
  const dataset = buildForecastDataset(inputs);
  const gates = (evaluation as { gates: GateDecision[] }).gates;
  const sectors = (evaluation as unknown as { sectors: SectorRow[] }).sectors;
  const experimental = buildExperimentalOutlook(dataset, gates);
  return buildCustomerOutlook(inputs, dataset, experimental, sectors);
}

export const getMarketOutlook = unstable_cache(build, ["market-outlook-v1"], {
  revalidate: REVALIDATE_SECONDS,
  tags: [OUTLOOK_TAG],
});
