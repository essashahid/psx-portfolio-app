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

export type MetricKey = "revenue" | "margin" | "eps" | "roe" | "de" | "cc";

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  /** What a reader should compare this figure against. */
  note: string;
  /** True when a falling value is the good direction. */
  lowerIsBetter?: boolean;
  format: (v: number) => string;
}

const compact = (v: number) =>
  new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const pct1 = (v: number) => `${v.toFixed(1)}%`;
const num2 = (v: number) => v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mult2 = (v: number) => `${v.toFixed(2)}x`;

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
  },
  {
    key: "de",
    label: "Debt to equity",
    unit: "borrowings ÷ equity",
    note: "How much of the balance sheet is borrowed. Falling is the good direction, and what counts as high is set by the sector.",
    lowerIsBetter: true,
    format: mult2,
  },
  {
    key: "cc",
    label: "Cash conversion",
    unit: "operating cash flow ÷ profit",
    note: "How much reported profit arrives as cash. Persistently below 1.0x means profit is being booked faster than it is collected.",
    format: mult2,
  },
];

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

function unitScale(d: Record<string, unknown>): number {
  const u = String(d._units ?? "").toLowerCase();
  if (u.includes("thousand")) return 1_000;
  if (u.includes("million")) return 1_000_000;
  if (u.includes("billion")) return 1_000_000_000;
  return 1;
}

/** A money field in its true rupee amount; other fields unchanged. */
const amount = (d: Record<string, unknown>, k: string): number | null => {
  const v = num(d, k);
  if (v === null) return null;
  return MONEY_FIELDS.has(k) ? v * unitScale(d) : v;
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
  }
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

  for (const def of METRICS) {
    const points = [...selfYears.entries()]
      .map(([year, d]) => ({ year, value: derive(def.key, d) }))
      .filter((p): p is { year: number; value: number } => p.value !== null)
      .sort((a, b) => a.year - b.year);

    // One figure per peer: its own latest filed year for this metric.
    const peerLatest: PeerRank[] = [];
    for (const [t, years] of byTicker) {
      const withValue = [...years.entries()]
        .map(([year, d]) => ({ year, value: derive(def.key, d) }))
        .filter((p): p is { year: number; value: number } => p.value !== null)
        .sort((a, b) => b.year - a.year);
      if (withValue.length) peerLatest.push({ ticker: t, value: withValue[0].value, isSelf: t === ticker });
    }

    peerLatest.sort((a, b) => (def.lowerIsBetter ? a.value - b.value : b.value - a.value));

    series[def.key] = {
      key: def.key,
      points,
      sectorMedian: median(peerLatest.filter((p) => !p.isSelf).map((p) => p.value)),
      peerCount: peerLatest.filter((p) => !p.isSelf).length,
    };
    ranking[def.key] = peerLatest;
  }

  return { series, ranking, sector };
}
