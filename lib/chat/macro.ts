import type { SupabaseClient } from "@supabase/supabase-js";
import { policyRateContext, readMacroSeries, type PolicyRateContext } from "@/lib/market-data/macro-assets";
import { cpiYoY, type CpiInflation } from "@/lib/market-data/pbs-cpi";
import { fmtPct } from "@/lib/market/format";

/**
 * PSX macro backdrop for the Research Copilot: the three signals PSX sectors
 * actually live and die on — the SBP policy rate, CPI inflation, and USD/PKR.
 * Everything is pre-computed here so the model narrates the numbers and their
 * effect on the user's sector weights, never recomputes them. Sourced from the
 * same deterministic series the allocation forecaster uses (macro-assets.ts,
 * pbs-cpi.ts). USD/PKR reads from the shared macro_asset_history cache and is
 * simply omitted when it has not been backfilled — we never fabricate a rate.
 */

export interface MacroSnapshot {
  policyRate: PolicyRateContext;
  inflation: CpiInflation | null;
  usdPkr: {
    rate: number;
    asOf: string;
    change6mPct: number | null;
    change12mPct: number | null;
  } | null;
}

/** Nearest point at or before an ISO date, from an ascending-by-date series. */
function pointOnOrBefore<T extends { date: string; value: number }>(points: T[], date: string): T | null {
  let chosen: T | null = null;
  for (const p of points) {
    if (p.date <= date) chosen = p;
    else break;
  }
  return chosen;
}

function pctChange(from: number | null | undefined, to: number): number | null {
  if (from == null || from <= 0) return null;
  return (to / from - 1) * 100;
}

function isoDaysBefore(date: string, days: number): string {
  return new Date(Date.parse(date) - days * 86_400_000).toISOString().slice(0, 10);
}

export async function getMacroSnapshot(supabase: SupabaseClient, asOf: string): Promise<MacroSnapshot> {
  const policyRate = policyRateContext(asOf);
  const inflation = cpiYoY(asOf);

  let usdPkr: MacroSnapshot["usdPkr"] = null;
  try {
    const fx = await readMacroSeries(supabase, "USDPKR", new Date(`${asOf}T00:00:00Z`));
    // Only use a series that is present and not badly stale; otherwise omit.
    if (fx.points.length >= 2 && fx.quality !== "missing" && fx.lastDate) {
      const latest = fx.points[fx.points.length - 1];
      const p6 = pointOnOrBefore(fx.points, isoDaysBefore(latest.date, 182));
      const p12 = pointOnOrBefore(fx.points, isoDaysBefore(latest.date, 365));
      usdPkr = {
        rate: latest.value,
        asOf: latest.date,
        change6mPct: pctChange(p6?.value, latest.value),
        change12mPct: pctChange(p12?.value, latest.value),
      };
    }
  } catch {
    usdPkr = null;
  }

  return { policyRate, inflation, usdPkr };
}

// --- Sector sensitivity ----------------------------------------------------
//
// Established, directional relationships between PSX sectors and the three
// macro drivers. Kept relational (not a tailwind/headwind verdict) so the model
// combines them with the live regime and the user's weight rather than parroting
// a hardcoded call. Matched by keyword against the holding's sector name.

interface SectorSensitivity {
  match: RegExp;
  note: string;
}

const SECTOR_SENSITIVITY: SectorSensitivity[] = [
  {
    match: /bank/i,
    note: "earn wider net interest margins when policy rates are high; a falling-rate cycle gradually compresses that spread but lifts bond-book valuations",
  },
  {
    match: /fertiliz/i,
    note: "margins hinge on the gas feedstock and subsidy regime more than on rates; strong pricing power tends to pass inflation through to output prices",
  },
  {
    match: /exploration|oil & gas exploration|\be&p\b/i,
    note: "revenue is USD-linked, so PKR depreciation lifts PKR earnings; the swing factor is the international oil price",
  },
  {
    match: /oil & gas marketing|marketing compan/i,
    note: "volumes track economic activity; circular debt and the rate level drive financing costs",
  },
  {
    match: /refiner/i,
    note: "margins track international crack spreads and PKR; deregulation and inventory gains on a weaker PKR are the swing factors",
  },
  {
    match: /cement/i,
    note: "demand and leverage are rate-sensitive, so falling rates support construction volumes and cut financing costs, while PKR weakness raises imported coal and energy costs",
  },
  {
    match: /power|hub power|generation/i,
    note: "USD-indexed tariffs benefit from PKR weakness and heavy leverage makes falling rates a tailwind, but circular debt is the key risk to cash flows",
  },
  {
    match: /technolog|communication/i,
    note: "export-oriented revenue is USD-linked, so PKR depreciation is a direct tailwind",
  },
  {
    match: /textile/i,
    note: "exporters gain from PKR depreciation; leverage makes falling rates a tailwind and cotton input costs the key risk",
  },
  {
    match: /automobile|auto assembler|auto part/i,
    note: "financing-driven demand benefits from falling rates, while imported CKD kits make PKR weakness a cost headwind",
  },
  {
    match: /pharma/i,
    note: "imported API costs make PKR depreciation a margin headwind and pricing is regulated, so relief comes mainly from a stronger PKR",
  },
  {
    match: /chemical/i,
    note: "input costs are import- and PKR-sensitive; demand tracks industrial activity and the rate cycle",
  },
  {
    match: /engineer|steel/i,
    note: "rate-sensitive demand with imported raw-material exposure, so falling rates help volumes while PKR weakness lifts input costs",
  },
  {
    match: /food|personal care|sugar/i,
    note: "defensive demand with pricing that passes inflation through; some input costs are import-linked",
  },
  {
    match: /insurance/i,
    note: "investment income rises with high rates, so a falling-rate cycle trims yield on the float",
  },
  {
    match: /glass|ceramic|paper/i,
    note: "energy- and import-cost sensitive, so PKR weakness pressures margins while falling rates support demand",
  },
];

function sensitivityFor(sector: string): string | null {
  for (const s of SECTOR_SENSITIVITY) if (s.match.test(sector)) return s.note;
  return null;
}

/**
 * Render the macro backdrop plus a per-sector sensitivity read for the sectors
 * the user actually holds (with their weights), so the model can say "with the
 * policy rate at 11%, your 42% bank weight is a tailwind" grounded in real
 * figures rather than generic commentary.
 */
export function briefFromMacro(
  snapshot: MacroSnapshot,
  sectors: { sector: string; weightPct: number | null }[]
): string {
  const { policyRate: r, inflation, usdPkr } = snapshot;
  const lines: string[] = [];

  const dirWord =
    r.direction === "falling" ? "an easing cycle" : r.direction === "rising" ? "a tightening cycle" : "a flat rate cycle";
  const peakBit =
    r.peakPct > r.currentPct
      ? `, down from a ${r.peakPct.toFixed(1)}% peak (${dirWord})`
      : r.peakPct < r.currentPct
        ? ` (${dirWord})`
        : "";
  lines.push(`- Policy rate: ${r.currentPct.toFixed(1)}% (SBP path, effective ${r.since})${peakBit}.`);

  if (inflation) {
    lines.push(`- Inflation: ${fmtPct(inflation.yoyPct, false)} year-on-year (National CPI, ${inflation.month}).`);
    // Real rate is a standard, decision-relevant read; pre-compute it too.
    const real = r.currentPct - inflation.yoyPct;
    lines.push(`- Real policy rate: about ${Math.abs(real).toFixed(1)} points ${real >= 0 ? "above" : "below"} inflation (policy rate minus CPI).`);
  }

  if (usdPkr) {
    const ch6 = usdPkr.change6mPct != null ? `${fmtPct(usdPkr.change6mPct)} over 6 months` : null;
    const ch12 = usdPkr.change12mPct != null ? `${fmtPct(usdPkr.change12mPct)} over 12 months` : null;
    const changes = [ch6, ch12].filter(Boolean).join(", ");
    lines.push(`- USD/PKR: ${usdPkr.rate.toFixed(2)} (as of ${usdPkr.asOf})${changes ? `; PKR ${usdPkr.change12mPct != null && usdPkr.change12mPct > 0 ? "weaker" : "firmer"}, ${changes}` : ""}.`);
  }

  const out = [`## PSX macro backdrop (pre-computed; narrate, do not recompute)`, lines.join("\n")];

  // Per-held-sector sensitivity, heaviest first, deduped by sector.
  const seen = new Set<string>();
  const sensLines: string[] = [];
  for (const s of sectors) {
    if (!s.sector || seen.has(s.sector)) continue;
    seen.add(s.sector);
    const note = sensitivityFor(s.sector);
    if (!note) continue;
    const weightBit = s.weightPct != null ? ` (${s.weightPct.toFixed(0)}% of your book)` : "";
    sensLines.push(`- ${s.sector}${weightBit}: ${note}.`);
  }
  if (sensLines.length) {
    out.push(`### How this backdrop hits your sectors\n${sensLines.join("\n")}`);
  }

  return out.join("\n\n");
}
