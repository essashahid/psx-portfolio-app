import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlignedInputs } from "@/lib/engine/outlook/inputs";

/**
 * Sector-impact validation from constituent returns.
 *
 * Tests whether each sector's historical daily returns actually responded to
 * the factors the platform's rule-based sensitivities assume, instead of
 * asserting the rules. A sensitivity is only "validated" when the conditional
 * spread is large relative to its sampling noise AND carries the same sign in
 * both halves of the sample. Anything else stays an assumption, labelled so.
 *
 * Sector returns are equal-weighted across members with a close on both the
 * day and the previous session, minimum five members, so one large name
 * cannot masquerade as a sector.
 */

export interface SectorFactorResult {
  factor: string;
  label: string;
  /** Mean daily sector return in-condition minus out-of-condition, as a fraction. */
  spread: number;
  /** Spread divided by its standard error. Magnitude >= 2 counts as signal. */
  tStat: number;
  conditionDays: number;
  /** Direction agrees across sample halves. */
  signConsistent: boolean;
  validated: boolean;
}

export interface SectorImpact {
  sector: string;
  members: number;
  days: number;
  factors: SectorFactorResult[];
}

const MIN_MEMBERS = 5;
const MIN_CONDITION_DAYS = 40;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** Expanding tercile flag: is the value in the top (or bottom) third of its own past? */
function expandingTail(values: (number | null)[], tail: "top" | "bottom", warmup = 126): boolean[] {
  const history: number[] = [];
  return values.map((v) => {
    if (v === null) return false;
    let lo = 0;
    let hi = history.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (history[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    history.splice(lo, 0, v);
    if (history.length < warmup) return false;
    const rank = lo / (history.length - 1 || 1);
    return tail === "top" ? rank >= 2 / 3 : rank <= 1 / 3;
  });
}

/** Daily log-ish simple returns from a series that may contain nulls. */
function dailyReturns(series: (number | null)[]): (number | null)[] {
  return series.map((v, i) => {
    if (i === 0) return null;
    const prev = series[i - 1];
    if (v === null || prev === null || !(prev > 0) || !(v > 0)) return null;
    return v / prev - 1;
  });
}

export interface SectorPanel {
  /** Sector -> equal-weighted daily return aligned to the master calendar. */
  returns: Map<string, (number | null)[]>;
  memberCounts: Map<string, number>;
}

/** Load constituent closes and aggregate to per-sector daily returns. */
export async function loadSectorPanel(supabase: SupabaseClient, dates: string[]): Promise<SectorPanel> {
  const PAGE = 1000;

  const sectorOf = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("stock_universe")
      .select("ticker, sector, instrument_type")
      .eq("instrument_type", "equity")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      if (r.sector && String(r.sector).trim()) sectorOf.set(r.ticker as string, String(r.sector).trim());
    }
    if (rows.length < PAGE) break;
  }

  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  // sector -> date-index -> {sum, n} accumulated from member returns.
  const acc = new Map<string, { sum: Float64Array; n: Int32Array }>();
  const lastClose = new Map<string, { index: number; close: number }>();
  const memberSeen = new Map<string, Set<string>>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("ticker, price_date, close")
      .order("ticker", { ascending: true })
      .order("price_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const ticker = r.ticker as string;
      const sector = sectorOf.get(ticker);
      if (!sector) continue;
      const i = dateIndex.get(r.price_date as string);
      if (i === undefined) continue;
      const close = Number(r.close);
      if (!Number.isFinite(close) || close <= 0) continue;

      const prev = lastClose.get(ticker);
      // A return requires the immediately preceding session, not just any
      // earlier close: bridging a suspension would smear one gap move into a
      // single day and distort the sector mean.
      if (prev && prev.index === i - 1) {
        if (!acc.has(sector)) {
          acc.set(sector, { sum: new Float64Array(dates.length), n: new Int32Array(dates.length) });
        }
        const bucket = acc.get(sector)!;
        bucket.sum[i] += close / prev.close - 1;
        bucket.n[i] += 1;
        if (!memberSeen.has(sector)) memberSeen.set(sector, new Set());
        memberSeen.get(sector)!.add(ticker);
      }
      lastClose.set(ticker, { index: i, close });
    }
    if (rows.length < PAGE) break;
  }

  const returns = new Map<string, (number | null)[]>();
  const memberCounts = new Map<string, number>();
  for (const [sector, bucket] of acc) {
    const members = memberSeen.get(sector)?.size ?? 0;
    if (members < MIN_MEMBERS) continue;
    memberCounts.set(sector, members);
    returns.set(
      sector,
      dates.map((_, i) => (bucket.n[i] >= MIN_MEMBERS ? bucket.sum[i] / bucket.n[i] : null))
    );
  }
  return { returns, memberCounts };
}

/** Factor condition flags per date, all point-in-time. */
export function buildFactorConditions(inputs: AlignedInputs): { key: string; label: string; flags: boolean[] }[] {
  const marketRet = dailyReturns(inputs.kse100.map((v) => v));
  const pkrRet = dailyReturns(inputs.usdPkr);
  const brentRet = dailyReturns(inputs.brent);
  const spyRet = dailyReturns(inputs.spy);

  // EWMA daily sigma for the volatility condition.
  const sigma: (number | null)[] = [];
  let variance: number | null = null;
  for (let i = 0; i < inputs.kse100.length; i++) {
    if (i > 0 && inputs.kse100[i - 1] > 0 && inputs.kse100[i] > 0) {
      const r = Math.log(inputs.kse100[i] / inputs.kse100[i - 1]);
      variance = variance === null ? r * r : 0.94 * variance + 0.06 * r * r;
    }
    sigma.push(variance !== null && i >= 30 ? Math.sqrt(variance) : null);
  }

  const adv10: (number | null)[] = inputs.breadth.advanceShare.map((_, i) => {
    if (i + 1 < 10) return null;
    const slice = inputs.breadth.advanceShare.slice(i + 1 - 10, i + 1).filter((v): v is number => v !== null);
    return slice.length >= 8 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });

  const rateChanged = inputs.policyRate.map((v, i) => (i === 0 ? 0 : v - inputs.policyRate[i - 1]));

  return [
    { key: "market-up", label: "Market up days (KSE-100 +0.5% or more)", flags: marketRet.map((r) => r !== null && r >= 0.005) },
    { key: "market-down", label: "Market down days (KSE-100 -0.5% or worse)", flags: marketRet.map((r) => r !== null && r <= -0.005) },
    { key: "high-vol", label: "Turbulent regime (top third of volatility)", flags: expandingTail(sigma, "top") },
    { key: "pkr-weak", label: "PKR weakening days (top third of USD/PKR moves)", flags: expandingTail(pkrRet, "top") },
    { key: "rate-hike", label: "Sessions within a week after a policy-rate rise", flags: windowAfter(rateChanged.map((v) => v > 0.01), 5) },
    { key: "rate-cut", label: "Sessions within a week after a policy-rate cut", flags: windowAfter(rateChanged.map((v) => v < -0.01), 5) },
    { key: "oil-up", label: "Oil-spike days (top third of Brent moves, lagged)", flags: expandingTail(brentRet, "top") },
    { key: "global-riskoff", label: "Global risk-off days (bottom third of S&P moves, lagged)", flags: expandingTail(spyRet, "bottom") },
    { key: "breadth-weak", label: "Deteriorating participation (bottom third of advance share)", flags: expandingTail(adv10, "bottom") },
  ];
}

/** True for the `span` sessions following any flagged session. */
function windowAfter(events: boolean[], span: number): boolean[] {
  const out = Array(events.length).fill(false);
  for (let i = 0; i < events.length; i++) {
    if (!events[i]) continue;
    for (let j = i; j < Math.min(events.length, i + span); j++) out[j] = true;
  }
  return out;
}

export function validateSectorImpacts(panel: SectorPanel, conditions: { key: string; label: string; flags: boolean[] }[]): SectorImpact[] {
  const out: SectorImpact[] = [];

  for (const [sector, series] of panel.returns) {
    const usable = series.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
    if (usable.length < 300) continue;
    const half = usable[Math.floor(usable.length / 2)].i;

    const factors: SectorFactorResult[] = conditions.map((c) => {
      const inCond = usable.filter((x) => c.flags[x.i]);
      const outCond = usable.filter((x) => !c.flags[x.i]);
      const inVals = inCond.map((x) => x.v);
      const outVals = outCond.map((x) => x.v);
      const spread = mean(inVals) - mean(outVals);
      const se = Math.sqrt((sd(inVals) ** 2 || 0) / Math.max(1, inVals.length) + (sd(outVals) ** 2 || 0) / Math.max(1, outVals.length));
      const tStat = se > 0 ? spread / se : NaN;

      const spreadIn = (rows: { v: number; i: number }[]) => {
        const a = rows.filter((x) => c.flags[x.i]).map((x) => x.v);
        const b = rows.filter((x) => !c.flags[x.i]).map((x) => x.v);
        return a.length >= 15 && b.length >= 15 ? mean(a) - mean(b) : NaN;
      };
      const s1 = spreadIn(usable.filter((x) => x.i < half));
      const s2 = spreadIn(usable.filter((x) => x.i >= half));
      const signConsistent = Number.isFinite(s1) && Number.isFinite(s2) && Math.sign(s1) === Math.sign(s2) && Math.sign(s1) === Math.sign(spread);

      return {
        factor: c.key,
        label: c.label,
        spread,
        tStat,
        conditionDays: inCond.length,
        signConsistent,
        validated: inCond.length >= MIN_CONDITION_DAYS && Math.abs(tStat) >= 2 && signConsistent,
      };
    });

    out.push({ sector, members: 0, days: usable.length, factors });
  }

  for (const s of out) s.members = panel.memberCounts.get(s.sector) ?? 0;
  return out.sort((a, b) => b.days - a.days || a.sector.localeCompare(b.sector));
}
