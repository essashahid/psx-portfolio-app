/**
 * The contract for GET /api/market/dashboard.
 *
 * The phone shows the index, how broad the move was, sectors ranked, and the
 * movers. The web dashboard reads more than this; the extra is desk material.
 */

export interface MarketIndex {
  name: string;
  value: number | null;
  change: number | null;
  changePct: number | null;
  /** When the snapshot was taken, as the provider reported it. */
  asOf: string | null;
  source: string | null;
}

export interface MarketBreadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  totalVolume: number;
  totalValue: number;
}

export interface MarketSector {
  sector: string;
  label: string;
  color: string;
  averageReturn: number | null;
  advancers: number;
  decliners: number;
  stockCount: number;
  topGainer: string | null;
  topGainerPct: number | null;
}

/**
 * Today's move for every company, bucketed, with your own marked.
 *
 * Aggregated on the server: the raw heatmap is ~500 rows and the phone only
 * draws twelve bars from it.
 */
export interface MarketDistribution {
  buckets: { lo: number; hi: number; count: number; mine: string[] }[];
  total: number;
  best: { ticker: string; pct: number } | null;
  worst: { ticker: string; pct: number } | null;
}

export interface MarketMover {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  color: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  /** True when the user holds it, so their own book stands out in the list. */
  owned: boolean;
}

export interface MarketResponse {
  /**
   * The map, biggest companies first. Capped rather than sent whole: the
   * snapshot runs to 150 rows and a phone-sized treemap stops being readable
   * long before that, so the tail would be tiles too small to label.
   */
  map?: MarketMapItem[];
  /** Total market value the map covers, so the caption can say what it omits. */
  mapCoverage?: { shown: number; total: number; capShown: number; capTotal: number };
  flows?: MarketFlow[];
  flowsAsOf?: string | null;
  indexSeries?: MarketIndexPoint[];
  index: MarketIndex | null;
  breadth: MarketBreadth | null;
  /** Best average return first. */
  sectors: MarketSector[];
  gainers: MarketMover[];
  losers: MarketMover[];
  mostActive: MarketMover[];
  /** Null when the snapshot carries no per-company returns. */
  distribution: MarketDistribution | null;
  updatedLabel: string | null;
}

/**
 * One company on the market map.
 *
 * Area is market capitalisation and fill is the day's move, so size says how
 * much a name matters and colour says what it did. Sector comes along because
 * the map groups by it: adjacency carries the sector, which frees the fill to
 * carry direction alone.
 */
export interface MarketMapItem {
  ticker: string;
  sector: string | null;
  sectorLabel: string;
  color: string;
  changePct: number | null;
  marketCap: number;
  /** Marked on the map, so you can find your own holdings in it. */
  owned: boolean;
}

/** Net buying by investor type, from the PSX participant tape. */
export interface MarketFlow {
  label: string;
  net: number | null;
}

/** One close per session, oldest first, for the header sparkline. */
export interface MarketIndexPoint {
  date: string;
  value: number;
}
