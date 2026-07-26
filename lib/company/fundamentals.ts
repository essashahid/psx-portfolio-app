import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The six metrics behind the Fundamentals grid, read from filed annual
 * accounts.
 *
 * A fiscal year is spread across several rows in company_financials — one per
 * statement type — so a year is only complete once the income statement, the
 * balance sheet and the cash flow statement have been merged. Cash conversion
 * in particular needs operating cash flow from one row and profit after tax
 * from another, so reading rows individually finds it far less often than it
 * exists.
 *
 * How many years come back is whatever has actually been filed and published.
 * Most companies have three or four; a few have more, many have fewer, and the
 * balance-sheet metrics are thinner than the income-statement ones because
 * fewer balance sheets have been extracted. Nothing is interpolated to fill a
 * gap — a metric with no data is reported as absent and the grid says so.
 */

export type MetricKey =
  | "revenue" | "margin" | "eps" | "roe" | "de" | "cc"
  // Derived backfills. The ideal six leave gaps because balance sheets and cash
  // flow statements are extracted far less often than income statements; these
  // are computable from what is actually filed, so the grid can stay full of
  // real figures rather than half full of absences.
  | "revenue_growth" | "gross_margin" | "eps_growth";

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  /** What a reader should compare this figure against. */
  note: string;
  /** True when a falling value is the good direction. */
  lowerIsBetter?: boolean;
  format: (v: number) => string;
  /**
   * The band outside which the figure is not believable as this metric.
   *
   * A ratio can be arithmetically fine and economically meaningless. TRG is a
   * holding company whose standalone revenue is a rounding error against
   * profit from associates, so profit ÷ revenue came out at 201,436% and its
   * filed range read "−1,204,063% to 201,436%". Nobody can act on that. Values
   * outside the band are dropped from the series and the metric reports what
   * it has left, exactly as it would for a year that was never filed.
   */
  plausible?: [number, number];
}

const compact = (v: number) =>
  new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: 1 }).format(v);
/**
 * Rounding can carry a sign onto a zero: TRG's cash conversion is a hair below
 * zero and printed as "-0.00x", which reads as a real negative. Anything that
 * rounds to nothing is shown unsigned.
 */
const unsigned = (v: number, digits: number) => (Math.abs(v) < 0.5 / 10 ** digits ? 0 : v);
const pct1 = (v: number) => `${unsigned(v, 1).toFixed(1)}%`;
const num2 = (v: number) => unsigned(v, 2).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mult2 = (v: number) => `${unsigned(v, 2).toFixed(2)}x`;

export const METRICS: MetricDef[] = [
  {
    key: "revenue",
    label: "Revenue",
    unit: "PKR, filed accounts",
    note: "Read against the company's own history first. Sector revenue scales with company size, so the median says less here than the trend does.",
    format: compact,
  },
  {
    key: "margin",
    label: "Net margin",
    unit: "profit after tax ÷ revenue",
    note: "The share of every rupee of sales that survives to profit. Compare it with the sector median, since margins are a property of the business model.",
    format: pct1,
    plausible: [-200, 200],
  },
  {
    key: "eps",
    label: "Earnings per share",
    unit: "PKR, as reported",
    note: "Earnings attributable to one share. Read alongside the P/E in the header, which is this figure divided into the price.",
    format: num2,
  },
  {
    key: "roe",
    label: "Return on equity",
    unit: "profit ÷ equity",
    note: "What the company earns on the capital shareholders have left in it. A high figure on thin equity can flatter a heavily borrowed balance sheet, so read it with debt to equity.",
    format: pct1,
    plausible: [-200, 200],
  },
  {
    key: "de",
    label: "Debt to equity",
    unit: "borrowings ÷ equity",
    note: "How much of the balance sheet is borrowed. Falling is the good direction, and what counts as high is set by the sector.",
    lowerIsBetter: true,
    format: mult2,
    plausible: [0, 25],
  },
  {
    key: "cc",
    label: "Cash conversion",
    unit: "operating cash flow ÷ profit",
    note: "How much reported profit arrives as cash. Persistently below 1.0x means profit is being booked faster than it is collected.",
    format: mult2,
    plausible: [-20, 20],
  },
  {
    key: "revenue_growth",
    label: "Revenue growth",
    unit: "year on year",
    note: "The pace of the top line. One good year is not a trend, so read the run of years rather than the latest figure.",
    format: (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`,
    plausible: [-100, 1000],
  },
  {
    key: "gross_margin",
    label: "Gross margin",
    unit: "gross profit ÷ revenue",
    note: "What survives the direct cost of sales, before overheads and financing. It moves with input costs and pricing power.",
    format: pct1,
    plausible: [-200, 200],
  },
  {
    key: "eps_growth",
    label: "EPS growth",
    unit: "year on year",
    note: "Earnings per share against the prior year. It can diverge from profit growth when the share count changes.",
    format: (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`,
    plausible: [-1000, 1000],
  },
];

/**
 * Fixed priority. The grid fills from the top of this list with whatever the
 * company has actually filed, so the order of the cells is the same on every
 * company page even when the contents differ.
 */
export const METRIC_PRIORITY: MetricKey[] = [
  "revenue", "margin", "eps", "roe", "de", "cc", "revenue_growth", "gross_margin", "eps_growth",
];

/** A sector median drawn from fewer contributors than this is not a median. */
export const MIN_MEDIAN_PEERS = 5;

export interface MetricSeries {
  key: MetricKey;
  /** Filed years, oldest first. Empty when the metric has no data at all. */
  points: { year: number; value: number }[];
  /** Median of peers' latest filed value, or null when too few peers filed it. */
  sectorMedian: number | null;
  peerCount: number;
}

export interface PeerRank {
  ticker: string;
  value: number;
  isSelf: boolean;
}

export interface FundamentalsData {
  series: Record<MetricKey, MetricSeries>;
  /** Sector peers ranked on each metric, best first. */
  ranking: Record<MetricKey, PeerRank[]>;
  sector: string | null;
  /**
   * Median P/E across sector peers, on the same rule as every other median: at
   * least five companies must contribute, otherwise it is null and the caller
   * says so rather than quoting the midpoint of two.
   *
   * Computed here because the peers' filed EPS is already loaded; only their
   * latest prices need fetching. Peers with a loss are excluded, since a
   * negative multiple is not a valuation and would drag the median down.
   */
  sectorPe: { median: number | null; contributors: number };
}

type Row = {
  ticker: string;
  fiscal_year: number;
  data: Record<string, unknown> | null;
  updated_at: string | null;
};

const num = (d: Record<string, unknown>, k: string): number | null => {
  const v = d[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * Absolute money amounts are filed in thousands of rupees, recorded in the
 * row's own _units field. Reading them raw understates every currency figure by
 * a factor of a thousand — Mari's revenue reads as 177 million rather than 177
 * billion. Ratios and per-share figures are already in their final unit and
 * must not be touched, so the scale is applied per field, not to the row.
 */
const MONEY_FIELDS = new Set(["revenue", "profit_after_tax", "equity", "borrowings", "operating_cash_flow"]);

/**
 * The declared scale, or null when the row does not declare one.
 *
 * Null is refused rather than defaulted. Assuming thousands for an undeclared
 * row is a 1000x error in a figure someone may act on, and it fails silently —
 * the number still looks like a number. Ratios and per-share figures are
 * unaffected, so only money is withheld.
 */
function unitScale(d: Record<string, unknown>): number | null {
  const u = String(d._units ?? "").toLowerCase();
  if (!u) return null;
  if (u.includes("thousand")) return 1_000;
  if (u.includes("million")) return 1_000_000;
  if (u.includes("billion")) return 1_000_000_000;
  if (u.includes("pkr") || u.includes("rupee")) return 1;
  return null;
}

/** A money field in its true rupee amount; other fields unchanged. */
const amount = (d: Record<string, unknown>, k: string): number | null => {
  const v = num(d, k);
  if (v === null) return null;
  if (!MONEY_FIELDS.has(k)) return v;
  const scale = unitScale(d);
  return scale === null ? null : v * scale;
};

/** Derive one metric from a fully merged fiscal year. */
function derive(key: MetricKey, d: Record<string, unknown>): number | null {
  const revenue = amount(d, "revenue");
  const pat = amount(d, "profit_after_tax");
  const equity = amount(d, "equity");

  switch (key) {
    case "revenue":
      return revenue;
    case "eps":
      return num(d, "eps");
    case "margin": {
      const filed = num(d, "net_profit_margin_pct");
      if (filed !== null) return filed;
      return pat !== null && revenue ? (pat / revenue) * 100 : null;
    }
    case "roe":
      return pat !== null && equity ? (pat / equity) * 100 : null;
    case "de": {
      const borrowings = amount(d, "borrowings");
      return borrowings !== null && equity ? borrowings / equity : null;
    }
    case "cc": {
      const ocf = amount(d, "operating_cash_flow");
      return ocf !== null && pat ? ocf / pat : null;
    }
    case "gross_margin": {
      const filed = num(d, "gross_profit_margin_pct");
      if (filed !== null) return filed;
      const gp = amount(d, "gross_profit");
      return gp !== null && revenue ? (gp / revenue) * 100 : null;
    }
    // Growth metrics are differences between years, so they cannot be read from
    // a single year. They are built from their base series after the fact.
    case "revenue_growth":
    case "eps_growth":
      return null;
  }
}

/** Year-on-year change of a base series, as its own series. */
function growthOf(points: { year: number; value: number }[]): { year: number; value: number }[] {
  const out: { year: number; value: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    if (prev === 0) continue;
    out.push({ year: points[i].year, value: ((points[i].value - prev) / Math.abs(prev)) * 100 });
  }
  return out;
}

/**
 * Merge every statement type of a year into one object, per ticker.
 *
 * A company can hold more than one extraction of the same statement and year,
 * and they do not always agree — Hub Power has two 2025 income statements
 * reporting different earnings per share. Rows are sorted oldest-updated first
 * so the newest extraction wins the overwrite, which makes the result stable
 * instead of depending on the order the database happened to return.
 */
function mergeByYear(rows: Row[]): Map<string, Map<number, Record<string, unknown>>> {
  const ordered = [...rows].sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
  const out = new Map<string, Map<number, Record<string, unknown>>>();
  for (const r of ordered) {
    if (!out.has(r.ticker)) out.set(r.ticker, new Map());
    const years = out.get(r.ticker)!;
    years.set(r.fiscal_year, { ...(years.get(r.fiscal_year) ?? {}), ...(r.data ?? {}) });
  }
  return out;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function getFundamentals(
  supabase: SupabaseClient,
  ticker: string
): Promise<FundamentalsData> {
  const { data: master } = await supabase
    .from("stock_master")
    .select("sector")
    .eq("ticker", ticker)
    .maybeSingle();
  const sector = (master?.sector as string | null) ?? null;

  // Peers first, so the sector median is drawn from the same filed accounts as
  // the company's own figures rather than a second source.
  let peerTickers: string[] = [ticker];
  if (sector) {
    const { data: peers } = await supabase
      .from("stock_master")
      .select("ticker")
      .eq("sector", sector)
      .limit(120);
    const list = (peers ?? []).map((p) => p.ticker as string);
    if (list.length) peerTickers = Array.from(new Set([ticker, ...list]));
  }

  const { data: rows } = await supabase
    .from("company_financials")
    .select("ticker, fiscal_year, data, updated_at")
    .eq("period_type", "annual")
    .eq("review_status", "published")
    .in("ticker", peerTickers)
    .limit(4000);

  const byTicker = mergeByYear((rows ?? []) as Row[]);
  const selfYears = byTicker.get(ticker) ?? new Map<number, Record<string, unknown>>();

  const series = {} as Record<MetricKey, MetricSeries>;
  const ranking = {} as Record<MetricKey, PeerRank[]>;

  const defOf = new Map(METRICS.map((m) => [m.key, m]));
  const seriesFor = (key: MetricKey, years: Map<number, Record<string, unknown>>): { year: number; value: number }[] => {
    const raw =
      key === "revenue_growth"
        ? growthOf(seriesFor("revenue", years))
        : key === "eps_growth"
          ? growthOf(seriesFor("eps", years))
          : [...years.entries()]
              .map(([year, d]) => ({ year, value: derive(key, d) }))
              .filter((p): p is { year: number; value: number } => p.value !== null)
              .sort((a, b) => a.year - b.year);

    const band = defOf.get(key)?.plausible;
    if (!band) return raw;
    return raw.filter((p) => p.value >= band[0] && p.value <= band[1]);
  };

  for (const def of METRICS) {
    const points = seriesFor(def.key, selfYears);

    // One figure per peer: its own latest filed year for this metric. A company
    // that has not filed the metric is left out of the ranking entirely rather
    // than entered at zero, which would read as the worst performer.
    const peerLatest: PeerRank[] = [];
    for (const [t, years] of byTicker) {
      const withValue = seriesFor(def.key, years);
      if (withValue.length) {
        const latest = withValue[withValue.length - 1];
        peerLatest.push({ ticker: t, value: latest.value, isSelf: t === ticker });
      }
    }

    peerLatest.sort((a, b) => (def.lowerIsBetter ? a.value - b.value : b.value - a.value));

    // Below the threshold there is no median worth drawing — the midpoint of
    // two companies is not a sector. The caption says so instead.
    const contributors = peerLatest.filter((p) => !p.isSelf).map((p) => p.value);
    series[def.key] = {
      key: def.key,
      points,
      sectorMedian: contributors.length >= MIN_MEDIAN_PEERS ? median(contributors) : null,
      peerCount: contributors.length,
    };
    ranking[def.key] = peerLatest;
  }

  return { series, ranking, sector, sectorPe: await sectorPeOf(supabase, byTicker, peerTickers) };
}

/** Median P/E across peers that filed a positive EPS and have a live price. */
async function sectorPeOf(
  supabase: SupabaseClient,
  byTicker: Map<string, Map<number, Record<string, unknown>>>,
  peerTickers: string[]
): Promise<{ median: number | null; contributors: number }> {
  const { data: snap } = await supabase
    .from("market_snapshot_items")
    .select("ticker, price, snapshot_id")
    .in("ticker", peerTickers)
    .order("snapshot_id", { ascending: false })
    .limit(2000);

  const price = new Map<string, number>();
  for (const r of snap ?? []) {
    const v = Number(r.price);
    if (!price.has(r.ticker) && Number.isFinite(v) && v > 0) price.set(r.ticker, v);
  }

  const pes: number[] = [];
  for (const [t, years] of byTicker) {
    const p = price.get(t);
    if (!p) continue;
    const epsYears = [...years.entries()]
      .map(([year, d]) => ({ year, value: num(d, "eps") }))
      .filter((x): x is { year: number; value: number } => x.value !== null)
      .sort((a, b) => b.year - a.year);
    const eps = epsYears[0]?.value;
    if (eps === undefined || eps <= 0) continue;
    pes.push(p / eps);
  }

  return { median: pes.length >= MIN_MEDIAN_PEERS ? median(pes) : null, contributors: pes.length };
}
